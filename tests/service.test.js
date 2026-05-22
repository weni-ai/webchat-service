import WeniWebchatService from '../src/index';
import RetryStrategy from '../src/network/RetryStrategy';
import { DEFAULTS, SERVICE_EVENTS } from '../src/utils/constants';

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

    it('should default mode to "live" and connectOn to "mount"', () => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });

      expect(service.config.mode).toBe('live');
      expect(service.config.connectOn).toBe('mount');
    });

    it('should propagate custom mode, clientId and sessionToken', () => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
        mode: 'preview',
        clientId: 'tenant-x',
        sessionToken: 'tok-1',
      });

      expect(service.config.mode).toBe('preview');
      expect(service.config.clientId).toBe('tenant-x');
      expect(service.config.sessionToken).toBe('tok-1');
    });

    it('should propagate custom maxReconnectAttempts, reconnectInterval and pingInterval', () => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
        maxReconnectAttempts: 7,
        reconnectInterval: 4321,
        pingInterval: 9876,
      });

      expect(service.config.maxReconnectAttempts).toBe(7);
      expect(service.config.reconnectInterval).toBe(4321);
      expect(service.config.pingInterval).toBe(9876);
      expect(service.websocket.config.maxReconnectAttempts).toBe(7);
      expect(service.websocket.config.pingInterval).toBe(9876);
    });

    it('should construct a RetryStrategy seeded with reconnectInterval', () => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
        reconnectInterval: 2500,
      });

      expect(service.retryStrategy).toBeInstanceOf(RetryStrategy);
      expect(service.retryStrategy.config.baseDelay).toBe(2500);
      expect(service.retryStrategy.config.maxDelay).toBe(30000);
    });

    it('should fall back to DEFAULTS.RECONNECT_INTERVAL for the RetryStrategy when none is provided', () => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });

      expect(service.retryStrategy.config.baseDelay).toBe(
        DEFAULTS.RECONNECT_INTERVAL,
      );
    });

    it('should initialize empty internal queues and flags', () => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });

      expect(service._initialized).toBe(false);
      expect(service._connected).toBe(false);
      expect(service._latestStartersFingerprint).toBeNull();
      expect(service.messagesQueue).toEqual([]);
      expect(service._renderEnabled).toBe(true);
    });

    it('should throw when constructed with no arguments (default param branch)', () => {
      // Exercises the `config = {}` default at line 71 of src/index.js.
      // `validateConfig` then rejects the empty object for the missing
      // socketUrl, surfacing the expected error.
      expect(() => new WeniWebchatService()).toThrow(
        'socketUrl is required and must be a string',
      );
    });

    it('should keep autoClearCache=true when caller passes autoClearCache: false', () => {
      // The `config.autoClearCache !== false || DEFAULTS.AUTO_CLEAR_CACHE`
      // expression at line 94 short-circuits to DEFAULTS when the caller
      // passes false, making the option effectively un-disable-able through
      // this code path. Tests pin that documented behavior.
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
        autoClearCache: false,
      });

      // The post-spread `...config` brings the explicit `false` back in,
      // overriding the `||` fallback — so the consumer's intent IS honored
      // in the final merged config even though the `||` branch fires.
      expect(service.config.autoClearCache).toBe(false);
    });

    it('should clamp reconnectInterval=0 in the RetryStrategy seed (line 105 fallback)', () => {
      // Line 88-89 first defaults `reconnectInterval` to DEFAULTS.RECONNECT_INTERVAL,
      // but the trailing `...config` spread re-applies the caller's `0`,
      // making `this.config.reconnectInterval` falsy at line 105 — exercising
      // the `|| DEFAULTS.RECONNECT_INTERVAL` fallback for the RetryStrategy.
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
        reconnectInterval: 0,
      });

      expect(service.config.reconnectInterval).toBe(0);
      expect(service.retryStrategy.config.baseDelay).toBe(
        DEFAULTS.RECONNECT_INTERVAL,
      );
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

    it('should expose getSession() returning null until a session exists', () => {
      expect(service.getSession()).toBeNull();

      service.session.getOrCreate();
      const session = service.getSession();

      expect(session).not.toBeNull();
      expect(session.id).toBe(service.getSessionId());
    });

    it('should expose getRetryInfo() with attempts, nextDelay and maxAttempts', () => {
      // RetryStrategy.getDelay() is non-deterministic because of jitter, so
      // we stub Math.random to a fixed value before sampling.
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const info = service.getRetryInfo();

      expect(info).toEqual({
        attempts: 0,
        nextDelay: service.retryStrategy.getDelay(),
        maxAttempts: service.config.maxReconnectAttempts,
      });
      expect(typeof info.attempts).toBe('number');
      expect(typeof info.nextDelay).toBe('number');
      expect(info.nextDelay).toBeGreaterThanOrEqual(0);
    });

    it('should expose getAllowedFileTypes() and getFileConfig()', () => {
      const allowed = service.getAllowedFileTypes();
      expect(Array.isArray(allowed)).toBe(true);
      expect(allowed.length).toBeGreaterThan(0);

      const fileConfig = service.getFileConfig();
      expect(fileConfig).toEqual({
        allowedTypes: allowed,
        maxFileSize: service.fileHandler.config.maxFileSize,
        acceptAttribute: allowed.join(','),
      });
    });

    it('should reset retry strategy attempts via resetRetryStrategy()', () => {
      const resetSpy = jest.spyOn(service.retryStrategy, 'reset');

      service.resetRetryStrategy();

      expect(resetSpy).toHaveBeenCalledTimes(1);
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

    it('should emit session:cleared when clearSession is called', () => {
      service.session.getOrCreate();
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.SESSION_CLEARED, listener);

      service.clearSession();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(service.session.getSession()).toBeNull();
    });

    it('should round-trip setIsChatOpen / getIsChatOpen and emit chat:open:changed', () => {
      service.session.getOrCreate();
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.CHAT_OPEN_CHANGED, listener);

      expect(service.getIsChatOpen()).toBe(false);

      service.setIsChatOpen(true);
      expect(service.getIsChatOpen()).toBe(true);
      expect(listener).toHaveBeenCalledWith(true);

      service.setIsChatOpen(false);
      expect(service.getIsChatOpen()).toBe(false);
      expect(listener).toHaveBeenCalledWith(false);
    });

    it('should emit session:restored and populate state when restoreOrCreateSession finds a stored session', async () => {
      const restored = {
        id: 'restored-1@example.com',
        createdAt: 1,
        lastActivity: 2,
        conversation: [],
      };
      jest.spyOn(service.session, 'restore').mockResolvedValue(restored);
      const setSessionSpy = jest.spyOn(service.state, 'setSession');
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.SESSION_RESTORED, listener);

      await service.restoreOrCreateSession();

      expect(setSessionSpy).toHaveBeenCalledWith(restored);
      expect(listener).toHaveBeenCalledWith(restored);
    });

    it('should fall back to createNewSession when restore yields null', async () => {
      jest.spyOn(service.session, 'restore').mockResolvedValue(null);
      const createSpy = jest.spyOn(service, 'createNewSession');

      await service.restoreOrCreateSession();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(service.session.getSession()).not.toBeNull();
    });

    it('should populate state when createNewSession is called directly', () => {
      const setSessionSpy = jest.spyOn(service.state, 'setSession');

      service.createNewSession();

      const session = service.session.getSession();
      expect(session).not.toBeNull();
      expect(setSessionSpy).toHaveBeenCalledWith(session);
    });

    it('should reconnect after setSessionId() when previously connected', async () => {
      service.session.createNewSession();
      service._initialized = true;
      service._connected = true;
      service.websocket.status = 'connected';

      const disconnectSpy = jest
        .spyOn(service, 'disconnect')
        .mockImplementation(() => {
          service._connected = false;
          service.websocket.status = 'disconnected';
        });
      const connectSpy = jest
        .spyOn(service, 'connect')
        .mockResolvedValue(undefined);

      await service.setSessionId('reconnect@test.host');

      expect(disconnectSpy).toHaveBeenCalledWith(false);
      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(service.getSessionId()).toBe('reconnect@test.host');
    });

    it('should disconnect (without reconnect) after setSessionId() when only mid-connect', async () => {
      service.session.createNewSession();
      service._initialized = true;
      service._connecting = true;
      service.websocket.status = 'connecting';

      const disconnectSpy = jest
        .spyOn(service, 'disconnect')
        .mockImplementation(() => {});
      const connectSpy = jest
        .spyOn(service, 'connect')
        .mockResolvedValue(undefined);

      await service.setSessionId('reconnect@test.host');

      expect(disconnectSpy).toHaveBeenCalledWith(false);
      expect(connectSpy).not.toHaveBeenCalled();
      expect(service.getSessionId()).toBe('reconnect@test.host');
    });

    it('should be a no-op when setSessionId is called before initialization', async () => {
      const disconnectSpy = jest.spyOn(service, 'disconnect');
      const connectSpy = jest.spyOn(service, 'connect');

      await service.setSessionId('preinit@test.host');

      expect(disconnectSpy).not.toHaveBeenCalled();
      expect(connectSpy).not.toHaveBeenCalled();
      expect(service.session.config.sessionId).toBe('preinit@test.host');
    });
  });

  describe('sendOrder', () => {
    beforeEach(() => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });
    });

    it('should throw error when productItems is null', async () => {
      await expect(service.sendOrder(null)).rejects.toThrow(
        'Product items are required',
      );
    });

    it('should throw error when productItems is undefined', async () => {
      await expect(service.sendOrder(undefined)).rejects.toThrow(
        'Product items are required',
      );
    });

    it('should throw error when productItems is not an array', async () => {
      await expect(service.sendOrder('not-an-array')).rejects.toThrow(
        'Product items are required',
      );
    });

    it('should throw error when productItems is an empty array', async () => {
      await expect(service.sendOrder([])).rejects.toThrow(
        'Product items are required',
      );
    });

    it('should add order message to state and session', async () => {
      service.session.getOrCreate();
      const addMessageSpy = jest.spyOn(service.state, 'addMessage');
      const appendSpy = jest.spyOn(service.session, 'appendToConversation');

      const productItems = [
        { product_retailer_id: 'prod-1', quantity: 2 },
        { product_retailer_id: 'prod-2', quantity: 1 },
      ];

      await service.sendOrder(productItems);

      expect(addMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'order',
          direction: 'outgoing',
          order: {
            product_items: productItems,
          },
        }),
      );

      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'order',
          order: {
            product_items: productItems,
          },
        }),
      );
    });

    it('should enqueue the order message', async () => {
      service.session.getOrCreate();
      const enqueueSpy = jest.spyOn(service, 'enqueueMessages');

      const productItems = [{ product_retailer_id: 'prod-1', quantity: 1 }];
      await service.sendOrder(productItems);

      expect(enqueueSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'order',
          order: { product_items: productItems },
        }),
      ]);
    });
  });

  describe('addConversationStatus', () => {
    beforeEach(() => {
      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });
      service.session.getOrCreate();
    });

    it('should add conversation status to state and session', () => {
      const addMessageSpy = jest.spyOn(service.state, 'addMessage');
      const appendSpy = jest.spyOn(service.session, 'appendToConversation');
      const enqueueSpy = jest.spyOn(service, 'enqueueMessages');

      const returned = service.addConversationStatus(
        'Meta Quest 2 added to cart',
        'success',
      );

      expect(returned).toEqual(
        expect.objectContaining({
          type: 'conversation_status',
          text: 'Meta Quest 2 added to cart',
          statusType: 'success',
          direction: 'incoming',
          persisted: true,
        }),
      );
      expect(returned.id).toBeDefined();
      expect(addMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversation_status',
          text: 'Meta Quest 2 added to cart',
          statusType: 'success',
        }),
      );
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversation_status',
          statusType: 'success',
        }),
      );
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('should trim text and statusType', () => {
      const msg = service.addConversationStatus('  Added  ', '  info  ');
      expect(msg.text).toBe('Added');
      expect(msg.statusType).toBe('info');
    });

    it('should throw when text is missing or empty', () => {
      expect(() => service.addConversationStatus('', 'success')).toThrow(
        'Status text is required',
      );
      expect(() => service.addConversationStatus('   ', 'success')).toThrow(
        'Status text is required',
      );
      expect(() => service.addConversationStatus(null, 'success')).toThrow(
        'Status text is required',
      );
    });

    it('should throw when statusType is missing or empty', () => {
      expect(() => service.addConversationStatus('Added to cart', '')).toThrow(
        'Status type is required',
      );
      expect(() =>
        service.addConversationStatus('Added to cart', '   '),
      ).toThrow('Status type is required');
      expect(() =>
        service.addConversationStatus('Added to cart', null),
      ).toThrow('Status type is required');
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

    it('should reflect _connecting via isConnecting()', () => {
      expect(service.isConnecting()).toBeFalsy();

      service._connecting = true;
      expect(service.isConnecting()).toBe(true);

      service._connecting = false;
      expect(service.isConnecting()).toBe(false);
    });

    it('should reflect WebSocket status via isReconnecting()', () => {
      expect(service.isReconnecting()).toBe(false);

      service.websocket.status = 'reconnecting';
      expect(service.isReconnecting()).toBe(true);

      service.websocket.status = 'connected';
      expect(service.isReconnecting()).toBe(false);
    });

    it('should default isRenderEnabled() to true', () => {
      expect(service.isRenderEnabled()).toBe(true);

      service._renderEnabled = false;
      expect(service.isRenderEnabled()).toBe(false);
    });

    it('should require both _connected AND websocket.status === "connected" for isConnected()', () => {
      service._connected = true;
      service.websocket.status = 'connected';
      expect(service.isConnected()).toBe(true);

      service._connected = false;
      expect(service.isConnected()).toBe(false);

      service._connected = true;
      service.websocket.status = 'reconnecting';
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

  describe('voice:enabled on ready_for_message', () => {
    let mockSocket;

    beforeEach(() => {
      mockSocket = {
        send: jest.fn(),
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        readyState: WebSocket.OPEN,
      };

      global.WebSocket = jest.fn().mockImplementation(() => mockSocket);

      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });

      service.websocket.socket = mockSocket;
    });

    it('should emit voice:enabled when server sends voice_enabled: true', () => {
      const listener = jest.fn();
      service.on('voice:enabled', listener);

      service.websocket._handleMessage({
        data: JSON.stringify({
          type: 'ready_for_message',
          data: { voice_enabled: true, history: [] },
        }),
      });

      expect(listener).toHaveBeenCalled();
    });

    it('should not emit voice:enabled when server sends voice_enabled: false', () => {
      const listener = jest.fn();
      service.on('voice:enabled', listener);

      service.websocket._handleMessage({
        data: JSON.stringify({
          type: 'ready_for_message',
          data: { voice_enabled: false, history: [] },
        }),
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('should not emit voice:enabled when data is missing', () => {
      const listener = jest.fn();
      service.on('voice:enabled', listener);

      service.websocket._handleMessage({
        data: JSON.stringify({
          type: 'ready_for_message',
        }),
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('should emit voice:enabled before connected', () => {
      const events = [];
      service.on('voice:enabled', () => events.push('voice:enabled'));
      service.on('connected', () => events.push('connected'));

      service.websocket._handleMessage({
        data: JSON.stringify({
          type: 'ready_for_message',
          data: { voice_enabled: true },
        }),
      });

      expect(events[0]).toBe('voice:enabled');
      expect(events).toContain('connected');
    });
  });

  describe('requestVoiceTokens', () => {
    let mockSocket;

    beforeEach(() => {
      mockSocket = {
        send: jest.fn(),
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        readyState: WebSocket.OPEN,
      };

      global.WebSocket = jest.fn().mockImplementation(() => mockSocket);

      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });

      service.websocket.socket = mockSocket;
      service.websocket.status = 'connected';
    });

    it('should resolve with sttToken and ttsToken when server responds', async () => {
      const promise = service.requestVoiceTokens();

      service.websocket.emit('voice:tokens:received', {
        type: 'voice_tokens',
        data: {
          stt_token: 'stt-abc-123',
          tts_token: 'tts-xyz-789',
        },
      });

      await expect(promise).resolves.toEqual({
        sttToken: 'stt-abc-123',
        ttsToken: 'tts-xyz-789',
      });
    });

    it('should reject when server responds with an error', async () => {
      const promise = service.requestVoiceTokens();

      service.websocket.emit('voice:tokens:error', {
        type: 'voice_tokens_error',
        error: 'Channel not configured for voice',
      });

      await expect(promise).rejects.toThrow('Channel not configured for voice');
    });

    it('should reject after timeout if no response is received', async () => {
      jest.useFakeTimers();

      const promise = service.requestVoiceTokens(5000);

      jest.advanceTimersByTime(5001);

      await expect(promise).rejects.toThrow('Voice tokens request timed out');

      jest.useRealTimers();
    });

    it('should emit voice:tokens:received event on service when received', async () => {
      const listener = jest.fn();
      service.on('voice:tokens:received', listener);

      service.websocket.emit('voice:tokens:received', {
        type: 'voice_tokens',
        data: {
          stt_token: 'stt-token',
          tts_token: 'tts-token',
        },
      });

      expect(listener).toHaveBeenCalledWith({
        type: 'voice_tokens',
        data: {
          stt_token: 'stt-token',
          tts_token: 'tts-token',
        },
      });
    });

    it('should send request_voice_tokens message through WebSocket', () => {
      service.requestVoiceTokens();

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'request_voice_tokens' }),
      );
    });
  });

  describe('addProductToCart', () => {
    let mockSocket;
    const validProps = {
      VTEXAccountName: 'account-name',
      orderFormId: '1234567890',
      seller: 'seller_123',
      id: 'product_456',
    };

    beforeEach(() => {
      mockSocket = {
        send: jest.fn(),
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        readyState: WebSocket.OPEN,
      };

      global.WebSocket = jest.fn().mockImplementation(() => mockSocket);

      service = new WeniWebchatService({
        socketUrl: 'wss://test.example.com',
        channelUuid: '12345',
      });

      service.websocket.socket = mockSocket;
      service.websocket.status = 'connected';
    });

    it('should send add_to_cart payload through WebSocket', () => {
      service.addProductToCart(validProps);

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'add_to_cart',
          data: {
            vtex_account: 'account-name',
            order_form_id: '1234567890',
            item: {
              seller: 'seller_123',
              id: 'product_456',
            },
          },
        }),
      );
    });

    it('should resolve when cart_updated arrives with matching item_id', async () => {
      const promise = service.addProductToCart(validProps);

      service.websocket._handleMessage({
        data: JSON.stringify({
          type: 'cart_updated',
          data: { item_id: 'product_456' },
        }),
      });

      await expect(promise).resolves.toEqual({ id: 'product_456' });
    });

    it('should reject when cart_error arrives with matching item_id', async () => {
      const promise = service.addProductToCart(validProps);

      service.websocket._handleMessage({
        data: JSON.stringify({
          type: 'cart_error',
          error: 'failed to update cart',
          data: { item_id: 'product_456' },
        }),
      });

      await expect(promise).rejects.toThrow('failed to update cart');
    });

    it('should use fallback message when cart_error has no error string', async () => {
      const promise = service.addProductToCart(validProps);

      service.websocket._handleMessage({
        data: JSON.stringify({
          type: 'cart_error',
          data: { item_id: 'product_456' },
        }),
      });

      await expect(promise).rejects.toThrow('Failed to update cart');
    });

    it('should ignore duplicate cart_error for same item_id', async () => {
      const promise = service.addProductToCart(validProps);

      service.websocket._handleMessage({
        data: JSON.stringify({
          type: 'cart_error',
          error: 'failed to update cart',
          data: { item_id: 'product_456' },
        }),
      });

      await expect(promise).rejects.toThrow('failed to update cart');

      expect(() => {
        service.websocket._handleMessage({
          data: JSON.stringify({
            type: 'cart_error',
            error: 'failed again',
            data: { item_id: 'product_456' },
          }),
        });
      }).not.toThrow();
    });

    it('should not resolve for a different item_id', async () => {
      jest.useFakeTimers();

      const promise = service.addProductToCart(validProps, 50);

      service.websocket._handleMessage({
        data: JSON.stringify({
          type: 'cart_updated',
          data: { item_id: 'another-item' },
        }),
      });

      jest.advanceTimersByTime(51);

      await expect(promise).rejects.toThrow(
        'Add to cart request timed out for item id "product_456"',
      );

      jest.useRealTimers();
    });

    it('should resolve concurrent requests by matching each item_id', async () => {
      const p1 = service.addProductToCart({
        ...validProps,
        id: 'product_1',
      });
      const p2 = service.addProductToCart({
        ...validProps,
        id: 'product_2',
      });

      service.websocket._handleMessage({
        data: JSON.stringify({
          type: 'cart_updated',
          data: { item_id: 'product_2' },
        }),
      });
      service.websocket._handleMessage({
        data: JSON.stringify({
          type: 'cart_updated',
          data: { item_id: 'product_1' },
        }),
      });

      await expect(p2).resolves.toEqual({ id: 'product_2' });
      await expect(p1).resolves.toEqual({ id: 'product_1' });
    });

    it('should reject after 30 seconds when no response is received', async () => {
      jest.useFakeTimers();

      const promise = service.addProductToCart(validProps);

      jest.advanceTimersByTime(30001);

      await expect(promise).rejects.toThrow(
        'Add to cart request timed out for item id "product_456"',
      );

      jest.useRealTimers();
    });

    it('should reject when input is invalid', async () => {
      await expect(service.addProductToCart(null)).rejects.toThrow(
        'VTEXAccountName is required',
      );
      await expect(
        service.addProductToCart({
          ...validProps,
          VTEXAccountName: '',
        }),
      ).rejects.toThrow('VTEXAccountName is required');
      await expect(
        service.addProductToCart({
          ...validProps,
          orderFormId: '',
        }),
      ).rejects.toThrow('orderFormId is required');
      await expect(
        service.addProductToCart({
          ...validProps,
          seller: '',
        }),
      ).rejects.toThrow('seller is required');
      await expect(
        service.addProductToCart({
          ...validProps,
          id: '',
        }),
      ).rejects.toThrow('id is required');
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

    it('should remove all consumer listeners', () => {
      const listener = jest.fn();
      service.on('custom-event', listener);

      service.destroy();
      service.emit('custom-event', 'after-destroy');

      expect(listener).not.toHaveBeenCalled();
    });

    it('should call disconnect() during teardown', () => {
      const disconnectSpy = jest.spyOn(service, 'disconnect');

      service.destroy();

      expect(disconnectSpy).toHaveBeenCalled();
    });
  });
});
