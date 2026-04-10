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
  });
});
