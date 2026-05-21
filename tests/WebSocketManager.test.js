import WebSocketManager from '../src/core/WebSocketManager';
import RetryStrategy from '../src/network/RetryStrategy';
import { DEFAULTS, SERVICE_EVENTS } from '../src/utils/constants';

function createManager(config = {}) {
  const manager = new WebSocketManager({
    socketUrl: 'wss://test.example.com',
    channelUuid: 'test-channel',
    ...config,
  });
  manager.setRegistrationData({
    from: 'session-id',
    callback: 'https://example.com/cb',
    session_type: 'local',
  });
  return manager;
}

function sendMessage(manager, payload) {
  manager._handleMessage({ data: JSON.stringify(payload) });
}

function makeSocketMock(readyState = 1) {
  const listeners = { open: [], error: [], close: [] };
  return {
    readyState,
    send: jest.fn(),
    close: jest.fn(),
    addEventListener: jest.fn((event, cb) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    removeEventListener: jest.fn((event, cb) => {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((fn) => fn !== cb);
    }),
    listeners,
    fire(event, ...args) {
      (listeners[event] || []).slice().forEach((cb) => cb(...args));
    },
  };
}

// Backwards-compatible alias used by the original suite below.
function makeOpenSocketMock() {
  return makeSocketMock(1);
}

function installSocket(socket) {
  global.WebSocket = jest.fn(() => socket);
  global.WebSocket.OPEN = 1;
  global.WebSocket.CONNECTING = 0;
  global.WebSocket.CLOSING = 2;
  global.WebSocket.CLOSED = 3;
  return socket;
}

describe('WebSocketManager', () => {
  beforeEach(() => {
    global.WebSocket = jest.fn().mockImplementation(() => makeOpenSocketMock());
    global.WebSocket.OPEN = 1;
    global.WebSocket.CONNECTING = 0;
    global.WebSocket.CLOSING = 2;
    global.WebSocket.CLOSED = 3;
  });

  describe('defaults', () => {
    it('exposes maxReclaimAttempts default', () => {
      const manager = createManager();
      expect(manager.config.maxReclaimAttempts).toBe(
        DEFAULTS.MAX_RECLAIM_ATTEMPTS,
      );
      expect(manager._reclaimAttempts).toBe(0);
    });

    it('accepts a custom maxReclaimAttempts', () => {
      const manager = createManager({ maxReclaimAttempts: 7 });
      expect(manager.config.maxReclaimAttempts).toBe(7);
    });
  });

  describe('_scheduleReconnect cap', () => {
    it('emits ERROR and does not retry once reconnectAttempts reaches maxReconnectAttempts', () => {
      jest.useFakeTimers();
      const manager = createManager({ maxReconnectAttempts: 3 });
      manager.reconnectAttempts = 3;
      const errorHandler = jest.fn();
      const statusHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);
      manager.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusHandler);

      manager._scheduleReconnect();

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(errorHandler.mock.calls[0][0].message).toBe(
        'Max reconnection attempts reached',
      );
      expect(manager.reconnectTimer).toBeNull();
      expect(manager.status).not.toBe('reconnecting');
      expect(statusHandler).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('schedules a timer while below the cap', () => {
      jest.useFakeTimers();
      const manager = createManager({ maxReconnectAttempts: 3 });

      manager._scheduleReconnect();

      expect(manager.reconnectTimer).not.toBeNull();
      expect(manager.status).toBe('reconnecting');

      clearTimeout(manager.reconnectTimer);
      manager.reconnectTimer = null;
      jest.useRealTimers();
    });
  });

  describe('"client from already exists" reclaim cap', () => {
    it('bounds _closeOthersConnections at maxReclaimAttempts and then stops reconnecting', () => {
      const manager = createManager();
      const closeOthersSpy = jest
        .spyOn(manager, '_closeOthersConnections')
        .mockImplementation(() => {});
      const disconnectSpy = jest
        .spyOn(manager, 'disconnect')
        .mockImplementation(() => {});
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      const reclaimError = {
        type: 'error',
        error: 'unable to register: client from already exists',
      };

      sendMessage(manager, reclaimError);
      sendMessage(manager, reclaimError);
      sendMessage(manager, reclaimError);

      expect(closeOthersSpy).toHaveBeenCalledTimes(3);
      expect(errorHandler).not.toHaveBeenCalled();
      expect(disconnectSpy).not.toHaveBeenCalled();

      sendMessage(manager, reclaimError);

      expect(closeOthersSpy).toHaveBeenCalledTimes(3);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(errorHandler.mock.calls[0][0].message).toBe(
        'Unable to reclaim session from another active client',
      );
      expect(disconnectSpy).toHaveBeenCalledWith(true);
    });

    it('honors a custom maxReclaimAttempts', () => {
      const manager = createManager({ maxReclaimAttempts: 1 });
      const closeOthersSpy = jest
        .spyOn(manager, '_closeOthersConnections')
        .mockImplementation(() => {});
      const disconnectSpy = jest
        .spyOn(manager, 'disconnect')
        .mockImplementation(() => {});
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      const reclaimError = {
        type: 'error',
        error: 'unable to register: client from already exists',
      };

      sendMessage(manager, reclaimError);
      sendMessage(manager, reclaimError);

      expect(closeOthersSpy).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledWith(true);
    });

    it('resets _reclaimAttempts on ready_for_message so a later duplicate is handled again', () => {
      const manager = createManager();
      const closeOthersSpy = jest
        .spyOn(manager, '_closeOthersConnections')
        .mockImplementation(() => {});
      jest.spyOn(manager, '_startPingInterval').mockImplementation(() => {});
      jest
        .spyOn(manager, '_requestProjectLanguage')
        .mockImplementation(() => {});

      const reclaimError = {
        type: 'error',
        error: 'unable to register: client from already exists',
      };

      sendMessage(manager, reclaimError);
      sendMessage(manager, reclaimError);
      expect(manager._reclaimAttempts).toBe(2);

      sendMessage(manager, { type: 'ready_for_message' });

      expect(manager._reclaimAttempts).toBe(0);

      sendMessage(manager, reclaimError);
      expect(manager._reclaimAttempts).toBe(1);
      expect(closeOthersSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('_closeOthersConnections', () => {
    it('does not permanently disable autoReconnect (regression)', async () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      expect(manager.config.autoReconnect).toBe(true);

      await manager._closeOthersConnections();

      expect(manager.socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'close_session', from: 'session-id' }),
      );
      expect(manager.socket.close).toHaveBeenCalled();
      expect(manager.config.autoReconnect).toBe(true);
      expect(manager.status).toBe('disconnecting');
      expect(manager.isRegistered).toBe(false);
    });

    it('emits ERROR with prefix and rethrows when send rejects', async () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();
      jest.spyOn(manager, 'send').mockRejectedValue(new Error('socket closed'));
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      await expect(manager._closeOthersConnections()).rejects.toThrow(
        'socket closed',
      );

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(errorHandler.mock.calls[0][0].message).toBe(
        'Failed to close connection: socket closed',
      );
    });
  });

  describe('"original handler is dead"', () => {
    it('triggers non-permanent disconnect so the capped reconnect path runs', () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();
      manager.isRegistered = true;
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      sendMessage(manager, {
        type: 'error',
        error:
          'unable to register: original handler is dead, wait for unregister to register again',
      });

      expect(manager.isRegistered).toBe(false);
      expect(manager.socket.close).toHaveBeenCalled();
      expect(manager.config.autoReconnect).toBe(true);
      expect(manager.status).toBe('disconnecting');
      // Recoverable: must not surface a generic error to the consumer.
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it('does not increment _reclaimAttempts', () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      sendMessage(manager, {
        type: 'error',
        error:
          'unable to register: original handler is dead, wait for unregister to register again',
      });

      expect(manager._reclaimAttempts).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // A. constructor — initial state + defaults snapshot
  // ---------------------------------------------------------------------------
  describe('constructor', () => {
    it('initializes runtime state to safe defaults', () => {
      const manager = new WebSocketManager({
        socketUrl: 'wss://test.example.com',
        channelUuid: 'test-channel',
      });

      expect(manager.socket).toBeNull();
      expect(manager.status).toBe('disconnected');
      expect(manager.reconnectAttempts).toBe(0);
      expect(manager.reconnectTimer).toBeNull();
      expect(manager.pingTimer).toBeNull();
      expect(manager.isRegistered).toBe(false);
      expect(manager.registrationData).toBeNull();
      expect(manager.retryStrategy).toBeNull();
      expect(manager.pendingAddToCartRequests).toBeInstanceOf(Map);
      expect(manager.pendingAddToCartRequests.size).toBe(0);
      expect(manager._reclaimAttempts).toBe(0);
    });

    it('applies DEFAULTS for every connection knob', () => {
      const manager = new WebSocketManager({
        socketUrl: 'wss://test.example.com',
        channelUuid: 'test-channel',
      });

      expect(manager.config.socketUrl).toBe('wss://test.example.com');
      expect(manager.config.channelUuid).toBe('test-channel');
      expect(manager.config.host).toBe('');
      expect(manager.config.sessionToken).toBeNull();
      expect(manager.config.autoReconnect).toBe(DEFAULTS.AUTO_RECONNECT);
      expect(manager.config.maxReconnectAttempts).toBe(
        DEFAULTS.MAX_RECONNECT_ATTEMPTS,
      );
      expect(manager.config.maxReclaimAttempts).toBe(
        DEFAULTS.MAX_RECLAIM_ATTEMPTS,
      );
      expect(manager.config.reconnectInterval).toBe(
        DEFAULTS.RECONNECT_INTERVAL,
      );
      expect(manager.config.pingInterval).toBe(DEFAULTS.PING_INTERVAL);
      expect(manager.config.retryStrategy).toBeNull();
    });

    it('honors caller overrides for every knob', () => {
      const retryStrategy = new RetryStrategy();
      const manager = new WebSocketManager({
        socketUrl: 'wss://override.example.com',
        channelUuid: 'override-channel',
        host: 'https://flows.example.com',
        sessionToken: 'tok-1',
        maxReconnectAttempts: 11,
        maxReclaimAttempts: 7,
        reconnectInterval: 2222,
        pingInterval: 9999,
        retryStrategy,
      });

      expect(manager.config.socketUrl).toBe('wss://override.example.com');
      expect(manager.config.channelUuid).toBe('override-channel');
      expect(manager.config.host).toBe('https://flows.example.com');
      expect(manager.config.sessionToken).toBe('tok-1');
      expect(manager.config.maxReconnectAttempts).toBe(11);
      expect(manager.config.maxReclaimAttempts).toBe(7);
      expect(manager.config.reconnectInterval).toBe(2222);
      expect(manager.config.pingInterval).toBe(9999);
      expect(manager.config.retryStrategy).toBe(retryStrategy);
      expect(manager.retryStrategy).toBe(retryStrategy);
    });

    it('honors autoReconnect: false (regression)', () => {
      // Without the constructor fix, this resolves to true because
      // `false !== false || true` evaluates to true.
      const manager = new WebSocketManager({
        socketUrl: 'wss://test.example.com',
        channelUuid: 'test-channel',
        autoReconnect: false,
      });

      expect(manager.config.autoReconnect).toBe(false);
    });

    it('honors autoReconnect: true explicitly', () => {
      const manager = new WebSocketManager({
        socketUrl: 'wss://test.example.com',
        channelUuid: 'test-channel',
        autoReconnect: true,
      });

      expect(manager.config.autoReconnect).toBe(true);
    });

    it('is callable with no arguments and falls back to empty defaults', () => {
      const manager = new WebSocketManager();

      expect(manager.config.socketUrl).toBe('');
      expect(manager.config.channelUuid).toBe('');
      expect(manager.config.host).toBe('');
      expect(manager.config.sessionToken).toBeNull();
      expect(manager.config.autoReconnect).toBe(DEFAULTS.AUTO_RECONNECT);
      expect(manager.config.maxReconnectAttempts).toBe(
        DEFAULTS.MAX_RECONNECT_ATTEMPTS,
      );
      expect(manager.config.maxReclaimAttempts).toBe(
        DEFAULTS.MAX_RECLAIM_ATTEMPTS,
      );
      expect(manager.config.reconnectInterval).toBe(
        DEFAULTS.RECONNECT_INTERVAL,
      );
      expect(manager.config.pingInterval).toBe(DEFAULTS.PING_INTERVAL);
      expect(manager.config.retryStrategy).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // B. connect() — lifecycle wiring
  // ---------------------------------------------------------------------------
  describe('connect()', () => {
    it('returns immediately when status is "connected"', async () => {
      const manager = createManager();
      manager.status = 'connected';

      await manager.connect();

      expect(global.WebSocket).not.toHaveBeenCalled();
    });

    it('returns immediately when status is "connecting"', async () => {
      const manager = createManager();
      manager.status = 'connecting';

      await manager.connect();

      expect(global.WebSocket).not.toHaveBeenCalled();
    });

    it('closes an existing socket before opening a new one', async () => {
      const manager = createManager();
      const oldSocket = makeOpenSocketMock();
      manager.socket = oldSocket;
      installSocket(makeSocketMock(0));

      manager.connect();

      expect(oldSocket.close).toHaveBeenCalled();
      expect(manager.socket).not.toBe(oldSocket);
    });

    it('strips https:// from socketUrl when building the WebSocket URL', () => {
      const socket = makeSocketMock(0);
      installSocket(socket);
      const manager = createManager({ socketUrl: 'https://test.example.com' });

      manager.connect();

      expect(global.WebSocket).toHaveBeenCalledWith(
        'wss://test.example.com/ws',
      );
    });

    it('strips http:// from socketUrl when building the WebSocket URL', () => {
      const socket = makeSocketMock(0);
      installSocket(socket);
      const manager = createManager({ socketUrl: 'http://test.example.com' });

      manager.connect();

      expect(global.WebSocket).toHaveBeenCalledWith(
        'wss://test.example.com/ws',
      );
    });

    it('strips // from socketUrl when building the WebSocket URL', () => {
      const socket = makeSocketMock(0);
      installSocket(socket);
      const manager = createManager({ socketUrl: '//test.example.com' });

      manager.connect();

      expect(global.WebSocket).toHaveBeenCalledWith(
        'wss://test.example.com/ws',
      );
    });

    it('emits CONNECTION_STATUS_CHANGED("connecting") synchronously', () => {
      const socket = makeSocketMock(0);
      installSocket(socket);
      const manager = createManager();
      const statusHandler = jest.fn();
      manager.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusHandler);

      manager.connect();

      expect(manager.status).toBe('connecting');
      expect(statusHandler).toHaveBeenCalledWith('connecting');
    });

    it('forwards onmessage events to _handleMessage', () => {
      const socket = makeSocketMock(0);
      installSocket(socket);
      const manager = createManager();
      manager.connect();
      const handleMessageSpy = jest
        .spyOn(manager, '_handleMessage')
        .mockImplementation(() => {});

      const event = { data: '{"type":"ping"}' };
      manager.socket.onmessage(event);

      expect(handleMessageSpy).toHaveBeenCalledWith(event);
    });

    it('emits ERROR when socket.onerror fires', () => {
      const socket = makeSocketMock(0);
      installSocket(socket);
      const manager = createManager();
      manager.connect();
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      const error = new Error('socket boom');
      manager.socket.onerror(error);

      expect(errorHandler).toHaveBeenCalledWith(error);
    });

    it('delegates to _handleDisconnect when socket.onclose fires', () => {
      const socket = makeSocketMock(0);
      installSocket(socket);
      const manager = createManager();
      manager.connect();
      const handleDisconnectSpy = jest
        .spyOn(manager, '_handleDisconnect')
        .mockImplementation(() => {});

      const event = { code: 1006 };
      manager.socket.onclose(event);

      expect(handleDisconnectSpy).toHaveBeenCalledWith(event);
    });

    it('triggers register() and resolves once CONNECTED is emitted', async () => {
      const socket = makeSocketMock(0);
      installSocket(socket);
      const manager = createManager();
      const registerSpy = jest
        .spyOn(manager, 'register')
        .mockResolvedValue(undefined);

      const promise = manager.connect();
      manager.socket.onopen();
      manager.emit(SERVICE_EVENTS.CONNECTED);

      await expect(promise).resolves.toBeUndefined();
      expect(registerSpy).toHaveBeenCalled();
    });

    it('rejects, emits ERROR and sets status="error" when WebSocket constructor throws', async () => {
      const constructError = new Error('construct boom');
      global.WebSocket = jest.fn(() => {
        throw constructError;
      });
      global.WebSocket.OPEN = 1;
      const manager = createManager();
      const errorHandler = jest.fn();
      const statusHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);
      manager.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusHandler);

      await expect(manager.connect()).rejects.toBe(constructError);
      expect(manager.status).toBe('error');
      expect(statusHandler).toHaveBeenCalledWith('connecting');
      expect(statusHandler).toHaveBeenCalledWith('error');
      expect(errorHandler).toHaveBeenCalledWith(constructError);
    });
  });

  // ---------------------------------------------------------------------------
  // C. register()
  // ---------------------------------------------------------------------------
  describe('register()', () => {
    it('is a no-op when isRegistered=true and socket is OPEN', async () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();
      manager.isRegistered = true;
      const wsRegisteredHandler = jest.fn();
      manager.on(SERVICE_EVENTS.WS_REGISTERED, wsRegisteredHandler);

      await manager.register();

      expect(manager.socket.send).not.toHaveBeenCalled();
      expect(wsRegisteredHandler).not.toHaveBeenCalled();
    });

    it('re-registers when isRegistered=true but socket is not OPEN', async () => {
      const manager = createManager();
      manager.socket = makeSocketMock(3); // CLOSED
      manager.isRegistered = true;
      // send() will reject because socket is not OPEN; we just want to confirm
      // the early-return guard didn't fire.
      jest.spyOn(manager, 'send').mockResolvedValue(undefined);

      await manager.register();

      expect(manager.send).toHaveBeenCalled();
    });

    it('builds callback from config.host first', async () => {
      const manager = new WebSocketManager({
        socketUrl: 'wss://test.example.com',
        channelUuid: 'test-channel',
        host: 'https://config.example.com',
      });
      manager.setRegistrationData({
        from: 'session-id',
        host: 'https://from-data.example.com',
        session_type: 'local',
      });
      manager.socket = makeOpenSocketMock();

      await manager.register();

      const sent = JSON.parse(manager.socket.send.mock.calls[0][0]);
      expect(sent.callback).toBe(
        'https://config.example.com/c/wwc/test-channel/receive',
      );
    });

    it('falls back to registrationData.host when config.host is empty', async () => {
      const manager = new WebSocketManager({
        socketUrl: 'wss://test.example.com',
        channelUuid: 'test-channel',
      });
      manager.setRegistrationData({
        from: 'session-id',
        host: 'https://from-data.example.com',
        session_type: 'local',
      });
      manager.socket = makeOpenSocketMock();

      await manager.register();

      const sent = JSON.parse(manager.socket.send.mock.calls[0][0]);
      expect(sent.callback).toBe(
        'https://from-data.example.com/c/wwc/test-channel/receive',
      );
    });

    it('falls back to https://flows.weni.ai when no host is configured', async () => {
      const manager = new WebSocketManager({
        socketUrl: 'wss://test.example.com',
        channelUuid: 'test-channel',
      });
      manager.setRegistrationData({
        from: 'session-id',
        session_type: 'local',
      });
      manager.socket = makeOpenSocketMock();

      await manager.register();

      const sent = JSON.parse(manager.socket.send.mock.calls[0][0]);
      expect(sent.callback).toBe(
        'https://flows.weni.ai/c/wwc/test-channel/receive',
      );
    });

    it('uses registrationData.callback when provided (overrides host)', async () => {
      const manager = createManager(); // helper sets callback
      manager.socket = makeOpenSocketMock();

      await manager.register();

      const sent = JSON.parse(manager.socket.send.mock.calls[0][0]);
      expect(sent.callback).toBe('https://example.com/cb');
    });

    it('forwards voiceMode.enabled into data.features.voiceMode', async () => {
      const manager = createManager({ voiceMode: { enabled: true } });
      manager.socket = makeOpenSocketMock();

      await manager.register();

      const sent = JSON.parse(manager.socket.send.mock.calls[0][0]);
      expect(sent.data).toEqual({ features: { voiceMode: true } });
    });

    it('coerces missing voiceMode to false', async () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      await manager.register();

      const sent = JSON.parse(manager.socket.send.mock.calls[0][0]);
      expect(sent.data).toEqual({ features: { voiceMode: false } });
    });

    it('prefers registrationData.token, then config.sessionToken', async () => {
      // 1. registrationData.token wins
      let manager = new WebSocketManager({
        socketUrl: 'wss://test.example.com',
        channelUuid: 'test-channel',
        sessionToken: 'config-token',
      });
      manager.setRegistrationData({
        from: 'session-id',
        token: 'reg-token',
      });
      manager.socket = makeOpenSocketMock();
      await manager.register();
      let sent = JSON.parse(manager.socket.send.mock.calls[0][0]);
      expect(sent.token).toBe('reg-token');

      // 2. config.sessionToken used when registrationData.token is missing
      manager = new WebSocketManager({
        socketUrl: 'wss://test.example.com',
        channelUuid: 'test-channel',
        sessionToken: 'config-token',
      });
      manager.setRegistrationData({ from: 'session-id' });
      manager.socket = makeOpenSocketMock();
      await manager.register();
      sent = JSON.parse(manager.socket.send.mock.calls[0][0]);
      expect(sent.token).toBe('config-token');

      // 3. token absent when neither is provided
      manager = createManager();
      manager.socket = makeOpenSocketMock();
      await manager.register();
      sent = JSON.parse(manager.socket.send.mock.calls[0][0]);
      expect(sent.token).toBeUndefined();
    });

    it('emits WS_REGISTERED and sets isRegistered=true on success', async () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();
      const wsRegisteredHandler = jest.fn();
      manager.on(SERVICE_EVENTS.WS_REGISTERED, wsRegisteredHandler);

      await manager.register();

      expect(manager.isRegistered).toBe(true);
      expect(wsRegisteredHandler).toHaveBeenCalledTimes(1);
    });

    it('emits ERROR with "Registration failed: " prefix and rethrows when send rejects', async () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();
      jest.spyOn(manager, 'send').mockRejectedValue(new Error('socket gone'));
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      await expect(manager.register()).rejects.toThrow('socket gone');
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toBe(
        'Registration failed: socket gone',
      );
      expect(manager.isRegistered).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // D. disconnect() / getStatus() / setRegistrationData()
  // ---------------------------------------------------------------------------
  describe('disconnect() / getStatus() / setRegistrationData()', () => {
    it('disconnect(true) flips autoReconnect=false, clears timers, closes socket and emits DISCONNECTED', () => {
      jest.useFakeTimers();
      const manager = createManager();
      manager.socket = makeOpenSocketMock();
      manager.isRegistered = true;
      manager.pingTimer = setInterval(() => {}, 1000);
      manager.reconnectTimer = setTimeout(() => {}, 1000);
      const statusHandler = jest.fn();
      const disconnectedHandler = jest.fn();
      manager.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusHandler);
      manager.on(SERVICE_EVENTS.DISCONNECTED, disconnectedHandler);

      manager.disconnect(true);

      expect(manager.config.autoReconnect).toBe(false);
      expect(manager.pingTimer).toBeNull();
      expect(manager.reconnectTimer).toBeNull();
      expect(manager.socket.close).toHaveBeenCalled();
      expect(manager.status).toBe('disconnecting');
      expect(manager.isRegistered).toBe(false);
      expect(statusHandler).toHaveBeenCalledWith('disconnecting');
      expect(disconnectedHandler).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('disconnect(false, ...) keeps autoReconnect, accepts custom status, and does not emit DISCONNECTED', () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();
      const disconnectedHandler = jest.fn();
      const statusHandler = jest.fn();
      manager.on(SERVICE_EVENTS.DISCONNECTED, disconnectedHandler);
      manager.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusHandler);

      manager.disconnect(false, 'closed');

      expect(manager.config.autoReconnect).toBe(true);
      expect(manager.status).toBe('closed');
      expect(disconnectedHandler).not.toHaveBeenCalled();
      expect(statusHandler).toHaveBeenCalledWith('closed');
    });

    it('disconnect() defaults to permanent=true and status="disconnecting"', () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      manager.disconnect();

      expect(manager.config.autoReconnect).toBe(false);
      expect(manager.status).toBe('disconnecting');
    });

    it('getStatus() returns the current status string', () => {
      const manager = createManager();
      expect(manager.getStatus()).toBe('disconnected');
      manager.status = 'reconnecting';
      expect(manager.getStatus()).toBe('reconnecting');
    });

    it('setRegistrationData() stores the object on the manager', () => {
      const manager = new WebSocketManager({
        socketUrl: 'wss://test.example.com',
        channelUuid: 'test-channel',
      });
      const data = { from: 'sess-1', token: 't', session_type: 'local' };

      manager.setRegistrationData(data);

      expect(manager.registrationData).toBe(data);
    });
  });

  // ---------------------------------------------------------------------------
  // E. send()
  // ---------------------------------------------------------------------------
  describe('send()', () => {
    it('serializes and sends through an OPEN socket and emits MESSAGE_SENT', async () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();
      const messageSentHandler = jest.fn();
      manager.on(SERVICE_EVENTS.MESSAGE_SENT, messageSentHandler);

      const message = { type: 'ping' };
      await expect(manager.send(message)).resolves.toBeUndefined();

      expect(manager.socket.send).toHaveBeenCalledWith(JSON.stringify(message));
      expect(messageSentHandler).toHaveBeenCalledWith(message);
    });

    it('emits ERROR and rejects when socket.send throws on OPEN socket', async () => {
      const manager = createManager();
      const sendError = new Error('socket send boom');
      manager.socket = makeOpenSocketMock();
      manager.socket.send = jest.fn(() => {
        throw sendError;
      });
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      await expect(manager.send({ type: 'x' })).rejects.toBe(sendError);
      expect(errorHandler).toHaveBeenCalledWith(sendError);
    });

    it('waits for a CONNECTING socket to open, then sends', async () => {
      const manager = createManager();
      const socket = makeSocketMock(0); // CONNECTING
      manager.socket = socket;
      const messageSentHandler = jest.fn();
      manager.on(SERVICE_EVENTS.MESSAGE_SENT, messageSentHandler);

      const promise = manager.send({ type: 'queued' });

      expect(socket.send).not.toHaveBeenCalled();
      expect(socket.addEventListener).toHaveBeenCalledWith(
        'open',
        expect.any(Function),
      );

      socket.fire('open');

      await expect(promise).resolves.toBeUndefined();
      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'queued' }),
      );
      expect(messageSentHandler).toHaveBeenCalledWith({ type: 'queued' });
      expect(socket.removeEventListener).toHaveBeenCalledWith(
        'open',
        expect.any(Function),
      );
      expect(socket.removeEventListener).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
      expect(socket.removeEventListener).toHaveBeenCalledWith(
        'close',
        expect.any(Function),
      );
    });

    it('emits ERROR and rejects when CONNECTING socket fires error before open', async () => {
      const manager = createManager();
      const socket = makeSocketMock(0);
      manager.socket = socket;
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      const promise = manager.send({ type: 'queued' });

      const err = new Error('connect boom');
      socket.fire('error', err);

      await expect(promise).rejects.toBe(err);
      expect(errorHandler).toHaveBeenCalledWith(err);
    });

    it('rejects with "WebSocket closed before message could be sent" when CONNECTING socket closes', async () => {
      const manager = createManager();
      const socket = makeSocketMock(0);
      manager.socket = socket;

      const promise = manager.send({ type: 'queued' });
      socket.fire('close');

      await expect(promise).rejects.toThrow(
        'WebSocket closed before message could be sent',
      );
    });

    it("emits ERROR and rejects when CONNECTING socket's send throws after open", async () => {
      const manager = createManager();
      const socket = makeSocketMock(0);
      const throwErr = new Error('open send boom');
      socket.send = jest.fn(() => {
        throw throwErr;
      });
      manager.socket = socket;
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      const promise = manager.send({ type: 'queued' });
      socket.fire('open');

      await expect(promise).rejects.toBe(throwErr);
      expect(errorHandler).toHaveBeenCalledWith(throwErr);
    });

    it('rejects with "WebSocket not connected" when socket is null', async () => {
      const manager = createManager();
      manager.socket = null;

      await expect(manager.send({ type: 'x' })).rejects.toThrow(
        'WebSocket not connected',
      );
    });

    it('rejects with "WebSocket not connected" when socket is CLOSED', async () => {
      const manager = createManager();
      manager.socket = makeSocketMock(3); // CLOSED

      await expect(manager.send({ type: 'x' })).rejects.toThrow(
        'WebSocket not connected',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // F. isContactAllowedToBeClosed()
  // ---------------------------------------------------------------------------
  describe('isContactAllowedToBeClosed()', () => {
    it('sends a verify_contact_timeout payload', () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      manager.isContactAllowedToBeClosed();

      expect(manager.socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'verify_contact_timeout' }),
      );
    });

    it('resolves when CONTACT_TIMEOUT_ALLOWED_TO_CLOSE is emitted', async () => {
      jest.useFakeTimers();
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      const promise = manager.isContactAllowedToBeClosed();
      manager.emit(SERVICE_EVENTS.CONTACT_TIMEOUT_ALLOWED_TO_CLOSE);

      await expect(promise).resolves.toBeUndefined();

      // Fast-forward past the 30s timeout to confirm it was cleared.
      jest.advanceTimersByTime(31_000);
      jest.useRealTimers();
    });

    it('rejects when CONTACT_TIMEOUT_ERROR is emitted', async () => {
      jest.useFakeTimers();
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      const promise = manager.isContactAllowedToBeClosed();
      const err = new Error('contact still active');
      manager.emit(SERVICE_EVENTS.CONTACT_TIMEOUT_ERROR, err);

      await expect(promise).rejects.toBe(err);
      jest.useRealTimers();
    });

    it('rejects with "Contact timeout" after 30 seconds with no response', async () => {
      jest.useFakeTimers();
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      const promise = manager.isContactAllowedToBeClosed();
      jest.advanceTimersByTime(30_001);

      await expect(promise).rejects.toThrow('Contact timeout');
      jest.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // G. requestVoiceTokens() — gaps not covered by service.test.js
  // ---------------------------------------------------------------------------
  describe('requestVoiceTokens()', () => {
    it('falls back to a top-level token shape when payload has no data wrapper', async () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      const promise = manager.requestVoiceTokens();
      manager.emit(SERVICE_EVENTS.VOICE_TOKENS_RECEIVED, {
        stt_token: 'stt-1',
        tts_token: 'tts-1',
      });

      await expect(promise).resolves.toEqual({
        sttToken: 'stt-1',
        ttsToken: 'tts-1',
      });
    });

    it('rejects when send() rejects (socket not connected)', async () => {
      const manager = createManager();
      manager.socket = null; // forces send() to reject synchronously

      await expect(manager.requestVoiceTokens()).rejects.toThrow(
        'WebSocket not connected',
      );
    });

    it('ignores late VOICE_TOKENS_RECEIVED events after the promise has settled', async () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      const promise = manager.requestVoiceTokens();
      manager.emit(SERVICE_EVENTS.VOICE_TOKENS_RECEIVED, {
        data: { stt_token: 'first', tts_token: 'first' },
      });
      await expect(promise).resolves.toEqual({
        sttToken: 'first',
        ttsToken: 'first',
      });

      // Late emit must not throw or reach any (already-removed) listeners.
      expect(() =>
        manager.emit(SERVICE_EVENTS.VOICE_TOKENS_RECEIVED, {
          data: { stt_token: 'late', tts_token: 'late' },
        }),
      ).not.toThrow();
    });

    it("rejects with 'Failed to get voice tokens' when error payload has no error field", async () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      const promise = manager.requestVoiceTokens();
      manager.emit(SERVICE_EVENTS.VOICE_TOKENS_ERROR, {});

      await expect(promise).rejects.toThrow('Failed to get voice tokens');
    });

    it('ignores a late send-rejection after the timeout has fired', async () => {
      jest.useFakeTimers();
      const manager = createManager();
      // Hold send()'s settle until after the timeout has rejected the outer
      // promise so we can exercise the `if (settled) return` guard.
      let rejectSend;
      jest.spyOn(manager, 'send').mockReturnValue(
        new Promise((_, reject) => {
          rejectSend = reject;
        }),
      );

      const promise = manager.requestVoiceTokens(1000);
      jest.advanceTimersByTime(1000);

      await expect(promise).rejects.toThrow('Voice tokens request timed out');

      // Now reject send; this hits the `if (settled) return` guard. The error
      // must not surface and the process must not see an unhandled rejection.
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);
      rejectSend(new Error('late send failure'));
      await Promise.resolve();
      await Promise.resolve();

      expect(errorHandler).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // H. addProductToCart() — gaps not covered by service.test.js
  // ---------------------------------------------------------------------------
  describe('addProductToCart()', () => {
    const baseProps = {
      VTEXAccountName: 'account',
      orderFormId: 'order-1',
      seller: 'seller-1',
      id: 'item-1',
    };

    it('rejects when a request for the same id is already pending', async () => {
      jest.useFakeTimers();
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      const first = manager.addProductToCart(baseProps);
      // Swallow the eventual rejection from the timeout to keep Jest happy.
      first.catch(() => {});

      await expect(manager.addProductToCart(baseProps)).rejects.toThrow(
        'An add-to-cart request is already pending for item id "item-1"',
      );

      jest.advanceTimersByTime(30_001);
      jest.useRealTimers();
    });

    it('cleans up the pending Map and rejects when send fails', async () => {
      const manager = createManager();
      const sendError = new Error('socket gone');
      manager.socket = makeOpenSocketMock();
      manager.socket.send = jest.fn(() => {
        throw sendError;
      });

      await expect(manager.addProductToCart(baseProps)).rejects.toBe(sendError);
      expect(manager.pendingAddToCartRequests.size).toBe(0);
    });

    it('cleans up gracefully when send rejects after the timeout has cleared the pending entry', async () => {
      jest.useFakeTimers();
      const manager = createManager();
      let rejectSend;
      jest.spyOn(manager, 'send').mockReturnValue(
        new Promise((_, reject) => {
          rejectSend = reject;
        }),
      );

      const promise = manager.addProductToCart(baseProps);
      jest.advanceTimersByTime(30_001);

      await expect(promise).rejects.toThrow(
        'Add to cart request timed out for item id "item-1"',
      );
      expect(manager.pendingAddToCartRequests.size).toBe(0);

      // Late send rejection hits the `if (!pending) return` guard.
      rejectSend(new Error('late send failure'));
      await Promise.resolve();
      await Promise.resolve();

      expect(manager.pendingAddToCartRequests.size).toBe(0);

      jest.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // I. _handleReadyForMessage()
  // ---------------------------------------------------------------------------
  describe('_handleReadyForMessage()', () => {
    it('sets status="connected", resets attempts, and emits status + CONNECTED', () => {
      const manager = createManager();
      jest.spyOn(manager, '_startPingInterval').mockImplementation(() => {});
      jest
        .spyOn(manager, '_requestProjectLanguage')
        .mockImplementation(() => {});
      manager.reconnectAttempts = 5;
      manager._reclaimAttempts = 2;
      const statusHandler = jest.fn();
      const connectedHandler = jest.fn();
      manager.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusHandler);
      manager.on(SERVICE_EVENTS.CONNECTED, connectedHandler);

      manager._handleReadyForMessage({ data: {} });

      expect(manager.status).toBe('connected');
      expect(manager.reconnectAttempts).toBe(0);
      expect(manager._reclaimAttempts).toBe(0);
      expect(statusHandler).toHaveBeenCalledWith('connected');
      expect(connectedHandler).toHaveBeenCalledTimes(1);
    });

    it('calls retryStrategy.reset() when a retryStrategy is configured', () => {
      const retryStrategy = new RetryStrategy();
      const resetSpy = jest.spyOn(retryStrategy, 'reset');
      const manager = createManager({ retryStrategy });
      jest.spyOn(manager, '_startPingInterval').mockImplementation(() => {});
      jest
        .spyOn(manager, '_requestProjectLanguage')
        .mockImplementation(() => {});

      manager._handleReadyForMessage({ data: {} });

      expect(resetSpy).toHaveBeenCalledTimes(1);
    });

    it('does not throw when no retryStrategy is configured', () => {
      const manager = createManager();
      jest.spyOn(manager, '_startPingInterval').mockImplementation(() => {});
      jest
        .spyOn(manager, '_requestProjectLanguage')
        .mockImplementation(() => {});

      expect(() => manager._handleReadyForMessage({ data: {} })).not.toThrow();
    });

    it('starts the ping interval and requests the project language', () => {
      const manager = createManager();
      const startPing = jest
        .spyOn(manager, '_startPingInterval')
        .mockImplementation(() => {});
      const requestLang = jest
        .spyOn(manager, '_requestProjectLanguage')
        .mockImplementation(() => {});

      manager._handleReadyForMessage({ data: {} });

      expect(startPing).toHaveBeenCalledTimes(1);
      expect(requestLang).toHaveBeenCalledTimes(1);
    });

    it('defaults data to {} when called with no argument', () => {
      const manager = createManager();
      jest.spyOn(manager, '_startPingInterval').mockImplementation(() => {});
      jest
        .spyOn(manager, '_requestProjectLanguage')
        .mockImplementation(() => {});
      const voiceHandler = jest.fn();
      const connectedHandler = jest.fn();
      manager.on(SERVICE_EVENTS.VOICE_ENABLED, voiceHandler);
      manager.on(SERVICE_EVENTS.CONNECTED, connectedHandler);

      manager._handleReadyForMessage();

      expect(manager.status).toBe('connected');
      expect(voiceHandler).not.toHaveBeenCalled();
      expect(connectedHandler).toHaveBeenCalledTimes(1);
    });

    it('emits VOICE_ENABLED before CONNECTED when voice_enabled is true', () => {
      const manager = createManager();
      jest.spyOn(manager, '_startPingInterval').mockImplementation(() => {});
      jest
        .spyOn(manager, '_requestProjectLanguage')
        .mockImplementation(() => {});
      const order = [];
      manager.on(SERVICE_EVENTS.VOICE_ENABLED, () => order.push('voice'));
      manager.on(SERVICE_EVENTS.CONNECTED, () => order.push('connected'));

      manager._handleReadyForMessage({ data: { voice_enabled: true } });

      expect(order).toEqual(['voice', 'connected']);
    });
  });

  // ---------------------------------------------------------------------------
  // J. _handleMessage dispatch — uncovered branches
  // ---------------------------------------------------------------------------
  describe('_handleMessage dispatch', () => {
    it('treats { type: "pong" } as a no-op', () => {
      const manager = createManager();
      const emitSpy = jest.spyOn(manager, 'emit');

      sendMessage(manager, { type: 'pong' });

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('emits CONTACT_TIMEOUT_ALLOWED_TO_CLOSE on { type: "allow_contact_timeout" }', () => {
      const manager = createManager();
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.CONTACT_TIMEOUT_ALLOWED_TO_CLOSE, handler);

      sendMessage(manager, { type: 'allow_contact_timeout' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits LANGUAGE_CHANGED with data.data.language on { type: "project_language" }', () => {
      const manager = createManager();
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.LANGUAGE_CHANGED, handler);

      sendMessage(manager, {
        type: 'project_language',
        data: { language: 'pt-br' },
      });

      expect(handler).toHaveBeenCalledWith('pt-br');
    });

    it('emits VOICE_TOKENS_RECEIVED with full payload on { type: "voice_tokens" }', () => {
      const manager = createManager();
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.VOICE_TOKENS_RECEIVED, handler);

      const payload = {
        type: 'voice_tokens',
        data: { stt_token: 'stt', tts_token: 'tts' },
      };
      sendMessage(manager, payload);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('emits VOICE_TOKENS_ERROR with full payload on { type: "voice_tokens_error" }', () => {
      const manager = createManager();
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.VOICE_TOKENS_ERROR, handler);

      const payload = { type: 'voice_tokens_error', error: 'boom' };
      sendMessage(manager, payload);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('still emits CART_UPDATED for cart_updated when no pending request matches', () => {
      const manager = createManager();
      const cartHandler = jest.fn();
      manager.on(SERVICE_EVENTS.CART_UPDATED, cartHandler);

      const payload = { type: 'cart_updated', data: { item_id: 'item-x' } };
      sendMessage(manager, payload);

      expect(cartHandler).toHaveBeenCalledWith(payload);
      expect(manager.pendingAddToCartRequests.size).toBe(0);
    });

    it('is a no-op on cart_error when no pending request matches', () => {
      const manager = createManager();
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      expect(() =>
        sendMessage(manager, {
          type: 'cart_error',
          error: 'boom',
          data: { item_id: 'unknown' },
        }),
      ).not.toThrow();
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it('strips the "verify contact timeout: " prefix into a CONTACT_TIMEOUT_ERROR', () => {
      const manager = createManager();
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.CONTACT_TIMEOUT_ERROR, handler);

      sendMessage(manager, {
        type: 'error',
        error: 'verify contact timeout: contact still active',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(handler.mock.calls[0][0].message).toBe('contact still active');
    });

    it('disconnects permanently with status="closed" on { type: "warning", warning: "Connection closed by request" }', () => {
      const manager = createManager();
      const disconnectSpy = jest
        .spyOn(manager, 'disconnect')
        .mockImplementation(() => {});

      sendMessage(manager, {
        type: 'warning',
        warning: 'Connection closed by request',
      });

      expect(disconnectSpy).toHaveBeenCalledWith(true, 'closed');
    });

    it('flips isRegistered=false on a generic "unable to register" error and emits ERROR', () => {
      const manager = createManager();
      manager.isRegistered = true;
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);
      const closeOthersSpy = jest
        .spyOn(manager, '_closeOthersConnections')
        .mockImplementation(() => {});

      sendMessage(manager, {
        type: 'error',
        error: 'unable to register: invalid token',
      });

      expect(manager.isRegistered).toBe(false);
      expect(manager._reclaimAttempts).toBe(0);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toBe(
        'unable to register: invalid token',
      );
      expect(closeOthersSpy).not.toHaveBeenCalled();
    });

    it('flips isRegistered=false on a generic "already exists" error', () => {
      const manager = createManager();
      manager.isRegistered = true;

      sendMessage(manager, {
        type: 'error',
        error: 'something already exists somewhere',
      });

      expect(manager.isRegistered).toBe(false);
    });

    it('uses "Unknown server error" when error type has no message', () => {
      const manager = createManager();
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      sendMessage(manager, { type: 'error' });

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toBe(
        'Unknown server error',
      );
    });

    it('falls through to MESSAGE for unrecognized types', () => {
      const manager = createManager();
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.MESSAGE, handler);

      const payload = { type: 'custom_thing', payload: 1 };
      sendMessage(manager, payload);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('emits ERROR with "Failed to parse message: " prefix on invalid JSON', () => {
      const manager = createManager();
      const errorHandler = jest.fn();
      manager.on(SERVICE_EVENTS.ERROR, errorHandler);

      expect(() => manager._handleMessage({ data: 'not-json' })).not.toThrow();

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(errorHandler.mock.calls[0][0].message).toMatch(
        /^Failed to parse message: /,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // K. _handleDisconnect()
  // ---------------------------------------------------------------------------
  describe('_handleDisconnect()', () => {
    it('emits status + DISCONNECTED and schedules a reconnect when wasConnected and below cap', () => {
      const manager = createManager();
      manager.status = 'connected';
      manager.isRegistered = true;
      manager.pingTimer = setInterval(() => {}, 1000);
      const scheduleSpy = jest
        .spyOn(manager, '_scheduleReconnect')
        .mockImplementation(() => {});
      const stopPingSpy = jest.spyOn(manager, '_stopPingInterval');
      const statusHandler = jest.fn();
      const disconnectedHandler = jest.fn();
      manager.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusHandler);
      manager.on(SERVICE_EVENTS.DISCONNECTED, disconnectedHandler);

      manager._handleDisconnect({});

      expect(manager.status).toBe('disconnected');
      expect(manager.isRegistered).toBe(false);
      expect(stopPingSpy).toHaveBeenCalled();
      expect(statusHandler).toHaveBeenCalledWith('disconnected');
      expect(disconnectedHandler).toHaveBeenCalledTimes(1);
      expect(scheduleSpy).toHaveBeenCalledTimes(1);
    });

    it('schedules a reconnect when wasDisconnecting', () => {
      const manager = createManager();
      manager.status = 'disconnecting';
      const scheduleSpy = jest
        .spyOn(manager, '_scheduleReconnect')
        .mockImplementation(() => {});

      manager._handleDisconnect({});

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
    });

    it('does not emit status/DISCONNECTED and does not reconnect when wasClosed', () => {
      const manager = createManager();
      manager.status = 'closed';
      const scheduleSpy = jest
        .spyOn(manager, '_scheduleReconnect')
        .mockImplementation(() => {});
      const statusHandler = jest.fn();
      const disconnectedHandler = jest.fn();
      manager.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusHandler);
      manager.on(SERVICE_EVENTS.DISCONNECTED, disconnectedHandler);

      manager._handleDisconnect({});

      expect(statusHandler).not.toHaveBeenCalled();
      expect(disconnectedHandler).not.toHaveBeenCalled();
      expect(scheduleSpy).not.toHaveBeenCalled();
      expect(manager.status).toBe('disconnected');
    });

    it('does not schedule a reconnect when autoReconnect=false', () => {
      const manager = createManager({ autoReconnect: false });
      manager.status = 'connected';
      const scheduleSpy = jest
        .spyOn(manager, '_scheduleReconnect')
        .mockImplementation(() => {});

      manager._handleDisconnect({});

      expect(scheduleSpy).not.toHaveBeenCalled();
    });

    it('does not schedule a reconnect when reconnectAttempts has reached the cap', () => {
      const manager = createManager({ maxReconnectAttempts: 2 });
      manager.status = 'connected';
      manager.reconnectAttempts = 2;
      const scheduleSpy = jest
        .spyOn(manager, '_scheduleReconnect')
        .mockImplementation(() => {});

      manager._handleDisconnect({});

      expect(scheduleSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // L. _scheduleReconnect() with RetryStrategy
  // ---------------------------------------------------------------------------
  describe('_scheduleReconnect() with RetryStrategy', () => {
    it('uses retryStrategy.next() for the delay when one is configured', () => {
      jest.useFakeTimers();
      const retryStrategy = new RetryStrategy();
      const nextSpy = jest.spyOn(retryStrategy, 'next').mockReturnValue(1234);
      const manager = createManager({
        maxReconnectAttempts: 5,
        retryStrategy,
      });
      jest.spyOn(manager, 'connect').mockResolvedValue(undefined);

      manager._scheduleReconnect();

      expect(nextSpy).toHaveBeenCalledTimes(1);
      // Confirm the timer didn't fire yet at < 1234ms.
      jest.advanceTimersByTime(1233);
      expect(manager.reconnectAttempts).toBe(0);
      jest.advanceTimersByTime(1);
      expect(manager.reconnectAttempts).toBe(1);

      jest.useRealTimers();
    });

    it('falls back to config.reconnectInterval when no retryStrategy is configured', () => {
      jest.useFakeTimers();
      const manager = createManager({
        maxReconnectAttempts: 5,
        reconnectInterval: 500,
      });
      jest.spyOn(manager, 'connect').mockResolvedValue(undefined);

      manager._scheduleReconnect();
      jest.advanceTimersByTime(499);
      expect(manager.reconnectAttempts).toBe(0);
      jest.advanceTimersByTime(1);
      expect(manager.reconnectAttempts).toBe(1);

      jest.useRealTimers();
    });

    it('after the timer fires, increments reconnectAttempts, emits RECONNECTING, and calls connect()', () => {
      jest.useFakeTimers();
      const manager = createManager({
        maxReconnectAttempts: 5,
        reconnectInterval: 100,
      });
      const connectSpy = jest
        .spyOn(manager, 'connect')
        .mockResolvedValue(undefined);
      const reconnectingHandler = jest.fn();
      manager.on(SERVICE_EVENTS.RECONNECTING, reconnectingHandler);

      manager._scheduleReconnect();
      jest.advanceTimersByTime(100);

      expect(manager.reconnectAttempts).toBe(1);
      expect(reconnectingHandler).toHaveBeenCalledWith(1);
      expect(connectSpy).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // M. _startPingInterval() / _stopPingInterval()
  // ---------------------------------------------------------------------------
  describe('_startPingInterval() / _stopPingInterval()', () => {
    it('sends a ping every pingInterval ms when the socket is OPEN', () => {
      jest.useFakeTimers();
      const manager = createManager({ pingInterval: 1000 });
      manager.socket = makeOpenSocketMock();

      manager._startPingInterval();
      jest.advanceTimersByTime(1000);
      jest.advanceTimersByTime(1000);

      expect(manager.socket.send).toHaveBeenCalledTimes(2);
      expect(manager.socket.send).toHaveBeenLastCalledWith(
        JSON.stringify({ type: 'ping' }),
      );

      manager._stopPingInterval();
      jest.useRealTimers();
    });

    it('does not send a ping when the socket is not OPEN', () => {
      jest.useFakeTimers();
      const manager = createManager({ pingInterval: 1000 });
      manager.socket = makeSocketMock(3); // CLOSED

      manager._startPingInterval();
      jest.advanceTimersByTime(5000);

      expect(manager.socket.send).not.toHaveBeenCalled();

      manager._stopPingInterval();
      jest.useRealTimers();
    });

    it('_stopPingInterval clears the timer and is idempotent', () => {
      const manager = createManager();
      manager.pingTimer = setInterval(() => {}, 1000);

      manager._stopPingInterval();
      expect(manager.pingTimer).toBeNull();

      // Calling twice is safe.
      expect(() => manager._stopPingInterval()).not.toThrow();
      expect(manager.pingTimer).toBeNull();
    });

    it('starting twice clears the previous timer (no double pings)', () => {
      jest.useFakeTimers();
      const manager = createManager({ pingInterval: 1000 });
      manager.socket = makeOpenSocketMock();

      manager._startPingInterval();
      const firstTimer = manager.pingTimer;
      manager._startPingInterval();
      const secondTimer = manager.pingTimer;

      expect(firstTimer).not.toBe(secondTimer);

      jest.advanceTimersByTime(1000);
      expect(manager.socket.send).toHaveBeenCalledTimes(1);

      manager._stopPingInterval();
      jest.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // O. _requestProjectLanguage()
  // ---------------------------------------------------------------------------
  describe('_requestProjectLanguage()', () => {
    it('sends a get_project_language payload', () => {
      const manager = createManager();
      manager.socket = makeOpenSocketMock();

      manager._requestProjectLanguage();

      expect(manager.socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'get_project_language' }),
      );
    });
  });
});
