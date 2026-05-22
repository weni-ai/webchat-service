import CameraRecorder from '../src/modules/CameraRecorder';
import { SERVICE_EVENTS } from '../src/utils/constants';

// ---------------------------------------------------------------------------
// Browser API mock helpers
//
// The shape mirrors tests/AudioRecorder.test.js so that anyone who knows one
// recorder test file can read the other immediately. Differences are limited
// to camera-specific concerns (track.getSettings().deviceId, mediaDevices
// .enumerateDevices, permissions.query({ name: 'camera' }), etc.).
// ---------------------------------------------------------------------------

/**
 * Returns a MediaStreamTrack-like object whose `stop` is a jest spy and whose
 * `getSettings()` returns the configured `deviceId`. The recorder reads
 * `getTracks().at(0).getSettings().deviceId` to populate `currentDeviceId`.
 */
function makeTrack({ deviceId = 'cam-default' } = {}) {
  return {
    stop: jest.fn(),
    getSettings: jest.fn(() => ({ deviceId })),
  };
}

/**
 * Returns a MediaStream-like object backed by the supplied tracks. Defaults
 * to a single track with `deviceId: 'cam-default'`.
 */
function makeCameraStream(tracks = [makeTrack()]) {
  return {
    _tracks: tracks,
    getTracks: jest.fn(() => tracks),
  };
}

/**
 * Stubs `navigator.mediaDevices.getUserMedia` to resolve or reject with the
 * given values. Creates the `mediaDevices` shim if it has been removed.
 * Returns the spy so tests can assert on the requested constraints.
 */
function installGetUserMedia({ resolveWith, rejectWith } = {}) {
  const spy = jest.fn().mockImplementation(() => {
    if (rejectWith) return Promise.reject(rejectWith);
    return Promise.resolve(resolveWith || makeCameraStream());
  });
  if (!global.navigator.mediaDevices) {
    global.navigator.mediaDevices = {};
  }
  global.navigator.mediaDevices.getUserMedia = spy;
  return spy;
}

/**
 * Stubs `navigator.mediaDevices.enumerateDevices`. Defaults to an empty list
 * (no devices), so tests that don't care about device enumeration still
 * resolve cleanly through start()'s fire-and-forget _enumerateDevices() call.
 */
function installEnumerateDevices({ resolveWith, rejectWith } = {}) {
  const spy = jest.fn().mockImplementation(() => {
    if (rejectWith) return Promise.reject(rejectWith);
    return Promise.resolve(resolveWith || []);
  });
  if (!global.navigator.mediaDevices) {
    global.navigator.mediaDevices = {};
  }
  global.navigator.mediaDevices.enumerateDevices = spy;
  return spy;
}

/**
 * Removes the `mediaDevices` shim from `navigator`. Used to drive the
 * unsupported-environment branches of `isSupported()` and
 * `requestPermission()`.
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
 * match (NotAllowedError / NotFoundError / NotReadableError / generic).
 */
function makeNamedError(name, message = name) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/**
 * Returns a fresh CameraRecorder. The CameraRecorder constructor takes no
 * arguments, but `WeniWebchatService` currently passes `this.config` (which
 * is silently ignored). The default factory matches normal usage; tests that
 * need to assert the "ignored argument" contract instantiate the class
 * directly.
 */
function createRecorder() {
  return new CameraRecorder();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CameraRecorder', () => {
  let originalNavigator;

  beforeAll(() => {
    originalNavigator = {
      mediaDevices: global.navigator.mediaDevices,
      permissions: global.navigator.permissions,
    };
  });

  afterAll(() => {
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
    installGetUserMedia();
    installEnumerateDevices();
    installPermissions({ resolveWith: { state: 'prompt' } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

    it('initializes runtime state to safe defaults', () => {
      const recorder = createRecorder();

      expect(recorder.cameraStream).toBeNull();
      expect(recorder.devices).toEqual([]);
      expect(recorder.currentDeviceId).toBeNull();
    });

    it('ignores any constructor argument (matches src/index.js usage that passes service config)', () => {
      const recorder = new CameraRecorder({ anything: 'goes' });

      expect(recorder.cameraStream).toBeNull();
      expect(recorder.devices).toEqual([]);
      expect(recorder.currentDeviceId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // B. isSupported (static)
  // -------------------------------------------------------------------------
  describe('isSupported (static)', () => {
    it('returns true when navigator.mediaDevices.getUserMedia exists', () => {
      installGetUserMedia();
      expect(CameraRecorder.isSupported()).toBe(true);
    });

    it('returns false when navigator.mediaDevices is missing', () => {
      removeMediaDevices();
      expect(CameraRecorder.isSupported()).toBe(false);
    });

    it('returns false when getUserMedia is missing on mediaDevices', () => {
      global.navigator.mediaDevices = {};
      expect(CameraRecorder.isSupported()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // C. start()
  // -------------------------------------------------------------------------
  describe('start', () => {
    it('requests video access with `{ video: true }` when no deviceId is supplied', async () => {
      const getUserMedia = installGetUserMedia();
      const recorder = createRecorder();

      await recorder.start();

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(getUserMedia).toHaveBeenCalledWith({ video: true });
    });

    it('requests an exact deviceId when one is supplied', async () => {
      const getUserMedia = installGetUserMedia();
      const recorder = createRecorder();

      await recorder.start({ deviceId: 'cam-x' });

      expect(getUserMedia).toHaveBeenCalledWith({
        video: { deviceId: { exact: 'cam-x' } },
      });
    });

    it('falls back to `{ video: true }` when called with an empty deviceId', async () => {
      const getUserMedia = installGetUserMedia();
      const recorder = createRecorder();

      await recorder.start({ deviceId: '' });

      expect(getUserMedia).toHaveBeenCalledWith({ video: true });
    });

    it("captures cameraStream and currentDeviceId from the first track's getSettings()", async () => {
      const stream = makeCameraStream([makeTrack({ deviceId: 'cam-99' })]);
      installGetUserMedia({ resolveWith: stream });

      const recorder = createRecorder();
      await recorder.start();

      expect(recorder.cameraStream).toBe(stream);
      expect(recorder.currentDeviceId).toBe('cam-99');
    });

    it('stops the existing stream before requesting a fresh one', async () => {
      const recorder = createRecorder();
      const previousTracks = [makeTrack(), makeTrack()];
      recorder.cameraStream = makeCameraStream(previousTracks);

      installGetUserMedia({ resolveWith: makeCameraStream() });

      await recorder.start();

      previousTracks.forEach((track) => {
        expect(track.stop).toHaveBeenCalledTimes(1);
      });
    });

    it('emits CAMERA_STREAM_RECEIVED with the new stream and CAMERA_RECORDING_STARTED with no payload', async () => {
      const stream = makeCameraStream();
      installGetUserMedia({ resolveWith: stream });

      const recorder = createRecorder();
      const onStream = jest.fn();
      const onStarted = jest.fn();
      recorder.on(SERVICE_EVENTS.CAMERA_STREAM_RECEIVED, onStream);
      recorder.on(SERVICE_EVENTS.CAMERA_RECORDING_STARTED, onStarted);

      await recorder.start();

      expect(onStream).toHaveBeenCalledTimes(1);
      expect(onStream).toHaveBeenCalledWith(stream);
      expect(onStarted).toHaveBeenCalledTimes(1);
      expect(onStarted).toHaveBeenCalledWith();
    });

    it('triggers _enumerateDevices and emits CAMERA_DEVICES_CHANGED with the mapped video inputs', async () => {
      installEnumerateDevices({
        resolveWith: [
          { kind: 'audioinput', deviceId: 'mic-1', label: 'Mic 1' },
          { kind: 'videoinput', deviceId: 'cam-1', label: 'Cam 1' },
          { kind: 'videoinput', deviceId: 'cam-2', label: 'Cam 2' },
        ],
      });

      const recorder = createRecorder();
      // start() does NOT await _enumerateDevices(), so the
      // CAMERA_DEVICES_CHANGED emission happens later in the microtask queue.
      // Listening once+await is the only race-free way to wait for it.
      const devicesChanged = new Promise((resolve) =>
        recorder.once(SERVICE_EVENTS.CAMERA_DEVICES_CHANGED, resolve),
      );

      await recorder.start();
      const devices = await devicesChanged;

      expect(devices).toEqual([
        { id: 'cam-1', label: 'Cam 1' },
        { id: 'cam-2', label: 'Cam 2' },
      ]);
      expect(recorder.devices).toEqual(devices);
    });

    it('on getUserMedia rejection: cameraStream stays null, ERROR is emitted, and the error is rethrown', async () => {
      const denial = makeNamedError('NotAllowedError', 'denied by user');
      installGetUserMedia({ rejectWith: denial });

      const recorder = createRecorder();
      const onError = jest.fn();
      recorder.on(SERVICE_EVENTS.ERROR, onError);

      await expect(recorder.start()).rejects.toBe(denial);

      expect(recorder.cameraStream).toBeNull();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(denial);
    });

    it('does NOT emit CAMERA_STREAM_RECEIVED or CAMERA_RECORDING_STARTED when getUserMedia rejects', async () => {
      installGetUserMedia({
        rejectWith: makeNamedError('NotAllowedError'),
      });

      const recorder = createRecorder();
      const onStream = jest.fn();
      const onStarted = jest.fn();
      recorder.on(SERVICE_EVENTS.CAMERA_STREAM_RECEIVED, onStream);
      recorder.on(SERVICE_EVENTS.CAMERA_RECORDING_STARTED, onStarted);

      await expect(recorder.start()).rejects.toBeDefined();

      expect(onStream).not.toHaveBeenCalled();
      expect(onStarted).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // D. switchToNextDevice
  //
  // switchToNextDevice() does NOT await this.start(), so the cleanest way to
  // assert the contract is to spy on `start` with mockResolvedValue() and
  // verify the deviceId it was invoked with. Driving the real start() flow
  // would also work, but it would couple this block to start()'s own tests.
  // -------------------------------------------------------------------------
  describe('switchToNextDevice', () => {
    it('throws "No devices found" when devices is empty', async () => {
      const recorder = createRecorder();
      recorder.devices = [];

      await expect(recorder.switchToNextDevice()).rejects.toThrow(
        'No devices found',
      );
    });

    it('throws "No devices found" when devices is null', async () => {
      const recorder = createRecorder();
      recorder.devices = null;

      await expect(recorder.switchToNextDevice()).rejects.toThrow(
        'No devices found',
      );
    });

    it('starts with devices[0] when currentDeviceId does not match any device', async () => {
      const recorder = createRecorder();
      recorder.devices = [
        { id: 'cam-1', label: 'Cam 1' },
        { id: 'cam-2', label: 'Cam 2' },
      ];
      recorder.currentDeviceId = 'cam-unknown';

      const startSpy = jest.spyOn(recorder, 'start').mockResolvedValue();

      await recorder.switchToNextDevice();

      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(startSpy).toHaveBeenCalledWith({ deviceId: 'cam-1' });
    });

    it('starts with the next device when currentDeviceId is in the middle of the list', async () => {
      const recorder = createRecorder();
      recorder.devices = [
        { id: 'cam-1', label: 'Cam 1' },
        { id: 'cam-2', label: 'Cam 2' },
        { id: 'cam-3', label: 'Cam 3' },
      ];
      recorder.currentDeviceId = 'cam-2';

      const startSpy = jest.spyOn(recorder, 'start').mockResolvedValue();

      await recorder.switchToNextDevice();

      expect(startSpy).toHaveBeenCalledWith({ deviceId: 'cam-3' });
    });

    it('wraps around from the last device back to the first', async () => {
      const recorder = createRecorder();
      recorder.devices = [
        { id: 'cam-1', label: 'Cam 1' },
        { id: 'cam-2', label: 'Cam 2' },
      ];
      recorder.currentDeviceId = 'cam-2';

      const startSpy = jest.spyOn(recorder, 'start').mockResolvedValue();

      await recorder.switchToNextDevice();

      expect(startSpy).toHaveBeenCalledWith({ deviceId: 'cam-1' });
    });
  });

  // -------------------------------------------------------------------------
  // E. stop()
  // -------------------------------------------------------------------------
  describe('stop', () => {
    it('emits CAMERA_RECORDING_STOPPED and tears down the open stream', async () => {
      const tracks = [makeTrack(), makeTrack()];
      const stream = makeCameraStream(tracks);
      installGetUserMedia({ resolveWith: stream });

      const recorder = createRecorder();
      const stopped = jest.fn();
      recorder.on(SERVICE_EVENTS.CAMERA_RECORDING_STOPPED, stopped);

      await recorder.start();
      await recorder.stop();

      tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1));
      expect(recorder.cameraStream).toBeNull();
      expect(stopped).toHaveBeenCalledTimes(1);
    });

    it('still emits CAMERA_RECORDING_STOPPED when no stream is open (idempotent)', async () => {
      const recorder = createRecorder();
      const stopped = jest.fn();
      recorder.on(SERVICE_EVENTS.CAMERA_RECORDING_STOPPED, stopped);

      await expect(recorder.stop()).resolves.toBeUndefined();

      expect(stopped).toHaveBeenCalledTimes(1);
      expect(recorder.cameraStream).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // F. hasPermission
  // -------------------------------------------------------------------------
  describe('hasPermission', () => {
    it('queries the Permissions API with `{ name: "camera" }`', async () => {
      const query = installPermissions({ resolveWith: { state: 'granted' } });
      const recorder = createRecorder();

      await recorder.hasPermission();

      expect(query).toHaveBeenCalledWith({ name: 'camera' });
    });

    it('returns true when the Permissions API reports "granted"', async () => {
      installPermissions({ resolveWith: { state: 'granted' } });
      const recorder = createRecorder();

      await expect(recorder.hasPermission()).resolves.toBe(true);
    });

    it('returns false when the Permissions API reports "denied"', async () => {
      installPermissions({ resolveWith: { state: 'denied' } });
      const recorder = createRecorder();

      await expect(recorder.hasPermission()).resolves.toBe(false);
    });

    it('returns undefined when the Permissions API reports "prompt"', async () => {
      installPermissions({ resolveWith: { state: 'prompt' } });
      const recorder = createRecorder();

      await expect(recorder.hasPermission()).resolves.toBeUndefined();
    });

    it('returns undefined when navigator.permissions.query rejects', async () => {
      installPermissions({ rejectWith: new Error('not supported') });
      const recorder = createRecorder();

      await expect(recorder.hasPermission()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // G. requestPermission
  //
  // NOTE: requestPermission() ends with `finally { return await
  // this.hasPermission(); }`. The `return` inside `finally` intentionally
  // (per the current contract, mirrored 1:1 in AudioRecorder) swallows every
  // `throw new Error(...)` in the catch block and resolves the function with
  // the result of hasPermission(). These tests therefore document the
  // observable behavior: no rejection bubbles out of requestPermission()
  // once it begins (the only synchronous throw is the not-supported guard).
  // -------------------------------------------------------------------------
  describe('requestPermission', () => {
    it('throws synchronously when the browser does not support recording', async () => {
      removeMediaDevices();
      const recorder = createRecorder();

      await expect(recorder.requestPermission()).rejects.toThrow(
        'Camera recording is not supported in this browser',
      );
    });

    it('requests `{ video: true }` and tears the stream down before resolving', async () => {
      const tracks = [makeTrack()];
      const stream = makeCameraStream(tracks);
      const getUserMedia = installGetUserMedia({ resolveWith: stream });
      installPermissions({ resolveWith: { state: 'granted' } });

      const recorder = createRecorder();

      const result = await recorder.requestPermission();

      expect(getUserMedia).toHaveBeenCalledWith({ video: true });
      tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1));
      expect(recorder.cameraStream).toBeNull();
      expect(result).toBe(true);
    });

    it('stops any pre-existing camera stream before requesting a fresh one', async () => {
      const existingTracks = [makeTrack(), makeTrack()];
      const existingStream = makeCameraStream(existingTracks);
      installGetUserMedia({ resolveWith: makeCameraStream() });
      installPermissions({ resolveWith: { state: 'granted' } });

      const recorder = createRecorder();
      recorder.cameraStream = existingStream;

      await recorder.requestPermission();

      existingTracks.forEach((track) =>
        expect(track.stop).toHaveBeenCalledTimes(1),
      );
    });

    it('on NotAllowedError: resolves via finally to the hasPermission() value and clears the stream', async () => {
      installGetUserMedia({ rejectWith: makeNamedError('NotAllowedError') });
      installPermissions({ resolveWith: { state: 'denied' } });

      const recorder = createRecorder();

      await expect(recorder.requestPermission()).resolves.toBe(false);
      expect(recorder.cameraStream).toBeNull();
    });

    it('on NotFoundError: resolves via finally to the hasPermission() value and clears the stream', async () => {
      installGetUserMedia({ rejectWith: makeNamedError('NotFoundError') });
      installPermissions({ resolveWith: { state: 'prompt' } });

      const recorder = createRecorder();
      recorder.cameraStream = makeCameraStream();

      await expect(recorder.requestPermission()).resolves.toBeUndefined();
      expect(recorder.cameraStream).toBeNull();
    });

    it('on NotReadableError: resolves via finally to the hasPermission() value', async () => {
      installGetUserMedia({ rejectWith: makeNamedError('NotReadableError') });
      installPermissions({ resolveWith: { state: 'granted' } });

      const recorder = createRecorder();

      await expect(recorder.requestPermission()).resolves.toBe(true);
      expect(recorder.cameraStream).toBeNull();
    });

    it('on a generic error: resolves via finally to the hasPermission() value', async () => {
      installGetUserMedia({
        rejectWith: makeNamedError('SomeUnknownError', 'boom'),
      });
      installPermissions({ resolveWith: { state: 'denied' } });

      const recorder = createRecorder();

      await expect(recorder.requestPermission()).resolves.toBe(false);
      expect(recorder.cameraStream).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // H. _stopCameraStream (private)
  // -------------------------------------------------------------------------
  describe('_stopCameraStream', () => {
    it('is a no-op when no stream is open', () => {
      const recorder = createRecorder();

      expect(() => recorder._stopCameraStream()).not.toThrow();
      expect(recorder.cameraStream).toBeNull();
    });

    it('stops every track and nulls the stream reference', () => {
      const tracks = [makeTrack(), makeTrack(), makeTrack()];
      const stream = makeCameraStream(tracks);

      const recorder = createRecorder();
      recorder.cameraStream = stream;

      recorder._stopCameraStream();

      tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1));
      expect(recorder.cameraStream).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // I. _enumerateDevices (called directly to exercise the resolve/reject
  //    branches without producing an unhandled rejection inside start()).
  // -------------------------------------------------------------------------
  describe('_enumerateDevices', () => {
    it('filters to videoinput devices, maps deviceId/label, and emits CAMERA_DEVICES_CHANGED', async () => {
      installEnumerateDevices({
        resolveWith: [
          { kind: 'audioinput', deviceId: 'mic-1', label: 'Mic 1' },
          { kind: 'videoinput', deviceId: 'cam-1', label: 'Cam 1' },
          { kind: 'videooutput', deviceId: 'tv-1', label: 'TV 1' },
          { kind: 'videoinput', deviceId: 'cam-2', label: 'Cam 2' },
        ],
      });

      const recorder = createRecorder();
      const onChanged = jest.fn();
      recorder.on(SERVICE_EVENTS.CAMERA_DEVICES_CHANGED, onChanged);

      await recorder._enumerateDevices();

      const expected = [
        { id: 'cam-1', label: 'Cam 1' },
        { id: 'cam-2', label: 'Cam 2' },
      ];
      expect(recorder.devices).toEqual(expected);
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(onChanged).toHaveBeenCalledWith(expected);
    });

    it('emits an empty list and leaves devices = [] when there are no video inputs', async () => {
      installEnumerateDevices({
        resolveWith: [
          { kind: 'audioinput', deviceId: 'mic-1', label: 'Mic 1' },
        ],
      });

      const recorder = createRecorder();
      const onChanged = jest.fn();
      recorder.on(SERVICE_EVENTS.CAMERA_DEVICES_CHANGED, onChanged);

      await recorder._enumerateDevices();

      expect(recorder.devices).toEqual([]);
      expect(onChanged).toHaveBeenCalledWith([]);
    });

    it('rejects with a wrapped error when navigator.mediaDevices.enumerateDevices throws', async () => {
      installEnumerateDevices({ rejectWith: new Error('boom') });
      const recorder = createRecorder();

      await expect(recorder._enumerateDevices()).rejects.toThrow(
        'Failed to enumerate devices:',
      );
    });
  });
});
