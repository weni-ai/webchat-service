import AudioRecorder from '../src/modules/AudioRecorder';
import {
  AUDIO_MIME_TYPES,
  DEFAULTS,
  SERVICE_EVENTS,
} from '../src/utils/constants';
import { audioToMp3Blob } from '../src/utils/MP3Converter';

// ---------------------------------------------------------------------------
// MP3Converter is a heavy browser-dependent module (loads lamejs via <script>,
// uses AudioContext). The AudioRecorder unit tests should only exercise the
// recorder's own behavior, so we stub the converter to a controllable jest.fn
// that resolves with a real jsdom Blob (which the recorder then hands to a
// real FileReader inside _blobToBase64).
// ---------------------------------------------------------------------------
jest.mock('../src/utils/MP3Converter', () => ({
  audioToMp3Blob: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Browser API mock helpers
// ---------------------------------------------------------------------------

/**
 * Returns a MediaStreamTrack-like object with a jest-spied `stop`.
 */
function makeTrack() {
  return { stop: jest.fn() };
}

/**
 * Returns a MediaStream-like object with a `getTracks` spy.
 */
function makeAudioStream(tracks = [makeTrack(), makeTrack()]) {
  return {
    _tracks: tracks,
    getTracks: jest.fn(() => tracks),
  };
}

/**
 * Returns a MediaRecorder-like instance whose `start`/`stop` transition the
 * `state` synchronously and whose `ondataavailable`/`onstop`/`onerror` slots
 * are nullable so tests can fire them manually.
 */
function makeRecorderInstance({ initialState = 'inactive' } = {}) {
  const instance = {
    state: initialState,
    start: jest.fn(function () {
      this.state = 'recording';
    }),
    stop: jest.fn(function () {
      this.state = 'inactive';
    }),
    ondataavailable: null,
    onstop: null,
    onerror: null,
  };
  return instance;
}

/**
 * Installs a `global.MediaRecorder` mock that records every constructed
 * instance and lets the test drive `isTypeSupported`.
 */
function installMediaRecorder({
  isTypeSupported = () => true,
  buildInstance,
} = {}) {
  const instances = [];
  const ctor = jest.fn().mockImplementation((stream, options) => {
    const instance = buildInstance
      ? buildInstance(stream, options)
      : makeRecorderInstance();
    instance._stream = stream;
    instance._options = options;
    instances.push(instance);
    return instance;
  });
  ctor.isTypeSupported = jest.fn(isTypeSupported);
  global.MediaRecorder = ctor;
  return { ctor, instances };
}

/**
 * Stubs `navigator.mediaDevices.getUserMedia` to resolve or reject with the
 * given values. Returns the spy.
 */
function installGetUserMedia({ resolveWith, rejectWith } = {}) {
  const spy = jest.fn().mockImplementation(() => {
    if (rejectWith) return Promise.reject(rejectWith);
    return Promise.resolve(resolveWith || makeAudioStream());
  });
  if (!global.navigator.mediaDevices) {
    global.navigator.mediaDevices = {};
  }
  global.navigator.mediaDevices.getUserMedia = spy;
  return spy;
}

/**
 * Removes the `mediaDevices` shim from `navigator`. Used to test the
 * unsupported-environment branch of `isSupported`/`requestPermission`.
 */
function removeMediaDevices() {
  delete global.navigator.mediaDevices;
}

/**
 * Stubs `navigator.permissions.query`. Pass `{ resolveWith: { state } }` for
 * the happy path or `{ rejectWith: err }` to simulate browsers without the
 * Permissions API for the requested name.
 */
function installPermissions({ resolveWith, rejectWith } = {}) {
  const spy = jest.fn().mockImplementation(() => {
    if (rejectWith) return Promise.reject(rejectWith);
    return Promise.resolve(resolveWith);
  });
  global.navigator.permissions = { query: spy };
  return spy;
}

/**
 * Builds a DOMException-like error so the recorder's `error.name` branches
 * match.
 */
function makeNamedError(name, message = name) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/**
 * Returns a fresh AudioRecorder with the browser globals already mocked.
 * Tests can override config / behavior on top of the defaults.
 */
function createRecorder(config = {}) {
  return new AudioRecorder(config);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AudioRecorder', () => {
  let originalMediaRecorder;
  let originalNavigator;

  beforeAll(() => {
    originalMediaRecorder = global.MediaRecorder;
    originalNavigator = {
      mediaDevices: global.navigator.mediaDevices,
      permissions: global.navigator.permissions,
    };
  });

  afterAll(() => {
    if (originalMediaRecorder) {
      global.MediaRecorder = originalMediaRecorder;
    } else {
      delete global.MediaRecorder;
    }
    if (originalNavigator.mediaDevices) {
      global.navigator.mediaDevices = originalNavigator.mediaDevices;
    } else {
      delete global.navigator.mediaDevices;
    }
    if (originalNavigator.permissions) {
      global.navigator.permissions = originalNavigator.permissions;
    } else {
      delete global.navigator.permissions;
    }
  });

  beforeEach(() => {
    jest.useFakeTimers();
    audioToMp3Blob.mockReset();
    audioToMp3Blob.mockResolvedValue(
      new Blob(['fake-mp3'], { type: 'audio/mpeg' }),
    );
    installMediaRecorder();
    installGetUserMedia();
    installPermissions({ resolveWith: { state: 'prompt' } });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.MediaRecorder;
    delete global.navigator.mediaDevices;
    delete global.navigator.permissions;
  });

  // -------------------------------------------------------------------------
  // A. Constructor + initial state
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('extends EventEmitter so consumers can on()/emit() against it', () => {
      const recorder = createRecorder();
      const handler = jest.fn();

      recorder.on('custom:event', handler);
      recorder.emit('custom:event', 'payload');

      expect(handler).toHaveBeenCalledWith('payload');
    });

    it('applies documented defaults from DEFAULTS / AUDIO_MIME_TYPES', () => {
      const recorder = createRecorder();

      expect(recorder.config.maxDuration).toBe(DEFAULTS.MAX_RECORDING_DURATION);
      expect(recorder.config.mimeType).toBe(AUDIO_MIME_TYPES[0]);
      expect(recorder.config.audioBitsPerSecond).toBe(
        DEFAULTS.AUDIO_BITS_PER_SECOND,
      );
    });

    it('honors caller overrides for every documented option', () => {
      const recorder = createRecorder({
        maxDuration: 5000,
        mimeType: 'audio/wav',
        audioBitsPerSecond: 96000,
      });

      expect(recorder.config.maxDuration).toBe(5000);
      expect(recorder.config.mimeType).toBe('audio/wav');
      expect(recorder.config.audioBitsPerSecond).toBe(96000);
    });

    it('preserves extra config keys via spread', () => {
      const recorder = createRecorder({ extra: 'value' });
      expect(recorder.config.extra).toBe('value');
    });

    it('initializes runtime state to safe defaults', () => {
      const recorder = createRecorder();

      expect(recorder.mediaRecorder).toBeNull();
      expect(recorder.audioStream).toBeNull();
      expect(recorder.audioChunks).toEqual([]);
      expect(recorder.startTime).toBeNull();
      expect(recorder.timerInterval).toBeNull();
      expect(recorder.isRecording).toBe(false);
    });

    it('accepts being instantiated with no arguments at all', () => {
      const recorder = new AudioRecorder();

      expect(recorder.config.maxDuration).toBe(DEFAULTS.MAX_RECORDING_DURATION);
      expect(recorder.config.mimeType).toBe(AUDIO_MIME_TYPES[0]);
      expect(recorder.config.audioBitsPerSecond).toBe(
        DEFAULTS.AUDIO_BITS_PER_SECOND,
      );
    });
  });

  // -------------------------------------------------------------------------
  // B. isSupported (static)
  // -------------------------------------------------------------------------
  describe('isSupported (static)', () => {
    it('returns true when navigator.mediaDevices.getUserMedia exists', () => {
      installGetUserMedia();
      expect(AudioRecorder.isSupported()).toBe(true);
    });

    it('returns false when navigator.mediaDevices is missing', () => {
      removeMediaDevices();
      expect(AudioRecorder.isSupported()).toBe(false);
    });

    it('returns false when getUserMedia is missing on mediaDevices', () => {
      global.navigator.mediaDevices = {};
      expect(AudioRecorder.isSupported()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // C. getDuration
  // -------------------------------------------------------------------------
  describe('getDuration', () => {
    it('returns 0 before any recording is started', () => {
      const recorder = createRecorder();
      expect(recorder.getDuration()).toBe(0);
    });

    it('returns the elapsed milliseconds since startTime', () => {
      const recorder = createRecorder();
      recorder.startTime = 1_000;

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(3_500);

      expect(recorder.getDuration()).toBe(2_500);
      nowSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // D. start()
  // -------------------------------------------------------------------------
  describe('start', () => {
    it('throws when a recording is already in progress', async () => {
      const recorder = createRecorder();
      recorder.isRecording = true;

      await expect(recorder.start()).rejects.toThrow(
        'Recording already in progress',
      );
    });

    it('requests microphone access with audio: true', async () => {
      const getUserMedia = installGetUserMedia();
      const recorder = createRecorder();

      await recorder.start();

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    });

    it('creates a MediaRecorder with the supported mime + configured bitrate', async () => {
      const stream = makeAudioStream();
      installGetUserMedia({ resolveWith: stream });
      const { ctor, instances } = installMediaRecorder({
        isTypeSupported: () => true,
      });

      const recorder = createRecorder({ audioBitsPerSecond: 64000 });

      await recorder.start();

      expect(ctor).toHaveBeenCalledTimes(1);
      expect(ctor).toHaveBeenCalledWith(stream, {
        mimeType: AUDIO_MIME_TYPES[0],
        audioBitsPerSecond: 64000,
      });
      expect(instances[0].start).toHaveBeenCalledTimes(1);
    });

    it('flips internal state, resets chunks and emits RECORDING_STARTED', async () => {
      const recorder = createRecorder();
      const started = jest.fn();
      recorder.on(SERVICE_EVENTS.RECORDING_STARTED, started);

      recorder.audioChunks = [{ size: 99 }];

      await recorder.start();

      expect(recorder.isRecording).toBe(true);
      expect(recorder.audioChunks).toEqual([]);
      expect(typeof recorder.startTime).toBe('number');
      expect(recorder.audioStream).not.toBeNull();
      expect(started).toHaveBeenCalledTimes(1);
    });

    it('starts the periodic tick timer (RECORDING_TICK every 100ms)', async () => {
      const recorder = createRecorder();
      const tick = jest.fn();
      recorder.on(SERVICE_EVENTS.RECORDING_TICK, tick);

      await recorder.start();

      jest.advanceTimersByTime(310);
      expect(tick).toHaveBeenCalledTimes(3);
    });

    it('appends chunks via ondataavailable only when size > 0', async () => {
      const { instances } = installMediaRecorder();
      const recorder = createRecorder();

      await recorder.start();

      const recorderInstance = instances[0];
      recorderInstance.ondataavailable({ data: { size: 0 } });
      recorderInstance.ondataavailable({ data: { size: 5 } });
      recorderInstance.ondataavailable({ data: { size: 12 } });

      expect(recorder.audioChunks).toHaveLength(2);
      expect(recorder.audioChunks[0]).toEqual({ size: 5 });
      expect(recorder.audioChunks[1]).toEqual({ size: 12 });
    });

    it('forwards underlying MediaRecorder errors as SERVICE_EVENTS.ERROR', async () => {
      const { instances } = installMediaRecorder();
      const recorder = createRecorder();
      const onError = jest.fn();
      recorder.on(SERVICE_EVENTS.ERROR, onError);

      await recorder.start();

      const recorderError = { name: 'EncodingError' };
      instances[0].onerror(recorderError);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(recorderError);
    });

    it('routes the onstop callback into _handleRecordingStop', async () => {
      const { instances } = installMediaRecorder();
      const recorder = createRecorder();
      const stopSpy = jest
        .spyOn(recorder, '_handleRecordingStop')
        .mockImplementation(() => Promise.resolve());

      await recorder.start();
      instances[0].onstop();

      expect(stopSpy).toHaveBeenCalledTimes(1);
    });

    it('auto-stops after maxDuration when the user has not stopped manually', async () => {
      const recorder = createRecorder({ maxDuration: 1_000 });
      const stopSpy = jest.spyOn(recorder, 'stop').mockResolvedValue();

      await recorder.start();
      jest.advanceTimersByTime(1_000);

      expect(stopSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT auto-stop after maxDuration once isRecording has flipped to false', async () => {
      const recorder = createRecorder({ maxDuration: 1_000 });
      await recorder.start();

      const stopSpy = jest.spyOn(recorder, 'stop').mockResolvedValue();
      recorder.isRecording = false;

      jest.advanceTimersByTime(1_000);

      expect(stopSpy).not.toHaveBeenCalled();
    });

    it('resets isRecording, emits ERROR and rethrows when getUserMedia fails', async () => {
      const denial = makeNamedError('NotAllowedError', 'denied by user');
      installGetUserMedia({ rejectWith: denial });

      const recorder = createRecorder();
      const onError = jest.fn();
      recorder.on(SERVICE_EVENTS.ERROR, onError);

      await expect(recorder.start()).rejects.toBe(denial);

      expect(recorder.isRecording).toBe(false);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(denial);
    });
  });

  // -------------------------------------------------------------------------
  // E. _getSupportedMimeType
  // -------------------------------------------------------------------------
  describe('_getSupportedMimeType (via start)', () => {
    it('picks the first MediaRecorder.isTypeSupported match from AUDIO_MIME_TYPES', async () => {
      const { ctor } = installMediaRecorder({
        isTypeSupported: (type) => type === 'audio/ogg',
      });
      const recorder = createRecorder();

      await recorder.start();

      expect(ctor).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mimeType: 'audio/ogg' }),
      );
    });

    it('falls back to config.mimeType when no AUDIO_MIME_TYPES entry is supported', async () => {
      const { ctor } = installMediaRecorder({
        isTypeSupported: () => false,
      });
      const recorder = createRecorder({ mimeType: 'audio/unknown' });

      await recorder.start();

      expect(ctor).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mimeType: 'audio/unknown' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // F. stop()
  // -------------------------------------------------------------------------
  describe('stop', () => {
    it('throws when no recording is in progress', async () => {
      const recorder = createRecorder();

      await expect(recorder.stop()).rejects.toThrow('No recording in progress');
    });

    it('calls mediaRecorder.stop(), stops the timer and tears down the stream', async () => {
      const stream = makeAudioStream();
      installGetUserMedia({ resolveWith: stream });
      const { instances } = installMediaRecorder();
      const recorder = createRecorder({ maxDuration: 60_000 });

      await recorder.start();

      const stopTimerSpy = jest.spyOn(recorder, '_stopTimer');
      const stopStreamSpy = jest.spyOn(recorder, '_stopAudioStream');

      recorder.stop();

      expect(instances[0].stop).toHaveBeenCalledTimes(1);
      expect(stopTimerSpy).toHaveBeenCalledTimes(1);
      expect(stopStreamSpy).toHaveBeenCalledTimes(1);
    });

    it('skips mediaRecorder.stop() when the recorder is already inactive', async () => {
      const { instances } = installMediaRecorder({
        buildInstance: () => makeRecorderInstance({ initialState: 'inactive' }),
      });
      const recorder = createRecorder();

      await recorder.start();
      instances[0].state = 'inactive';
      instances[0].stop.mockClear();

      recorder.stop();

      expect(instances[0].stop).not.toHaveBeenCalled();
    });

    it('resolves with the same payload emitted by RECORDING_STOPPED', async () => {
      audioToMp3Blob.mockResolvedValue(
        new Blob(['data'], { type: 'audio/mpeg' }),
      );

      const { instances } = installMediaRecorder();
      const recorder = createRecorder();
      const recordingStopped = jest.fn();
      recorder.on(SERVICE_EVENTS.RECORDING_STOPPED, recordingStopped);

      await recorder.start();

      const stopPromise = recorder.stop();
      instances[0].onstop();
      const result = await stopPromise;

      expect(result).toMatchObject({
        type: 'audio',
        mimeType: 'audio/mpeg',
      });
      expect(typeof result.base64).toBe('string');
      expect(result.base64.startsWith('data:')).toBe(true);
      expect(typeof result.duration).toBe('number');
      expect(typeof result.size).toBe('number');

      expect(recordingStopped).toHaveBeenCalledTimes(1);
      expect(recordingStopped).toHaveBeenCalledWith(result);
    });
  });

  // -------------------------------------------------------------------------
  // G. cancel()
  // -------------------------------------------------------------------------
  describe('cancel', () => {
    it('is a no-op when no recording is in progress', () => {
      const recorder = createRecorder();
      const cancelled = jest.fn();
      recorder.on(SERVICE_EVENTS.RECORDING_CANCELLED, cancelled);

      expect(() => recorder.cancel()).not.toThrow();
      expect(cancelled).not.toHaveBeenCalled();
    });

    it('clears state, stops the recorder/timer/stream and emits RECORDING_CANCELLED', async () => {
      const { instances } = installMediaRecorder();
      const recorder = createRecorder();
      const cancelled = jest.fn();
      recorder.on(SERVICE_EVENTS.RECORDING_CANCELLED, cancelled);

      await recorder.start();
      recorder.audioChunks.push({ size: 1 });

      const stopTimerSpy = jest.spyOn(recorder, '_stopTimer');
      const stopStreamSpy = jest.spyOn(recorder, '_stopAudioStream');

      recorder.cancel();

      expect(recorder.isRecording).toBe(false);
      expect(recorder.audioChunks).toEqual([]);
      expect(instances[0].stop).toHaveBeenCalledTimes(1);
      expect(stopTimerSpy).toHaveBeenCalledTimes(1);
      expect(stopStreamSpy).toHaveBeenCalledTimes(1);
      expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it('skips mediaRecorder.stop() when the recorder is already inactive', async () => {
      const { instances } = installMediaRecorder();
      const recorder = createRecorder();

      await recorder.start();
      instances[0].state = 'inactive';
      instances[0].stop.mockClear();

      recorder.cancel();

      expect(instances[0].stop).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // H. hasPermission
  // -------------------------------------------------------------------------
  describe('hasPermission', () => {
    it('returns true when Permissions API reports "granted"', async () => {
      const query = installPermissions({ resolveWith: { state: 'granted' } });
      const recorder = createRecorder();

      const result = await recorder.hasPermission();

      expect(query).toHaveBeenCalledWith({ name: 'microphone' });
      expect(result).toBe(true);
    });

    it('returns false when Permissions API reports "denied"', async () => {
      installPermissions({ resolveWith: { state: 'denied' } });
      const recorder = createRecorder();

      await expect(recorder.hasPermission()).resolves.toBe(false);
    });

    it('returns undefined when Permissions API reports "prompt"', async () => {
      installPermissions({ resolveWith: { state: 'prompt' } });
      const recorder = createRecorder();

      await expect(recorder.hasPermission()).resolves.toBeUndefined();
    });

    it('returns undefined when navigator.permissions.query throws', async () => {
      installPermissions({ rejectWith: new Error('not supported') });
      const recorder = createRecorder();

      await expect(recorder.hasPermission()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // I. requestPermission
  //
  // NOTE: requestPermission() ends with `finally { return await
  // this.hasPermission(); }`. The `return` inside `finally` intentionally (per
  // the current contract) swallows every `throw new Error(...)` in the catch
  // block and resolves the function with the result of hasPermission().
  // These tests therefore document the observable behavior: no rejection
  // bubbles out of requestPermission() once it begins (the only synchronous
  // throw is the not-supported guard).
  // -------------------------------------------------------------------------
  describe('requestPermission', () => {
    it('throws synchronously when the browser does not support recording', async () => {
      removeMediaDevices();
      const recorder = createRecorder();

      await expect(recorder.requestPermission()).rejects.toThrow(
        'Audio recording is not supported in this browser',
      );
    });

    it('requests full audio constraints (echo / noise / AGC)', async () => {
      const getUserMedia = installGetUserMedia();
      installPermissions({ resolveWith: { state: 'granted' } });

      const recorder = createRecorder();

      await recorder.requestPermission();

      expect(getUserMedia).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    });

    it('stops any pre-existing audio stream before requesting a fresh one', async () => {
      const existingStream = makeAudioStream();
      installGetUserMedia({ resolveWith: makeAudioStream() });
      installPermissions({ resolveWith: { state: 'granted' } });

      const recorder = createRecorder();
      recorder.audioStream = existingStream;

      await recorder.requestPermission();

      existingStream._tracks.forEach((track) => {
        expect(track.stop).toHaveBeenCalledTimes(1);
      });
    });

    it('resolves with the hasPermission() value on the happy path', async () => {
      installPermissions({ resolveWith: { state: 'granted' } });
      const recorder = createRecorder();

      await expect(recorder.requestPermission()).resolves.toBe(true);
    });

    it('on NotAllowedError: queries microphone permission and resolves via finally', async () => {
      const notAllowed = makeNamedError('NotAllowedError');
      installGetUserMedia({ rejectWith: notAllowed });
      const query = installPermissions({ resolveWith: { state: 'denied' } });

      const recorder = createRecorder();

      const result = await recorder.requestPermission();

      // permissions.query is called twice: once in the catch branch to
      // distinguish denied/prompt, then once again in the finally via
      // hasPermission().
      expect(query).toHaveBeenCalledWith({ name: 'microphone' });
      expect(query.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(recorder.audioStream).toBeNull();
      expect(result).toBe(false);
    });

    it('on NotAllowedError + permissions.query failure: still resolves via finally', async () => {
      installGetUserMedia({
        rejectWith: makeNamedError('NotAllowedError'),
      });
      installPermissions({ rejectWith: new Error('no Permissions API') });

      const recorder = createRecorder();

      await expect(recorder.requestPermission()).resolves.toBeUndefined();
      expect(recorder.audioStream).toBeNull();
    });

    it('on NotAllowedError + permissions.query "prompt": still resolves via finally', async () => {
      installGetUserMedia({
        rejectWith: makeNamedError('NotAllowedError'),
      });
      installPermissions({ resolveWith: { state: 'prompt' } });

      const recorder = createRecorder();

      await expect(recorder.requestPermission()).resolves.toBeUndefined();
    });

    it('on NotFoundError: resolves via finally and clears the stream', async () => {
      installGetUserMedia({ rejectWith: makeNamedError('NotFoundError') });
      installPermissions({ resolveWith: { state: 'prompt' } });

      const recorder = createRecorder();
      recorder.audioStream = makeAudioStream();

      await expect(recorder.requestPermission()).resolves.toBeUndefined();
      expect(recorder.audioStream).toBeNull();
    });

    it('on NotReadableError: resolves via finally', async () => {
      installGetUserMedia({ rejectWith: makeNamedError('NotReadableError') });
      installPermissions({ resolveWith: { state: 'granted' } });

      const recorder = createRecorder();

      await expect(recorder.requestPermission()).resolves.toBe(true);
    });

    it('on a generic error: resolves via finally', async () => {
      installGetUserMedia({
        rejectWith: makeNamedError('SomeUnknownError', 'boom'),
      });
      installPermissions({ resolveWith: { state: 'denied' } });

      const recorder = createRecorder();

      await expect(recorder.requestPermission()).resolves.toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // J. _handleRecordingStop (driven via mediaRecorder.onstop)
  // -------------------------------------------------------------------------
  describe('_handleRecordingStop', () => {
    it('emits RECORDING_STOPPED with the converted MP3 payload and resolves stop()', async () => {
      const mp3Blob = new Blob(['audio-data'], { type: 'audio/mpeg' });
      audioToMp3Blob.mockResolvedValue(mp3Blob);

      const { instances } = installMediaRecorder();
      const recorder = createRecorder();
      const stopped = jest.fn();
      recorder.on(SERVICE_EVENTS.RECORDING_STOPPED, stopped);

      await recorder.start();
      const stopPromise = recorder.stop();
      instances[0].onstop();
      const result = await stopPromise;

      expect(result.type).toBe('audio');
      expect(result.mimeType).toBe('audio/mpeg');
      expect(result.size).toBe(mp3Blob.size);
      expect(typeof result.base64).toBe('string');
      expect(result.base64).toMatch(/^data:audio\/mpeg;base64,/);
      expect(recorder.isRecording).toBe(false);

      expect(stopped).toHaveBeenCalledWith(result);
    });

    it('emits ERROR and resolves stop() with null when MP3 conversion fails', async () => {
      const conversionError = new Error('mp3 conversion exploded');
      audioToMp3Blob.mockRejectedValue(conversionError);

      const { instances } = installMediaRecorder();
      const recorder = createRecorder();
      const onError = jest.fn();
      recorder.on(SERVICE_EVENTS.ERROR, onError);

      await recorder.start();
      const stopPromise = recorder.stop();
      instances[0].onstop();
      const result = await stopPromise;

      expect(result).toBeNull();
      expect(onError).toHaveBeenCalledWith(conversionError);
    });

    it('emits ERROR without crashing when audioToMp3Blob fails outside of a stop() call', async () => {
      audioToMp3Blob.mockRejectedValue(new Error('conversion exploded'));

      const { instances } = installMediaRecorder();
      const recorder = createRecorder();

      // Capture both events so we can be sure the catch branch executed
      // (resolves the synchronization race against the async chain).
      const onError = new Promise((resolve) => {
        recorder.once(SERVICE_EVENTS.ERROR, resolve);
      });

      await recorder.start();
      // No recorder.stop() — _stopCompleteCallback is null here.
      instances[0].onstop();
      const error = await onError;

      expect(error.message).toBe('conversion exploded');
      expect(recorder.isRecording).toBe(false);
      expect(recorder._stopCompleteCallback).toBeUndefined();
    });

    it('emits ERROR and resolves stop() with null when FileReader errors out', async () => {
      const readerError = new Error('read failed');
      const recorder = createRecorder();
      jest.spyOn(recorder, '_blobToBase64').mockRejectedValue(readerError);

      const { instances } = installMediaRecorder();
      // installMediaRecorder reassigns global.MediaRecorder; reattach so the
      // recorder uses the fresh ctor on start().
      const onError = jest.fn();
      recorder.on(SERVICE_EVENTS.ERROR, onError);

      await recorder.start();
      const stopPromise = recorder.stop();
      instances[0].onstop();
      const result = await stopPromise;

      expect(result).toBeNull();
      expect(onError).toHaveBeenCalledWith(readerError);
    });

    it('does not throw when onstop fires without a pending stop() (no callback)', async () => {
      const { instances } = installMediaRecorder();
      const recorder = createRecorder();

      // The recorder runs an async chain inside _handleRecordingStop
      // (audioToMp3Blob → _blobToBase64) before emitting RECORDING_STOPPED.
      // Awaiting the emitted event is the only reliable way to know the
      // chain has settled regardless of microtask depth.
      const stopped = new Promise((resolve) => {
        recorder.once(SERVICE_EVENTS.RECORDING_STOPPED, resolve);
      });

      await recorder.start();
      instances[0].onstop();
      const result = await stopped;

      expect(recorder.isRecording).toBe(false);
      expect(result).toMatchObject({ type: 'audio' });
    });
  });

  // -------------------------------------------------------------------------
  // K. Timer helpers
  // -------------------------------------------------------------------------
  describe('_startTimer / _stopTimer', () => {
    it('emits RECORDING_TICK with the current duration every 100ms', () => {
      const recorder = createRecorder();
      const tick = jest.fn();
      recorder.on(SERVICE_EVENTS.RECORDING_TICK, tick);

      recorder.startTime = Date.now();
      recorder._startTimer();

      jest.advanceTimersByTime(250);

      expect(tick).toHaveBeenCalledTimes(2);
      expect(typeof tick.mock.calls[0][0]).toBe('number');

      recorder._stopTimer();
    });

    it('_startTimer() clears any previously scheduled interval', () => {
      const recorder = createRecorder();
      recorder.startTime = Date.now();

      recorder._startTimer();
      const firstHandle = recorder.timerInterval;
      recorder._startTimer();
      const secondHandle = recorder.timerInterval;

      expect(secondHandle).not.toBe(firstHandle);
      recorder._stopTimer();
    });

    it('_stopTimer() is a no-op when no interval is scheduled', () => {
      const recorder = createRecorder();

      expect(recorder.timerInterval).toBeNull();
      expect(() => recorder._stopTimer()).not.toThrow();
      expect(recorder.timerInterval).toBeNull();
    });

    it('_stopTimer() clears the interval and nulls the handle', () => {
      const recorder = createRecorder();
      recorder.startTime = Date.now();
      recorder._startTimer();

      expect(recorder.timerInterval).not.toBeNull();
      recorder._stopTimer();
      expect(recorder.timerInterval).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // L. _stopAudioStream
  // -------------------------------------------------------------------------
  describe('_stopAudioStream', () => {
    it('is a no-op when no stream is open', () => {
      const recorder = createRecorder();
      expect(() => recorder._stopAudioStream()).not.toThrow();
      expect(recorder.audioStream).toBeNull();
    });

    it('stops every track and nulls the stream reference', () => {
      const tracks = [makeTrack(), makeTrack(), makeTrack()];
      const stream = makeAudioStream(tracks);

      const recorder = createRecorder();
      recorder.audioStream = stream;

      recorder._stopAudioStream();

      tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1));
      expect(recorder.audioStream).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // M. _blobToBase64
  // -------------------------------------------------------------------------
  describe('_blobToBase64', () => {
    it('resolves with a base64 dataURL for the given blob', async () => {
      const recorder = createRecorder();
      const blob = new Blob(['hello'], { type: 'text/plain' });

      const result = await recorder._blobToBase64(blob);

      expect(typeof result).toBe('string');
      expect(result.startsWith('data:text/plain;base64,')).toBe(true);
    });

    it('rejects when the FileReader emits onerror', async () => {
      const readerError = new Error('reader failure');

      // The handlers are wired BEFORE readAsDataURL is called, so firing
      // them synchronously inside this stub is safe. Using
      // queueMicrotask/setTimeout would race against jest's fake timers.
      class FailingFileReader {
        constructor() {
          this.onloadend = null;
          this.onerror = null;
        }
        readAsDataURL() {
          this.onerror(readerError);
        }
      }

      const originalReader = global.FileReader;
      global.FileReader = FailingFileReader;

      try {
        const recorder = createRecorder();
        await expect(recorder._blobToBase64({})).rejects.toBe(readerError);
      } finally {
        global.FileReader = originalReader;
      }
    });
  });
});
