import WebSocketManager from '../src/core/WebSocketManager';
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

function makeOpenSocketMock() {
  return {
    readyState: 1,
    send: jest.fn(),
    close: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
}

describe('WebSocketManager', () => {
  beforeEach(() => {
    global.WebSocket = jest
      .fn()
      .mockImplementation(() => makeOpenSocketMock());
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
});
