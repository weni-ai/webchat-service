import { AudioCapture } from "../../src/modules/voice/AudioCapture";
import { VoiceError, VoiceErrorCode } from "../../src/modules/voice/errors";
import { AUDIO_CONSTANTS } from "../../src/utils/audioUtils";

// ---------------------------------------------------------------------------
// Browser API mocks
// ---------------------------------------------------------------------------

const createMockTrack = () => ({ stop: jest.fn(), kind: "audio" });

const createMockStream = (active = true) => {
  const tracks = [createMockTrack(), createMockTrack()];
  return {
    active,
    getTracks: jest.fn(() => tracks),
    _tracks: tracks,
  };
};

const createMockGainNode = () => ({
  gain: { value: 0 },
  connect: jest.fn(),
  disconnect: jest.fn(),
});

const createMockProcessorNode = () => ({
  onaudioprocess: null,
  connect: jest.fn(),
  disconnect: jest.fn(),
});

const createMockSourceNode = () => ({
  connect: jest.fn(),
  disconnect: jest.fn(),
});

const createMockAudioContext = (
  sampleRate = AUDIO_CONSTANTS.TARGET_SAMPLE_RATE,
) => ({
  sampleRate,
  state: "running",
  currentTime: 0,
  destination: {},
  createMediaStreamSource: jest.fn(() => createMockSourceNode()),
  createScriptProcessor: jest.fn(() => createMockProcessorNode()),
  createGain: jest.fn(() => createMockGainNode()),
  resume: jest.fn(() => Promise.resolve()),
  close: jest.fn(),
});

function installBrowserAPIs() {
  const mockAudioCtx = createMockAudioContext();
  window.AudioContext = jest.fn(() => mockAudioCtx);
  window.webkitAudioContext = undefined;

  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: jest.fn(() => Promise.resolve(createMockStream())),
    },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(navigator, "permissions", {
    value: {
      query: jest.fn(() => Promise.resolve({ state: "granted" })),
    },
    writable: true,
    configurable: true,
  });

  return mockAudioCtx;
}

function removeBrowserAPIs() {
  delete window.AudioContext;
  delete window.webkitAudioContext;
  Object.defineProperty(navigator, "mediaDevices", {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AudioCapture", () => {
  let capture;
  let mockAudioCtx;

  beforeEach(() => {
    jest.useFakeTimers();
    mockAudioCtx = installBrowserAPIs();
    capture = new AudioCapture();
  });

  afterEach(() => {
    capture.destroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // -- isSupported ----------------------------------------------------------

  describe("isSupported()", () => {
    it("returns true when getUserMedia and AudioContext exist", () => {
      expect(AudioCapture.isSupported()).toBe(true);
    });

    it("returns false when mediaDevices is missing", () => {
      removeBrowserAPIs();
      expect(AudioCapture.isSupported()).toBe(false);
    });

    it("returns true when only webkitAudioContext exists", () => {
      delete window.AudioContext;
      window.webkitAudioContext = jest.fn(() => mockAudioCtx);
      expect(AudioCapture.isSupported()).toBe(true);
    });
  });

  // -- requestPermission ----------------------------------------------------

  describe("requestPermission() (static)", () => {
    it("returns true when getUserMedia succeeds", async () => {
      const result = await AudioCapture.requestPermission();
      expect(result).toBe(true);
      const stream =
        await navigator.mediaDevices.getUserMedia.mock.results[0].value;
      expect(stream.getTracks).toHaveBeenCalled();
    });

    it("returns false when getUserMedia rejects", async () => {
      navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(
        new DOMException("denied", "NotAllowedError"),
      );
      const result = await AudioCapture.requestPermission();
      expect(result).toBe(false);
    });
  });

  // -- checkPermission ------------------------------------------------------

  describe("checkPermission()", () => {
    it("returns the permission state string", async () => {
      navigator.permissions.query.mockResolvedValueOnce({ state: "denied" });
      const result = await AudioCapture.checkPermission();
      expect(result).toBe("denied");
    });

    it('returns "prompt" when permissions API throws', async () => {
      navigator.permissions.query.mockRejectedValueOnce(
        new Error("unsupported"),
      );
      const result = await AudioCapture.checkPermission();
      expect(result).toBe("prompt");
    });
  });

  // -- start ----------------------------------------------------------------

  describe("start()", () => {
    it("creates AudioContext and calls getUserMedia with correct constraints", async () => {
      await capture.start();

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 16000 },
        },
      });
      expect(window.AudioContext).toHaveBeenCalled();
      expect(capture.isCapturing).toBe(true);
    });

    it("connects source → processor → mutedGain → destination", async () => {
      await capture.start();

      const src = mockAudioCtx.createMediaStreamSource.mock.results[0].value;
      const proc = mockAudioCtx.createScriptProcessor.mock.results[0].value;
      const gain = mockAudioCtx.createGain.mock.results[0].value;

      expect(src.connect).toHaveBeenCalledWith(proc);
      expect(proc.connect).toHaveBeenCalledWith(gain);
      expect(gain.connect).toHaveBeenCalledWith(mockAudioCtx.destination);
    });

    it("sets custom vadThreshold when provided", async () => {
      await capture.start({ vadThreshold: 0.05 });
      expect(capture.vadThreshold).toBe(0.05);
    });

    it("is a no-op when already capturing", async () => {
      await capture.start();
      navigator.mediaDevices.getUserMedia.mockClear();
      await capture.start();
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    });

    it("throws BROWSER_NOT_SUPPORTED when APIs are missing", async () => {
      removeBrowserAPIs();
      await expect(capture.start()).rejects.toThrow(VoiceError);
      await expect(capture.start()).rejects.toMatchObject({
        code: VoiceErrorCode.BROWSER_NOT_SUPPORTED,
      });
    });

    it("throws MICROPHONE_PERMISSION_DENIED when getUserMedia is denied", async () => {
      const err = new DOMException("Permission denied", "NotAllowedError");
      navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(err);

      await expect(capture.start()).rejects.toMatchObject({
        code: VoiceErrorCode.MICROPHONE_PERMISSION_DENIED,
      });
    });
  });

  // -- Audio processing (onaudioprocess) ------------------------------------

  describe("audio processing", () => {
    let processorNode;

    beforeEach(async () => {
      await capture.start();
      processorNode = mockAudioCtx.createScriptProcessor.mock.results[0].value;
    });

    function fireAudioProcess(samples) {
      const event = {
        inputBuffer: {
          getChannelData: jest.fn(() => new Float32Array(samples)),
        },
      };
      processorNode.onaudioprocess(event);
      return event;
    }

    it("emits audioData with base64 PCM when capturing", () => {
      const handler = jest.fn();
      capture.on("audioData", handler);

      fireAudioProcess([0.5, -0.5, 0.1, -0.1]);

      expect(handler).toHaveBeenCalledTimes(1);
      const payload = handler.mock.calls[0][0];
      expect(payload).toHaveProperty("data");
      expect(typeof payload.data).toBe("string");
      expect(payload).toHaveProperty(
        "sampleRate",
        AUDIO_CONSTANTS.TARGET_SAMPLE_RATE,
      );
      expect(payload).toHaveProperty("hasVoice");
    });

    it("does not emit when not capturing (paused)", () => {
      const handler = jest.fn();
      capture.on("audioData", handler);

      capture.pause();
      fireAudioProcess([0.5, -0.5]);

      expect(handler).not.toHaveBeenCalled();
    });

    it("resumes AudioContext if state is suspended", async () => {
      Object.defineProperty(mockAudioCtx, "state", {
        value: "suspended",
        configurable: true,
      });
      fireAudioProcess([0.1]);
      expect(mockAudioCtx.resume).toHaveBeenCalled();
    });
  });

  // -- Voice activity -------------------------------------------------------

  describe("voice activity detection", () => {
    let processorNode;

    beforeEach(async () => {
      await capture.start();
      processorNode = mockAudioCtx.createScriptProcessor.mock.results[0].value;
    });

    function fireAudioProcess(samples) {
      processorNode.onaudioprocess({
        inputBuffer: { getChannelData: () => new Float32Array(samples) },
      });
    }

    it("emits voiceActivity {speaking: true} on first voice frame", () => {
      const handler = jest.fn();
      capture.on("voiceActivity", handler);

      const loud = new Array(100).fill(0.9);
      fireAudioProcess(loud);

      expect(handler).toHaveBeenCalledWith({ speaking: true });
    });

    it("emits silenceDetected after speech followed by silence", () => {
      const silenceHandler = jest.fn();
      capture.on("silenceDetected", silenceHandler);

      const loud = new Array(100).fill(0.9);
      fireAudioProcess(loud);

      const silent = new Array(100).fill(0.0001);
      fireAudioProcess(silent);

      expect(silenceHandler).toHaveBeenCalledTimes(1);
      expect(silenceHandler.mock.calls[0][0]).toHaveProperty("duration");
    });

    it("does not emit voiceActivity twice for consecutive voice frames", () => {
      const handler = jest.fn();
      capture.on("voiceActivity", handler);

      const loud = new Array(100).fill(0.9);
      fireAudioProcess(loud);
      fireAudioProcess(loud);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // -- stop -----------------------------------------------------------------

  describe("stop()", () => {
    it("disconnects nodes, stops tracks, and closes context", async () => {
      await capture.start();

      const proc = mockAudioCtx.createScriptProcessor.mock.results[0].value;
      const src = mockAudioCtx.createMediaStreamSource.mock.results[0].value;
      const gain = mockAudioCtx.createGain.mock.results[0].value;
      const tracks = capture.stream._tracks;

      capture.stop();

      expect(proc.disconnect).toHaveBeenCalled();
      expect(src.disconnect).toHaveBeenCalled();
      expect(gain.disconnect).toHaveBeenCalled();
      expect(mockAudioCtx.close).toHaveBeenCalled();
      tracks.forEach((t) => {
        expect(t.stop).toHaveBeenCalled();
      });
      expect(capture.isCapturing).toBe(false);
    });
  });

  // -- pause / resume -------------------------------------------------------

  describe("pause() / resume()", () => {
    it("pause sets isCapturing to false", async () => {
      await capture.start();
      capture.pause();
      expect(capture.isCapturing).toBe(false);
    });

    it("resume sets isCapturing to true when stream is active", async () => {
      await capture.start();
      capture.pause();
      capture.resume();
      expect(capture.isCapturing).toBe(true);
    });

    it("resume does nothing when stream is not active", async () => {
      await capture.start();
      capture.pause();
      capture.stream.active = false;
      capture.resume();
      expect(capture.isCapturing).toBe(false);
    });
  });

  // -- destroy --------------------------------------------------------------

  describe("destroy()", () => {
    it("calls stop and removes all listeners", async () => {
      await capture.start();
      const handler = jest.fn();
      capture.on("audioData", handler);

      capture.destroy();

      expect(capture.isCapturing).toBe(false);
      expect(capture.listeners.size).toBe(0);
    });
  });

  // -- event emitter --------------------------------------------------------

  describe("event emitter", () => {
    it("on/off/emit work correctly", () => {
      const handler = jest.fn();
      capture.on("test", handler);
      capture.emit("test", "payload");
      expect(handler).toHaveBeenCalledWith("payload");

      capture.off("test", handler);
      capture.emit("test", "payload2");
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("off is safe for unknown events", () => {
      expect(() => capture.off("nonexistent", jest.fn())).not.toThrow();
    });

    it("listener errors are caught and do not propagate", () => {
      const badHandler = jest.fn(() => {
        throw new Error("boom");
      });
      const goodHandler = jest.fn();
      capture.on("test", badHandler);
      capture.on("test", goodHandler);

      expect(() => capture.emit("test", "data")).not.toThrow();
      expect(goodHandler).toHaveBeenCalledWith("data");
    });
  });

  // -- watchdog -------------------------------------------------------------

  describe("watchdog", () => {
    it("emits error and stops when stream becomes inactive", async () => {
      await capture.start();
      const errorHandler = jest.fn();
      capture.on("error", errorHandler);

      capture.stream.active = false;
      capture.lastAudioFrameTime = Date.now() - 5000;

      jest.advanceTimersByTime(3000);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0]).toBeInstanceOf(VoiceError);
      expect(errorHandler.mock.calls[0][0].code).toBe(
        VoiceErrorCode.MICROPHONE_NOT_FOUND,
      );
      expect(capture.isCapturing).toBe(false);
    });

    it("attempts to resume suspended AudioContext", async () => {
      await capture.start();
      Object.defineProperty(mockAudioCtx, "state", {
        value: "suspended",
        configurable: true,
      });
      capture.lastAudioFrameTime = Date.now() - 5000;

      jest.advanceTimersByTime(3000);

      expect(mockAudioCtx.resume).toHaveBeenCalled();
    });
  });
});
