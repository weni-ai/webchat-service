import WeniWebchatService from '../src/index';
import AudioRecorder from '../src/modules/AudioRecorder';
import { installBrowserMocks, makeConfig } from './_helpers/serviceMocks';

describe('WeniWebchatService — recorder passthroughs', () => {
  let service;

  beforeEach(() => {
    installBrowserMocks();
    service = new WeniWebchatService(makeConfig());
  });

  afterEach(() => {
    if (service) {
      service.destroy();
      service = null;
    }
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------
  describe('camera', () => {
    it('startCameraRecording() delegates to cameraRecorder.start', async () => {
      const startSpy = jest
        .spyOn(service.cameraRecorder, 'start')
        .mockResolvedValue('camera-result');

      const result = await service.startCameraRecording();

      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('camera-result');
    });

    it('stopCameraRecording() delegates to cameraRecorder.stop', async () => {
      const stopSpy = jest
        .spyOn(service.cameraRecorder, 'stop')
        .mockResolvedValue('stopped');

      const result = await service.stopCameraRecording();

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe('stopped');
    });

    it('hasCameraPermission() delegates and returns the underlying value', async () => {
      const hasSpy = jest
        .spyOn(service.cameraRecorder, 'hasPermission')
        .mockResolvedValue(true);

      const result = await service.hasCameraPermission();

      expect(hasSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('requestCameraPermission() delegates and returns the underlying value', async () => {
      const requestSpy = jest
        .spyOn(service.cameraRecorder, 'requestPermission')
        .mockResolvedValue(false);

      const result = await service.requestCameraPermission();

      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe(false);
    });

    it('requestCameraPermission() rejects when underlying rejects', async () => {
      const denial = new Error('camera denied');
      jest
        .spyOn(service.cameraRecorder, 'requestPermission')
        .mockRejectedValue(denial);

      await expect(service.requestCameraPermission()).rejects.toBe(denial);
    });

    it('switchToNextCameraDevice() delegates to cameraRecorder.switchToNextDevice', async () => {
      const switchSpy = jest
        .spyOn(service.cameraRecorder, 'switchToNextDevice')
        .mockResolvedValue();

      await service.switchToNextCameraDevice();

      expect(switchSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Audio
  // ---------------------------------------------------------------------------
  describe('audio', () => {
    it('startRecording() delegates to audioRecorder.start', async () => {
      const startSpy = jest
        .spyOn(service.audioRecorder, 'start')
        .mockResolvedValue();

      await service.startRecording();

      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it('cancelRecording() delegates to audioRecorder.cancel', () => {
      const cancelSpy = jest
        .spyOn(service.audioRecorder, 'cancel')
        .mockImplementation(() => {});

      service.cancelRecording();

      expect(cancelSpy).toHaveBeenCalledTimes(1);
    });

    it('hasAudioPermission() delegates and returns the underlying value', async () => {
      const hasSpy = jest
        .spyOn(service.audioRecorder, 'hasPermission')
        .mockResolvedValue(true);

      const result = await service.hasAudioPermission();

      expect(hasSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('requestAudioPermission() delegates and returns the underlying value', async () => {
      const requestSpy = jest
        .spyOn(service.audioRecorder, 'requestPermission')
        .mockResolvedValue(false);

      const result = await service.requestAudioPermission();

      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe(false);
    });

    it('requestAudioPermission() rejects when underlying rejects', async () => {
      const denial = new Error('mic denied');
      jest
        .spyOn(service.audioRecorder, 'requestPermission')
        .mockRejectedValue(denial);

      await expect(service.requestAudioPermission()).rejects.toBe(denial);
    });

    it('stopRecording() awaits audioRecorder.stop and forwards the data through sendAudio', async () => {
      const audioData = {
        base64: 'data:audio/mpeg;base64,xxx',
        duration: 7,
        mimeType: 'audio/mpeg',
      };
      const stopSpy = jest
        .spyOn(service.audioRecorder, 'stop')
        .mockResolvedValue(audioData);
      const sendAudioSpy = jest.spyOn(service, 'sendAudio').mockResolvedValue();

      await service.stopRecording();

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(sendAudioSpy).toHaveBeenCalledWith(audioData);
    });

    it('stopRecording() rejects if sendAudio rejects', async () => {
      const audioData = {
        base64: 'x',
        duration: 1,
        mimeType: 'audio/mpeg',
      };
      jest.spyOn(service.audioRecorder, 'stop').mockResolvedValue(audioData);
      const boom = new Error('queue boom');
      jest.spyOn(service, 'sendAudio').mockRejectedValue(boom);

      await expect(service.stopRecording()).rejects.toBe(boom);
    });
  });

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------
  describe('static', () => {
    it('exposes AudioRecorder.isSupported as WeniWebchatService.isAudioRecordingSupported', () => {
      expect(WeniWebchatService.isAudioRecordingSupported).toBe(
        AudioRecorder.isSupported,
      );
    });

    it('returns a boolean from WeniWebchatService.isAudioRecordingSupported()', () => {
      expect(typeof WeniWebchatService.isAudioRecordingSupported()).toBe(
        'boolean',
      );
    });
  });
});
