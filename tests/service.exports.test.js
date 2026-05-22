import WeniWebchatService, {
  ALLOWED_FILE_TYPES,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_AUDIO_TYPES,
  ALLOWED_DOCUMENT_TYPES,
  MESSAGE_TYPES,
  MESSAGE_STATUS,
  MESSAGE_DIRECTIONS,
  CONNECTION_STATUS,
  STORAGE_TYPES,
  ERROR_TYPES,
  QUICK_REPLY_TYPES,
  SERVICE_EVENTS,
  DEFAULTS,
} from '../src/index';

import * as Constants from '../src/utils/constants';
import AudioRecorder from '../src/modules/AudioRecorder';

describe('WeniWebchatService — public surface', () => {
  describe('static class properties', () => {
    it.each([
      ['ALLOWED_FILE_TYPES', 'ALLOWED_FILE_TYPES'],
      ['ALLOWED_IMAGE_TYPES', 'ALLOWED_IMAGE_TYPES'],
      ['ALLOWED_VIDEO_TYPES', 'ALLOWED_VIDEO_TYPES'],
      ['ALLOWED_AUDIO_TYPES', 'ALLOWED_AUDIO_TYPES'],
      ['ALLOWED_DOCUMENT_TYPES', 'ALLOWED_DOCUMENT_TYPES'],
      ['MESSAGE_TYPES', 'MESSAGE_TYPES'],
      ['MESSAGE_STATUS', 'MESSAGE_STATUS'],
      ['MESSAGE_DIRECTIONS', 'MESSAGE_DIRECTIONS'],
      ['CONNECTION_STATUS', 'CONNECTION_STATUS'],
      ['STORAGE_TYPES', 'STORAGE_TYPES'],
      ['ERROR_TYPES', 'ERROR_TYPES'],
      ['QUICK_REPLY_TYPES', 'QUICK_REPLY_TYPES'],
      ['SERVICE_EVENTS', 'SERVICE_EVENTS'],
      ['DEFAULTS', 'DEFAULTS'],
    ])('exposes %s as a static property identical to constants.%s', (key) => {
      expect(WeniWebchatService[key]).toBe(Constants[key]);
    });

    it('exposes AudioRecorder.isSupported as a static method', () => {
      expect(WeniWebchatService.isAudioRecordingSupported).toBe(
        AudioRecorder.isSupported,
      );
    });
  });

  describe('named re-exports from src/index', () => {
    it('re-exports ALLOWED_FILE_TYPES identical to constants', () => {
      expect(ALLOWED_FILE_TYPES).toBe(Constants.ALLOWED_FILE_TYPES);
    });

    it('re-exports ALLOWED_IMAGE_TYPES identical to constants', () => {
      expect(ALLOWED_IMAGE_TYPES).toBe(Constants.ALLOWED_IMAGE_TYPES);
    });

    it('re-exports ALLOWED_VIDEO_TYPES identical to constants', () => {
      expect(ALLOWED_VIDEO_TYPES).toBe(Constants.ALLOWED_VIDEO_TYPES);
    });

    it('re-exports ALLOWED_AUDIO_TYPES identical to constants', () => {
      expect(ALLOWED_AUDIO_TYPES).toBe(Constants.ALLOWED_AUDIO_TYPES);
    });

    it('re-exports ALLOWED_DOCUMENT_TYPES identical to constants', () => {
      expect(ALLOWED_DOCUMENT_TYPES).toBe(Constants.ALLOWED_DOCUMENT_TYPES);
    });

    it('re-exports MESSAGE_TYPES identical to constants', () => {
      expect(MESSAGE_TYPES).toBe(Constants.MESSAGE_TYPES);
    });

    it('re-exports MESSAGE_STATUS identical to constants', () => {
      expect(MESSAGE_STATUS).toBe(Constants.MESSAGE_STATUS);
    });

    it('re-exports MESSAGE_DIRECTIONS identical to constants', () => {
      expect(MESSAGE_DIRECTIONS).toBe(Constants.MESSAGE_DIRECTIONS);
    });

    it('re-exports CONNECTION_STATUS identical to constants', () => {
      expect(CONNECTION_STATUS).toBe(Constants.CONNECTION_STATUS);
    });

    it('re-exports STORAGE_TYPES identical to constants', () => {
      expect(STORAGE_TYPES).toBe(Constants.STORAGE_TYPES);
    });

    it('re-exports ERROR_TYPES identical to constants', () => {
      expect(ERROR_TYPES).toBe(Constants.ERROR_TYPES);
    });

    it('re-exports QUICK_REPLY_TYPES identical to constants', () => {
      expect(QUICK_REPLY_TYPES).toBe(Constants.QUICK_REPLY_TYPES);
    });

    it('re-exports SERVICE_EVENTS identical to constants', () => {
      expect(SERVICE_EVENTS).toBe(Constants.SERVICE_EVENTS);
    });

    it('re-exports DEFAULTS identical to constants', () => {
      expect(DEFAULTS).toBe(Constants.DEFAULTS);
    });
  });

  describe('default export shape', () => {
    it('default export is a class with constructor name "WeniWebchatService"', () => {
      expect(typeof WeniWebchatService).toBe('function');
      expect(WeniWebchatService.name).toBe('WeniWebchatService');
    });

    it('exposes the documented public method surface', () => {
      const expectedMethods = [
        'init',
        'connect',
        'disconnect',
        'sendMessage',
        'sendOrder',
        'sendAttachment',
        'sendAudio',
        'getHistory',
        'getStarters',
        'clearStarters',
        'setContext',
        'getContext',
        'setCustomField',
        'getState',
        'getSession',
        'getMessages',
        'getSessionId',
        'setSessionId',
        'setIsChatOpen',
        'getIsChatOpen',
        'clearSession',
        'clearMessages',
        'restoreOrCreateSession',
        'createNewSession',
        'startCameraRecording',
        'stopCameraRecording',
        'hasCameraPermission',
        'requestCameraPermission',
        'switchToNextCameraDevice',
        'startRecording',
        'stopRecording',
        'cancelRecording',
        'hasAudioPermission',
        'requestAudioPermission',
        'getConnectionStatus',
        'isConnected',
        'isConnecting',
        'isReconnecting',
        'isRenderEnabled',
        'getRetryInfo',
        'getAllowedFileTypes',
        'getFileConfig',
        'resetRetryStrategy',
        'requestVoiceTokens',
        'addProductToCart',
        'destroy',
        'simulateMessageReceived',
        'simulateMessageSent',
        'addConversationStatus',
        'enqueueMessages',
        'runQueue',
      ];

      for (const name of expectedMethods) {
        expect(typeof WeniWebchatService.prototype[name]).toBe('function');
      }
    });
  });
});
