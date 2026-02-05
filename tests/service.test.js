import WeniWebchatService from '../src/index';

describe('WeniWebchatService', () => {
  let service;

  beforeEach(() => {
    global.localStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
    };

    global.sessionStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
    };

    global.WebSocket = jest.fn().mockImplementation(() => ({
      send: jest.fn(),
      close: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      readyState: 1,
    }));
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
  });

  describe('Constructor', () => {
    it('should create service instance with valid config', () => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });

      expect(service).toBeInstanceOf(WeniWebchatService);
      expect(service.config.socketUrl).toBe('wss://test.example.com');
      expect(service.config.channelUuid).toBe('12345');
    });

    it('should throw error with invalid config', () => {
      expect(() => {
        new WeniWebchatService({});
      }).toThrow();
    });

    it('should use default config values', () => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });

      expect(service.config.storage).toBe('local');
      expect(service.config.connectOn).toBe('mount');
      expect(service.config.autoReconnect).toBe(true);
    });
  });

  describe('State Management', () => {
    beforeEach(() => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });
    });

    it('should get initial state', () => {
      const state = service.getState();

      expect(state).toHaveProperty('messages');
      expect(state).toHaveProperty('connection');
      expect(state).toHaveProperty('context');
      expect(state.messages).toEqual([]);
    });

    it('should set context', () => {
      service.setContext('test-context');
      expect(service.getContext()).toBe('test-context');
    });

    it('should emit context changed event', () => {
      const listener = jest.fn();
      service.on('context:changed', listener);

      service.setContext('new-context');

      expect(listener).toHaveBeenCalledWith('new-context');
    });
  });

  describe('Messages', () => {
    beforeEach(() => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });
    });

    it('should get empty messages initially', () => {
      const messages = service.getMessages();
      expect(messages).toEqual([]);
    });

    it('should validate message text', async () => {
      await expect(service.sendMessage('')).rejects.toThrow();
      await expect(service.sendMessage(null)).rejects.toThrow();
    });

    it('should clear messages while keeping session', () => {
      // Create a session first
      service.session.getOrCreate();
      const sessionId = service.getSessionId();

      // Add a message to state manually for testing
      service.state.addMessage({ id: 'test-msg-1', text: 'Hello' });
      service.state.addMessage({ id: 'test-msg-2', text: 'World' });

      expect(service.getMessages()).toHaveLength(2);

      // Clear messages
      service.clearMessages();

      // Messages should be cleared
      expect(service.getMessages()).toEqual([]);

      // Session should remain the same
      expect(service.getSessionId()).toBe(sessionId);
      expect(service.session.getSession()).not.toBeNull();
    });

    it('should emit messages:cleared event', () => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });

      const listener = jest.fn();
      service.on('messages:cleared', listener);

      service.clearMessages();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('Session', () => {
    beforeEach(() => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });
    });

    it('should generate session ID', () => {
      const sessionId = service.session.getOrCreate();
      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe('string');
    });

    it('should clear session', () => {
      service.session.getOrCreate();
      service.clearSession();

      const state = service.getState();
      expect(state.messages).toEqual([]);
    });

    it('should set session ID before initialization', () => {
      service.session.setSessionId('custom-session-id');
      expect(service.session.config.sessionId).toBe('custom-session-id');
    });

    it('should use custom session ID when creating new session', () => {
      const customId = '1234567890@custom.host';
      service.session.setSessionId(customId);
      service.session.createNewSession();

      expect(service.getSessionId()).toBe(customId);
    });

    it('should restart session with new ID when setSessionId is called on initialized service', async () => {
      // Initialize the service and create a session
      service.session.createNewSession();
      service._initialized = true;
      const originalSessionId = service.getSessionId();

      // Set a new session ID
      const newSessionId = '9999999999@new.host';
      await service.setSessionId(newSessionId);

      // Session should have the new ID
      expect(service.getSessionId()).toBe(newSessionId);
      expect(service.getSessionId()).not.toBe(originalSessionId);
    });

    it('should clear messages when setSessionId restarts session', async () => {
      // Initialize and add messages
      service.session.createNewSession();
      service._initialized = true;
      service.state.addMessage({ id: 'msg-1', text: 'Test' });

      expect(service.getMessages()).toHaveLength(1);

      // Set new session ID
      await service.setSessionId('1111111111@test.host');

      // Messages should be cleared
      expect(service.getMessages()).toEqual([]);
    });
  });

  describe('Connection Status', () => {
    beforeEach(() => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });
    });

    it('should return disconnected initially', () => {
      expect(service.getConnectionStatus()).toBe('disconnected');
      expect(service.isConnected()).toBe(false);
    });
  });

  describe('Audio Recording', () => {
    it('should check if audio recording is supported', () => {
      const isSupported = WeniWebchatService.isAudioRecordingSupported();
      expect(typeof isSupported).toBe('boolean');
    });
  });

  describe('Event Emitter', () => {
    beforeEach(() => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });
    });

    it('should register event listeners', () => {
      const listener = jest.fn();
      service.on('test-event', listener);
      service.emit('test-event', 'data');

      expect(listener).toHaveBeenCalledWith('data');
    });

    it('should remove event listeners', () => {
      const listener = jest.fn();
      service.on('test-event', listener);
      service.off('test-event', listener);
      service.emit('test-event');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Destroy', () => {
    beforeEach(() => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });
    });

    it('should clean up resources', () => {
      service.destroy();

      expect(service._initialized).toBe(false);
      expect(service._connected).toBe(false);
    });
  });
});
