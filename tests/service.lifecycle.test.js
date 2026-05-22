import WeniWebchatService from '../src/index';
import { SERVICE_EVENTS } from '../src/utils/constants';
import {
  installBrowserMocks,
  makeOpenSocketMock,
  makeConfig,
} from './_helpers/serviceMocks';

describe('WeniWebchatService — lifecycle', () => {
  let service;

  beforeEach(() => {
    installBrowserMocks();
  });

  afterEach(() => {
    if (service) {
      service.destroy();
      service = null;
    }
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // init()
  // ---------------------------------------------------------------------------
  describe('init()', () => {
    it('is idempotent when called twice', async () => {
      service = new WeniWebchatService(makeConfig());
      jest.spyOn(service, '_ensureRenderDecision').mockReturnValue(true);
      jest.spyOn(service, 'restoreOrCreateSession').mockResolvedValue();
      jest.spyOn(service, 'connect').mockResolvedValue();
      const initListener = jest.fn();
      service.on(SERVICE_EVENTS.INITIALIZED, initListener);

      await service.init();
      const second = await service.init();

      expect(initListener).toHaveBeenCalledTimes(1);
      expect(second).toBeUndefined();
    });

    it('returns { shouldRender: false } and skips bootstrap when render decision is false', async () => {
      service = new WeniWebchatService(makeConfig());
      jest.spyOn(service, '_ensureRenderDecision').mockReturnValue(false);
      const restoreSpy = jest
        .spyOn(service, 'restoreOrCreateSession')
        .mockResolvedValue();
      const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue();

      const result = await service.init();

      expect(result).toEqual({ shouldRender: false });
      expect(service._renderEnabled).toBe(false);
      expect(restoreSpy).not.toHaveBeenCalled();
      expect(connectSpy).not.toHaveBeenCalled();
      expect(service._initialized).toBe(false);
    });

    it('restores session, enqueues pending messages, and connects when mode=live + connectOn=mount', async () => {
      service = new WeniWebchatService(makeConfig());
      jest.spyOn(service, '_ensureRenderDecision').mockReturnValue(true);
      jest.spyOn(service, 'restoreOrCreateSession').mockResolvedValue();
      const pending = [
        { id: 'msg_a', status: 'pending', text: 'Hi' },
        { id: 'msg_b', status: 'sent', text: 'Old' },
      ];
      jest.spyOn(service.state, 'getMessages').mockReturnValue(pending);
      const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue();
      const initListener = jest.fn();
      service.on(SERVICE_EVENTS.INITIALIZED, initListener);

      const result = await service.init();

      expect(service.messagesQueue).toEqual([pending[0]]);
      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(service._initialized).toBe(true);
      expect(initListener).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ shouldRender: true });
    });

    it('does not connect when connectOn=manual', async () => {
      service = new WeniWebchatService(makeConfig({ connectOn: 'manual' }));
      jest.spyOn(service, '_ensureRenderDecision').mockReturnValue(true);
      jest.spyOn(service, 'restoreOrCreateSession').mockResolvedValue();
      jest.spyOn(service.state, 'getMessages').mockReturnValue([]);
      const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue();

      await service.init();

      expect(connectSpy).not.toHaveBeenCalled();
      expect(service._initialized).toBe(true);
    });

    it('connects when connectOn=demand AND there are pending messages', async () => {
      service = new WeniWebchatService(makeConfig({ connectOn: 'demand' }));
      jest.spyOn(service, '_ensureRenderDecision').mockReturnValue(true);
      jest.spyOn(service, 'restoreOrCreateSession').mockResolvedValue();
      jest
        .spyOn(service.state, 'getMessages')
        .mockReturnValue([{ id: 'msg_pending', status: 'pending' }]);
      const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue();

      await service.init();

      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it('does not connect when connectOn=demand AND no pending messages', async () => {
      service = new WeniWebchatService(makeConfig({ connectOn: 'demand' }));
      jest.spyOn(service, '_ensureRenderDecision').mockReturnValue(true);
      jest.spyOn(service, 'restoreOrCreateSession').mockResolvedValue();
      jest.spyOn(service.state, 'getMessages').mockReturnValue([]);
      const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue();

      await service.init();

      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('never connects when mode=preview, even with pending messages', async () => {
      service = new WeniWebchatService(
        makeConfig({ mode: 'preview', connectOn: 'mount' }),
      );
      jest.spyOn(service, '_ensureRenderDecision').mockReturnValue(true);
      jest.spyOn(service, 'restoreOrCreateSession').mockResolvedValue();
      jest
        .spyOn(service.state, 'getMessages')
        .mockReturnValue([{ id: 'msg_x', status: 'pending' }]);
      const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue();

      await service.init();

      expect(connectSpy).not.toHaveBeenCalled();
      expect(service._initialized).toBe(true);
    });

    it('captures errors via state.setError + ERROR event but the finally-return swallows the throw', async () => {
      // Documents existing behavior: the `return` inside `finally` overrides
      // the `throw error` in the catch block, so init() resolves with
      // { shouldRender: true } even when restore fails.
      service = new WeniWebchatService(makeConfig());
      jest.spyOn(service, '_ensureRenderDecision').mockReturnValue(true);
      const boom = new Error('restore boom');
      jest.spyOn(service, 'restoreOrCreateSession').mockRejectedValue(boom);
      const setErrorSpy = jest.spyOn(service.state, 'setError');
      const errorListener = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, errorListener);

      const result = await service.init();

      expect(setErrorSpy).toHaveBeenCalledWith(boom);
      expect(errorListener).toHaveBeenCalledWith(boom);
      expect(result).toEqual({ shouldRender: true });
      expect(service._initialized).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // connect()
  // ---------------------------------------------------------------------------
  describe('connect()', () => {
    it('returns immediately when already _connected', async () => {
      service = new WeniWebchatService(makeConfig());
      service._connected = true;
      const wsConnectSpy = jest
        .spyOn(service.websocket, 'connect')
        .mockResolvedValue();

      await service.connect();

      expect(wsConnectSpy).not.toHaveBeenCalled();
    });

    it('returns immediately when _connecting is in flight', async () => {
      service = new WeniWebchatService(makeConfig());
      service._connecting = true;
      const wsConnectSpy = jest
        .spyOn(service.websocket, 'connect')
        .mockResolvedValue();

      await service.connect();

      expect(wsConnectSpy).not.toHaveBeenCalled();
    });

    it('short-circuits silently when mode=preview', async () => {
      service = new WeniWebchatService(makeConfig({ mode: 'preview' }));
      const wsConnectSpy = jest
        .spyOn(service.websocket, 'connect')
        .mockResolvedValue();
      const setRegSpy = jest.spyOn(service.websocket, 'setRegistrationData');

      await service.connect();

      expect(wsConnectSpy).not.toHaveBeenCalled();
      expect(setRegSpy).not.toHaveBeenCalled();
      expect(service._connecting).toBeFalsy();
    });

    it('reuses an existing session id without recreating it', async () => {
      service = new WeniWebchatService(makeConfig());
      service.session.createNewSession();
      const existingId = service.session.getSessionId();
      const getOrCreateSpy = jest.spyOn(service.session, 'getOrCreate');
      const setSessionSpy = jest.spyOn(service.state, 'setSession');
      jest.spyOn(service.websocket, 'connect').mockResolvedValue();

      await service.connect();

      expect(getOrCreateSpy).not.toHaveBeenCalled();
      expect(setSessionSpy).not.toHaveBeenCalled();
      expect(service.session.getSessionId()).toBe(existingId);
    });

    it('creates and registers a new session when none exists', async () => {
      service = new WeniWebchatService(
        makeConfig({ callbackUrl: 'https://cb.example.com', storage: 'local' }),
      );
      jest.spyOn(service.session, 'getSessionId').mockReturnValueOnce(null);
      const getOrCreateSpy = jest
        .spyOn(service.session, 'getOrCreate')
        .mockReturnValue('new-session-id');
      const fakeSession = { id: 'new-session-id', conversation: [] };
      jest.spyOn(service.session, 'getSession').mockReturnValue(fakeSession);
      const setSessionSpy = jest.spyOn(service.state, 'setSession');
      const setRegSpy = jest.spyOn(service.websocket, 'setRegistrationData');
      jest.spyOn(service.websocket, 'connect').mockResolvedValue();

      await service.connect();

      expect(getOrCreateSpy).toHaveBeenCalledTimes(1);
      expect(setSessionSpy).toHaveBeenCalledWith(fakeSession);
      expect(setRegSpy).toHaveBeenCalledWith({
        from: 'new-session-id',
        callback: 'https://cb.example.com',
        session_type: 'local',
      });
    });

    it('skips state.setSession when getSession returns null after getOrCreate', async () => {
      service = new WeniWebchatService(makeConfig());
      jest.spyOn(service.session, 'getSessionId').mockReturnValue(null);
      jest.spyOn(service.session, 'getOrCreate').mockReturnValue('id');
      jest.spyOn(service.session, 'getSession').mockReturnValue(null);
      const setSessionSpy = jest.spyOn(service.state, 'setSession');
      jest.spyOn(service.websocket, 'connect').mockResolvedValue();

      await service.connect();

      expect(setSessionSpy).not.toHaveBeenCalled();
    });

    it('rethrows, sets state.error and emits ERROR when websocket.connect rejects', async () => {
      service = new WeniWebchatService(makeConfig());
      service.session.createNewSession();
      const boom = new Error('socket down');
      jest.spyOn(service.websocket, 'connect').mockRejectedValue(boom);
      const setErrorSpy = jest.spyOn(service.state, 'setError');
      const errorListener = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, errorListener);

      await expect(service.connect()).rejects.toBe(boom);

      expect(setErrorSpy).toHaveBeenCalledWith(boom);
      expect(errorListener).toHaveBeenCalledWith(boom);
      expect(service._connecting).toBe(false);
    });

    it('clears _connecting in the finally block on success', async () => {
      service = new WeniWebchatService(makeConfig());
      service.session.createNewSession();
      jest.spyOn(service.websocket, 'connect').mockResolvedValue();

      await service.connect();

      expect(service._connecting).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // disconnect()
  // ---------------------------------------------------------------------------
  describe('disconnect()', () => {
    it('forwards permanent=true (default) to websocket.disconnect and resets _connected', () => {
      service = new WeniWebchatService(makeConfig());
      service._connected = true;
      const disconnectSpy = jest
        .spyOn(service.websocket, 'disconnect')
        .mockImplementation(() => {});

      service.disconnect();

      expect(disconnectSpy).toHaveBeenCalledWith(true);
      expect(service._connected).toBe(false);
    });

    it('forwards permanent=false when requested', () => {
      service = new WeniWebchatService(makeConfig());
      const disconnectSpy = jest
        .spyOn(service.websocket, 'disconnect')
        .mockImplementation(() => {});

      service.disconnect(false);

      expect(disconnectSpy).toHaveBeenCalledWith(false);
      expect(service._connected).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // _handleWebSocketConnected()
  // ---------------------------------------------------------------------------
  describe('_handleWebSocketConnected()', () => {
    function flushMicrotasks() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('prunes msg_-prefixed local non-persisted incoming/outgoing-sent ids after history loads', async () => {
      service = new WeniWebchatService(makeConfig());
      service.session.createNewSession();

      const conversation = [
        // KEEP: persisted overrides everything
        {
          id: 'msg_persisted',
          direction: 'incoming',
          status: 'delivered',
          persisted: true,
        },
        // PRUNE: msg_-prefixed incoming, not persisted
        { id: 'msg_in_1', direction: 'incoming', status: 'delivered' },
        // PRUNE: msg_-prefixed outgoing-sent, not persisted
        { id: 'msg_out_sent', direction: 'outgoing', status: 'sent' },
        // KEEP: outgoing-pending (not 'sent')
        { id: 'msg_out_pending', direction: 'outgoing', status: 'pending' },
        // KEEP: id without msg_ prefix
        { id: 'history_1', direction: 'incoming', status: 'delivered' },
      ];
      service.session.setConversation(conversation);

      // After history merge the state already reflects merged messages —
      // simulate that by leaving the same conversation in state.
      jest.spyOn(service.state, 'getMessages').mockReturnValue(conversation);
      jest.spyOn(service, 'getHistory').mockResolvedValue([]);
      const setStateSpy = jest.spyOn(service.state, 'setState');
      const setConvSpy = jest.spyOn(service.session, 'setConversation');
      const runQueueSpy = jest
        .spyOn(service, 'runQueue')
        .mockImplementation(() => {});

      service._handleWebSocketConnected();

      expect(service.getHistory).toHaveBeenCalledWith({ page: 1, limit: 20 });
      expect(runQueueSpy).toHaveBeenCalledTimes(1);

      await flushMicrotasks();

      const filtered = setStateSpy.mock.calls[0][0].messages;
      const filteredIds = filtered.map((m) => m.id).sort();
      expect(filteredIds).toEqual(
        ['history_1', 'msg_out_pending', 'msg_persisted'].sort(),
      );
      expect(setConvSpy).toHaveBeenCalledWith(filtered);
    });

    it('does not touch state when there are no local ids to prune', async () => {
      service = new WeniWebchatService(makeConfig());
      service.session.createNewSession();
      service.session.setConversation([]);

      jest.spyOn(service, 'getHistory').mockResolvedValue([]);
      const setStateSpy = jest.spyOn(service.state, 'setState');
      const setConvSpy = jest.spyOn(service.session, 'setConversation');
      const runQueueSpy = jest
        .spyOn(service, 'runQueue')
        .mockImplementation(() => {});

      service._handleWebSocketConnected();

      expect(runQueueSpy).toHaveBeenCalledTimes(1);

      await flushMicrotasks();

      expect(setStateSpy).not.toHaveBeenCalled();
      expect(setConvSpy).not.toHaveBeenCalled();
    });

    it('calls runQueue synchronously, before getHistory has settled', () => {
      service = new WeniWebchatService(makeConfig());
      service.session.createNewSession();
      service.session.setConversation([]);
      // A never-settling promise proves runQueue is invoked synchronously
      // and is not awaiting the history call. (The orchestrator's
      // `getHistory().then(...)` is fire-and-forget by design — see
      // `_handleWebSocketConnected` in src/index.js.)
      jest.spyOn(service, 'getHistory').mockReturnValue(new Promise(() => {}));
      const runQueueSpy = jest
        .spyOn(service, 'runQueue')
        .mockImplementation(() => {});

      service._handleWebSocketConnected();

      expect(runQueueSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getHistory()
  // ---------------------------------------------------------------------------
  describe('getHistory()', () => {
    it('merges fetched history into state and session, then returns the raw messages', async () => {
      service = new WeniWebchatService(makeConfig());
      service.session.createNewSession();
      const fetched = [
        { id: 'h1', text: 'one', timestamp: 1 },
        { id: 'h2', text: 'two', timestamp: 2 },
      ];
      const merged = [...fetched, { id: 'local', text: 'local' }];
      jest.spyOn(service.history, 'request').mockResolvedValue(fetched);
      jest.spyOn(service.history, 'merge').mockReturnValue(merged);
      const setStateSpy = jest.spyOn(service.state, 'setState');
      const setConvSpy = jest.spyOn(service.session, 'setConversation');

      const result = await service.getHistory({ page: 2, limit: 10 });

      expect(service.history.request).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
      });
      expect(service.history.merge).toHaveBeenCalled();
      expect(setStateSpy).toHaveBeenCalledWith({ messages: merged });
      expect(setConvSpy).toHaveBeenCalledWith(merged);
      expect(result).toBe(fetched);
    });

    it('emits ERROR and rethrows when history.request rejects', async () => {
      service = new WeniWebchatService(makeConfig());
      service.session.createNewSession();
      const boom = new Error('history broke');
      jest.spyOn(service.history, 'request').mockRejectedValue(boom);
      const errorListener = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, errorListener);

      await expect(service.getHistory({})).rejects.toBe(boom);
      expect(errorListener).toHaveBeenCalledWith(boom);
    });

    it('uses {} as the default options when called with no args (line 524 default param)', async () => {
      // Covers the `options = {}` default-parameter branch of getHistory()
      // at line 524 of src/index.js.
      service = new WeniWebchatService(makeConfig());
      service.session.createNewSession();
      const requestSpy = jest
        .spyOn(service.history, 'request')
        .mockResolvedValue([]);
      jest.spyOn(service.history, 'merge').mockReturnValue([]);

      await service.getHistory();

      expect(requestSpy).toHaveBeenCalledWith({});
    });
  });

  // ---------------------------------------------------------------------------
  // restoreOrCreateSession() / createNewSession()
  // ---------------------------------------------------------------------------
  describe('restoreOrCreateSession() / createNewSession()', () => {
    it('emits SESSION_RESTORED and writes state when restore yields a session', async () => {
      service = new WeniWebchatService(makeConfig());
      const restored = {
        id: 'restored@example.com',
        createdAt: 1,
        lastActivity: 2,
        conversation: [],
      };
      jest.spyOn(service.session, 'restore').mockResolvedValue(restored);
      const setSessionSpy = jest.spyOn(service.state, 'setSession');
      const restoredListener = jest.fn();
      service.on(SERVICE_EVENTS.SESSION_RESTORED, restoredListener);

      await service.restoreOrCreateSession();

      expect(setSessionSpy).toHaveBeenCalledWith(restored);
      expect(restoredListener).toHaveBeenCalledWith(restored);
    });

    it('falls back to createNewSession when restore returns null', async () => {
      service = new WeniWebchatService(makeConfig());
      jest.spyOn(service.session, 'restore').mockResolvedValue(null);
      const createSpy = jest.spyOn(service, 'createNewSession');
      const restoredListener = jest.fn();
      service.on(SERVICE_EVENTS.SESSION_RESTORED, restoredListener);

      await service.restoreOrCreateSession();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(restoredListener).not.toHaveBeenCalled();
      expect(service.session.getSession()).not.toBeNull();
    });

    it('createNewSession() forwards the new session into state', () => {
      service = new WeniWebchatService(makeConfig());
      const setSessionSpy = jest.spyOn(service.state, 'setSession');

      service.createNewSession();

      const session = service.session.getSession();
      expect(session).not.toBeNull();
      expect(setSessionSpy).toHaveBeenCalledWith(session);
    });
  });

  // ---------------------------------------------------------------------------
  // Smoke: helpers wire-through (sanity that the makeOpenSocketMock helper
  // still satisfies WebSocketManager assumptions)
  // ---------------------------------------------------------------------------
  describe('mock helpers', () => {
    it('makeOpenSocketMock yields a socket with WebSocket.OPEN readyState by default', () => {
      const sock = makeOpenSocketMock();
      expect(sock.readyState).toBe(global.WebSocket.OPEN);
      expect(typeof sock.send).toBe('function');
      expect(typeof sock.close).toBe('function');
      expect(typeof sock.addEventListener).toBe('function');
    });
  });
});
