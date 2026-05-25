import { audioToMp3Blob } from '../src/utils/MP3Converter';

// ---------------------------------------------------------------------------
// MP3Converter — covers loadLamejs (cached, lazy-loaded, failed) and the
// audioToMp3Blob pipeline (mime-type fallback, AudioContext / webkit fallback,
// per-chunk + flush branches inside the encoding loop, decoder error rethrow).
//
// jsdom does not ship AudioContext or lamejs, so the suite installs typed
// fakes on `window` per test and restores them in afterEach. All tests are
// deterministic (no real timers, no real audio).
// ---------------------------------------------------------------------------

class FakeBlob {
  constructor(parts, opts = {}) {
    this.parts = parts;
    this.type = opts && opts.type;
    FakeBlob.instances.push(this);
  }

  arrayBuffer() {
    return Promise.resolve(this._buffer || new ArrayBuffer(8));
  }
}

FakeBlob.instances = [];

function makeMp3EncoderFactory({
  encodeReturns = [new Int8Array([1, 2, 3])],
  flushReturn = new Int8Array([4]),
  recordConstructor,
} = {}) {
  const encodeCalls = [];
  let encodeIndex = 0;

  function Mp3Encoder(numChannels, sampleRate, kbps) {
    if (recordConstructor) {
      recordConstructor({ numChannels, sampleRate, kbps });
    }
    this.numChannels = numChannels;
    this.sampleRate = sampleRate;
    this.kbps = kbps;
  }

  Mp3Encoder.prototype.encodeBuffer = function (chunk) {
    encodeCalls.push(chunk);
    const buf = encodeReturns[encodeIndex];
    if (encodeIndex < encodeReturns.length - 1) encodeIndex += 1;
    return buf;
  };

  Mp3Encoder.prototype.flush = function () {
    return flushReturn;
  };

  return { Mp3Encoder, encodeCalls };
}

function installAudioContext({ sampleRate = 44100, channelData } = {}) {
  const decodeAudioData = jest.fn().mockResolvedValue({
    sampleRate,
    getChannelData: jest.fn(() => channelData || new Float32Array([0.1, -0.2])),
  });
  const ctor = jest.fn().mockImplementation(() => ({
    decodeAudioData,
  }));
  return { ctor, decodeAudioData };
}

describe('MP3Converter — audioToMp3Blob', () => {
  let originalBlob;
  let originalAudioContext;
  let originalWebkitAudioContext;
  let originalLamejs;
  let originalCreateElement;

  beforeEach(() => {
    FakeBlob.instances = [];

    originalBlob = global.Blob;
    originalAudioContext = window.AudioContext;
    originalWebkitAudioContext = window.webkitAudioContext;
    originalLamejs = window.lamejs;
    originalCreateElement = document.createElement.bind(document);

    global.Blob = FakeBlob;
    delete window.AudioContext;
    delete window.webkitAudioContext;
    delete window.lamejs;
  });

  afterEach(() => {
    global.Blob = originalBlob;
    if (originalAudioContext) window.AudioContext = originalAudioContext;
    else delete window.AudioContext;
    if (originalWebkitAudioContext)
      window.webkitAudioContext = originalWebkitAudioContext;
    else delete window.webkitAudioContext;
    if (originalLamejs) window.lamejs = originalLamejs;
    else delete window.lamejs;
    document.createElement = originalCreateElement;
  });

  // -------------------------------------------------------------------------
  // Happy path with cached lamejs (no script load).
  // -------------------------------------------------------------------------
  describe('with lamejs already on window', () => {
    it('reuses the cached library and returns an audio/mp3 blob', async () => {
      const { ctor: AudioContextCtor } = installAudioContext({
        channelData: new Float32Array([0.5, -0.5, 0]),
      });
      window.AudioContext = AudioContextCtor;

      const ctorCalls = [];
      const { Mp3Encoder } = makeMp3EncoderFactory({
        recordConstructor: (args) => ctorCalls.push(args),
      });
      window.lamejs = { Mp3Encoder };

      const chunks = [{ type: 'audio/webm' }];

      const result = await audioToMp3Blob(chunks);

      expect(result).toBeInstanceOf(FakeBlob);
      expect(result.type).toBe('audio/mp3');
      expect(ctorCalls[0]).toEqual({
        numChannels: 1,
        sampleRate: 44100,
        kbps: 128,
      });
      expect(AudioContextCtor).toHaveBeenCalledTimes(1);
    });

    it("uses each chunk's mime type when chunks are present", async () => {
      window.AudioContext = installAudioContext().ctor;
      const { Mp3Encoder } = makeMp3EncoderFactory();
      window.lamejs = { Mp3Encoder };

      await audioToMp3Blob([{ type: 'audio/mp4' }]);

      const inputBlob = FakeBlob.instances[0];
      expect(inputBlob.type).toBe('audio/mp4');
    });

    it('falls back to audio/webm when the chunk array is empty', async () => {
      window.AudioContext = installAudioContext().ctor;
      const { Mp3Encoder } = makeMp3EncoderFactory();
      window.lamejs = { Mp3Encoder };

      await audioToMp3Blob([]);

      expect(FakeBlob.instances[0].type).toBe('audio/webm');
    });

    it('falls back to webkitAudioContext when AudioContext is absent', async () => {
      const { ctor: webkitCtor } = installAudioContext();
      window.webkitAudioContext = webkitCtor;

      const { Mp3Encoder } = makeMp3EncoderFactory();
      window.lamejs = { Mp3Encoder };

      await audioToMp3Blob([{ type: 'audio/webm' }]);

      expect(webkitCtor).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Lazy script load (loadLamejs cold path). Both document.createElement and
  // document.head.appendChild are stubbed so jsdom does not reject the fake
  // <script> node when it gets attached to the DOM.
  // -------------------------------------------------------------------------
  describe('with lamejs missing on window (lazy script load)', () => {
    let originalAppendChild;
    let appendedNodes;

    function stubLamejsLoader({ onAppend }) {
      document.createElement = jest.fn(() => {
        return {
          tag: 'script',
          set src(value) {
            this._src = value;
          },
          get src() {
            return this._src;
          },
          onload: null,
          onerror: null,
        };
      });

      document.head.appendChild = jest.fn((node) => {
        appendedNodes.push(node);
        // Microtask so `await loadLamejs()` returns control to the test.
        queueMicrotask(() => onAppend(node));
        return node;
      });
    }

    beforeEach(() => {
      appendedNodes = [];
      originalAppendChild = document.head.appendChild.bind(document.head);
    });

    afterEach(() => {
      document.head.appendChild = originalAppendChild;
    });

    it('appends a script tag pointing at the CDN, awaits onload, and resolves', async () => {
      const { Mp3Encoder } = makeMp3EncoderFactory();
      window.AudioContext = installAudioContext().ctor;

      stubLamejsLoader({
        onAppend: (script) => {
          // The real CDN bundle would set window.lamejs on load; emulate that.
          window.lamejs = { Mp3Encoder };
          script.onload();
        },
      });

      const result = await audioToMp3Blob([{ type: 'audio/webm' }]);

      expect(appendedNodes).toHaveLength(1);
      expect(appendedNodes[0].src).toBe(
        'https://cdn.cloud.weni.ai/npmjs/lamejs@1.2.1.min.js',
      );
      expect(result.type).toBe('audio/mp3');
    });

    it('rejects with the documented error when the script fails to load', async () => {
      window.AudioContext = installAudioContext().ctor;

      stubLamejsLoader({
        onAppend: (script) => {
          script.onerror();
        },
      });

      await expect(audioToMp3Blob([{ type: 'audio/webm' }])).rejects.toThrow(
        'Failed to load lamejs library.',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Encoder loop branches: empty encoded buffers should be skipped, non-empty
  // ones should be appended; same for the trailing flush().
  // -------------------------------------------------------------------------
  describe('encoder loop branches', () => {
    it('skips empty encoded chunks but keeps non-empty ones', async () => {
      // pcm just under one bufferSize (1152 samples) -> single encodeBuffer call,
      // but we feed > 1152 to trigger two iterations: first returns non-empty,
      // second returns empty (skip), then flush returns non-empty.
      const channelData = new Float32Array(2400); // 3 iterations of bufferSize 1152
      window.AudioContext = installAudioContext({ channelData }).ctor;

      const { Mp3Encoder, encodeCalls } = makeMp3EncoderFactory({
        encodeReturns: [
          new Int8Array([10, 20]), // first chunk — pushed
          new Int8Array([]), // empty — skipped
          new Int8Array([30]), // third chunk — pushed
        ],
        flushReturn: new Int8Array([99]),
      });
      window.lamejs = { Mp3Encoder };

      const result = await audioToMp3Blob([{ type: 'audio/webm' }]);

      expect(encodeCalls).toHaveLength(3);
      // Final blob receives every non-empty buffer + flush.
      const outputBlob = FakeBlob.instances[FakeBlob.instances.length - 1];
      expect(outputBlob.parts).toHaveLength(3); // 2 encoded + 1 flush
      expect(result.type).toBe('audio/mp3');
    });

    it('skips an empty flush buffer (does not append)', async () => {
      window.AudioContext = installAudioContext({
        channelData: new Float32Array([0.1]),
      }).ctor;
      const { Mp3Encoder } = makeMp3EncoderFactory({
        encodeReturns: [new Int8Array([1, 2])],
        flushReturn: new Int8Array([]), // empty flush — must not be appended
      });
      window.lamejs = { Mp3Encoder };

      await audioToMp3Blob([{ type: 'audio/webm' }]);

      const outputBlob = FakeBlob.instances[FakeBlob.instances.length - 1];
      expect(outputBlob.parts).toHaveLength(1); // only the encodeBuffer result
    });

    it('clamps PCM samples outside [-1, 1] to the Int16 boundaries', async () => {
      const channelData = new Float32Array([-2, -0.5, 0, 0.5, 2]);
      window.AudioContext = installAudioContext({ channelData }).ctor;

      const { Mp3Encoder, encodeCalls } = makeMp3EncoderFactory();
      window.lamejs = { Mp3Encoder };

      await audioToMp3Blob([{ type: 'audio/webm' }]);

      // The encoder receives a single Int16Array slice of length 5.
      const samples = encodeCalls[0];
      expect(samples).toBeInstanceOf(Int16Array);
      expect(samples.length).toBe(5);
      // -2 clamps to -1 -> -1 * 0x8000 = -32768
      expect(samples[0]).toBe(-32768);
      // 2 clamps to 1 -> 1 * 0x7fff = 32767
      expect(samples[4]).toBe(32767);
      // 0 -> 0 (positive branch since 0 is not < 0)
      expect(samples[2]).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error path: decodeAudioData rejects -> the catch branch rethrows.
  // -------------------------------------------------------------------------
  describe('error rethrow', () => {
    it('rethrows decoder failures verbatim', async () => {
      const error = new Error('decode boom');
      window.AudioContext = jest.fn().mockImplementation(() => ({
        decodeAudioData: jest.fn().mockRejectedValue(error),
      }));
      window.lamejs = {
        Mp3Encoder: jest.fn(),
      };

      await expect(audioToMp3Blob([{ type: 'audio/webm' }])).rejects.toBe(
        error,
      );
    });
  });
});
