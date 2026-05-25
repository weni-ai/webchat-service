import WeniWebchatService from '../src/index';
import { SERVICE_EVENTS } from '../src/utils/constants';
import {
  installBrowserMocks,
  makeOpenSocketMock,
  makeConfig,
} from './_helpers/serviceMocks';

/**
 * Drains pending microtasks. Needed because some relays (notably the
 * CONTACT_TIMEOUT_MAXIMUM_TIME_REACHED flow) chain through awaits + thens.
 */
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WeniWebchatService — _setupEventListeners wiring', () => {
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

  // ===========================================================================
  // A. WebSocket → service
  // ===========================================================================
  describe('WebSocket relays', () => {
    it('forwards RECONNECTING and updates state.connection.reconnectAttempts', () => {
      const setStatusSpy = jest.spyOn(service.state, 'setConnectionStatus');
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.RECONNECTING, listener);

      service.websocket.emit(SERVICE_EVENTS.RECONNECTING, 5);

      expect(setStatusSpy).toHaveBeenCalledWith('reconnecting', {
        reconnectAttempts: 5,
      });
      expect(listener).toHaveBeenCalledWith(5);
    });

    it('handles CONNECTION_STATUS_CHANGED "connected": flips _connected, emits CONNECTED, calls _handleWebSocketConnected', () => {
      const handleSpy = jest
        .spyOn(service, '_handleWebSocketConnected')
        .mockImplementation(() => {});
      const setStatusSpy = jest.spyOn(service.state, 'setConnectionStatus');
      const connectedListener = jest.fn();
      const statusListener = jest.fn();
      service.on(SERVICE_EVENTS.CONNECTED, connectedListener);
      service.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusListener);

      service.websocket.emit(
        SERVICE_EVENTS.CONNECTION_STATUS_CHANGED,
        'connected',
      );

      expect(service._connected).toBe(true);
      expect(connectedListener).toHaveBeenCalledTimes(1);
      expect(handleSpy).toHaveBeenCalledTimes(1);
      expect(setStatusSpy).toHaveBeenCalledWith('connected');
      expect(statusListener).toHaveBeenCalledWith('connected');
    });

    it('handles CONNECTION_STATUS_CHANGED "disconnected": resets _connected and emits DISCONNECTED', () => {
      service._connected = true;
      const disconnectedListener = jest.fn();
      const statusListener = jest.fn();
      service.on(SERVICE_EVENTS.DISCONNECTED, disconnectedListener);
      service.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusListener);
      const setStatusSpy = jest.spyOn(service.state, 'setConnectionStatus');

      service.websocket.emit(
        SERVICE_EVENTS.CONNECTION_STATUS_CHANGED,
        'disconnected',
      );

      expect(service._connected).toBe(false);
      expect(disconnectedListener).toHaveBeenCalledTimes(1);
      expect(setStatusSpy).toHaveBeenCalledWith('disconnected');
      expect(statusListener).toHaveBeenCalledWith('disconnected');
    });

    it('handles CONNECTION_STATUS_CHANGED "closed": resets _connected and emits CLOSED', () => {
      service._connected = true;
      const closedListener = jest.fn();
      const statusListener = jest.fn();
      service.on(SERVICE_EVENTS.CLOSED, closedListener);
      service.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusListener);

      service.websocket.emit(
        SERVICE_EVENTS.CONNECTION_STATUS_CHANGED,
        'closed',
      );

      expect(service._connected).toBe(false);
      expect(closedListener).toHaveBeenCalledTimes(1);
      expect(statusListener).toHaveBeenCalledWith('closed');
    });

    it('handles unknown CONNECTION_STATUS_CHANGED status without flipping _connected', () => {
      service._connected = true;
      const connectedListener = jest.fn();
      const disconnectedListener = jest.fn();
      const closedListener = jest.fn();
      const statusListener = jest.fn();
      service.on(SERVICE_EVENTS.CONNECTED, connectedListener);
      service.on(SERVICE_EVENTS.DISCONNECTED, disconnectedListener);
      service.on(SERVICE_EVENTS.CLOSED, closedListener);
      service.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, statusListener);

      service.websocket.emit(
        SERVICE_EVENTS.CONNECTION_STATUS_CHANGED,
        'connecting',
      );

      expect(service._connected).toBe(true);
      expect(connectedListener).not.toHaveBeenCalled();
      expect(disconnectedListener).not.toHaveBeenCalled();
      expect(closedListener).not.toHaveBeenCalled();
      expect(statusListener).toHaveBeenCalledWith('connecting');
    });

    it('forwards MESSAGE to messageProcessor.process()', () => {
      const processSpy = jest
        .spyOn(service.messageProcessor, 'process')
        .mockImplementation(() => {});

      const msg = { type: 'something' };
      service.websocket.emit(SERVICE_EVENTS.MESSAGE, msg);

      expect(processSpy).toHaveBeenCalledWith(msg);
    });

    it('forwards ERROR and writes to state.error', () => {
      const setErrorSpy = jest.spyOn(service.state, 'setError');
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, listener);

      const err = new Error('ws boom');
      service.websocket.emit(SERVICE_EVENTS.ERROR, err);

      expect(setErrorSpy).toHaveBeenCalledWith(err);
      expect(listener).toHaveBeenCalledWith(err);
    });

    it('forwards LANGUAGE_CHANGED', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.LANGUAGE_CHANGED, listener);

      service.websocket.emit(SERVICE_EVENTS.LANGUAGE_CHANGED, 'pt-br');

      expect(listener).toHaveBeenCalledWith('pt-br');
    });

    it('forwards VOICE_ENABLED', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.VOICE_ENABLED, listener);

      service.websocket.emit(SERVICE_EVENTS.VOICE_ENABLED);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('forwards VOICE_TOKENS_RECEIVED with payload', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.VOICE_TOKENS_RECEIVED, listener);

      const payload = { data: { stt_token: 'a', tts_token: 'b' } };
      service.websocket.emit(SERVICE_EVENTS.VOICE_TOKENS_RECEIVED, payload);

      expect(listener).toHaveBeenCalledWith(payload);
    });

    it('forwards VOICE_TOKENS_ERROR with payload', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.VOICE_TOKENS_ERROR, listener);

      const payload = { error: 'voice broke' };
      service.websocket.emit(SERVICE_EVENTS.VOICE_TOKENS_ERROR, payload);

      expect(listener).toHaveBeenCalledWith(payload);
    });

    it('forwards CART_UPDATED with payload', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.CART_UPDATED, listener);

      const payload = { type: 'cart_updated', data: { item_id: 'x' } };
      service.websocket.emit(SERVICE_EVENTS.CART_UPDATED, payload);

      expect(listener).toHaveBeenCalledWith(payload);
    });
  });

  // ===========================================================================
  // B. MessageProcessor → service
  // ===========================================================================
  describe('MessageProcessor relays', () => {
    it('on MESSAGE_PROCESSED: addMessage + appendToConversation + emits MESSAGE_RECEIVED (renamed)', () => {
      service.session.createNewSession();
      const addSpy = jest.spyOn(service.state, 'addMessage');
      const appendSpy = jest.spyOn(service.session, 'appendToConversation');
      const receivedListener = jest.fn();
      const processedListener = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_RECEIVED, receivedListener);
      service.on(SERVICE_EVENTS.MESSAGE_PROCESSED, processedListener);

      const msg = { id: 'in_1', type: 'text', text: 'hi' };
      service.messageProcessor.emit(SERVICE_EVENTS.MESSAGE_PROCESSED, msg);

      expect(addSpy).toHaveBeenCalledWith(msg);
      expect(appendSpy).toHaveBeenCalledWith(msg);
      expect(receivedListener).toHaveBeenCalledWith(msg);
      // MESSAGE_PROCESSED is intentionally NOT re-emitted on the service.
      expect(processedListener).not.toHaveBeenCalled();
    });

    it('on MESSAGE_UPDATED: updateMessage + updateConversation + re-emits with same args', () => {
      service.session.createNewSession();
      const updateStateSpy = jest.spyOn(service.state, 'updateMessage');
      const updateSessionSpy = jest.spyOn(
        service.session,
        'updateConversation',
      );
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_UPDATED, listener);

      service.messageProcessor.emit(SERVICE_EVENTS.MESSAGE_UPDATED, 'msg-1', {
        status: 'sent',
      });

      expect(updateStateSpy).toHaveBeenCalledWith('msg-1', { status: 'sent' });
      expect(updateSessionSpy).toHaveBeenCalledWith('msg-1', {
        status: 'sent',
      });
      expect(listener).toHaveBeenCalledWith('msg-1', { status: 'sent' });
    });

    it('on TYPING_START / TYPING_STOP: toggles state.isTyping and re-emits', () => {
      const setTypingSpy = jest.spyOn(service.state, 'setTyping');
      const startListener = jest.fn();
      const stopListener = jest.fn();
      service.on(SERVICE_EVENTS.TYPING_START, startListener);
      service.on(SERVICE_EVENTS.TYPING_STOP, stopListener);

      service.messageProcessor.emit(SERVICE_EVENTS.TYPING_START);
      service.messageProcessor.emit(SERVICE_EVENTS.TYPING_STOP);

      expect(setTypingSpy).toHaveBeenNthCalledWith(1, true);
      expect(setTypingSpy).toHaveBeenNthCalledWith(2, false);
      expect(startListener).toHaveBeenCalledTimes(1);
      expect(stopListener).toHaveBeenCalledTimes(1);
    });

    it('on THINKING_START / THINKING_STOP: toggles state.isThinking and re-emits', () => {
      const setThinkingSpy = jest.spyOn(service.state, 'setThinking');
      const startListener = jest.fn();
      const stopListener = jest.fn();
      service.on(SERVICE_EVENTS.THINKING_START, startListener);
      service.on(SERVICE_EVENTS.THINKING_STOP, stopListener);

      service.messageProcessor.emit(SERVICE_EVENTS.THINKING_START);
      service.messageProcessor.emit(SERVICE_EVENTS.THINKING_STOP);

      expect(setThinkingSpy).toHaveBeenNthCalledWith(1, true);
      expect(setThinkingSpy).toHaveBeenNthCalledWith(2, false);
      expect(startListener).toHaveBeenCalledTimes(1);
      expect(stopListener).toHaveBeenCalledTimes(1);
    });

    it('on ERROR: re-emits on the service', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, listener);

      const err = new Error('processor boom');
      service.messageProcessor.emit(SERVICE_EVENTS.ERROR, err);

      expect(listener).toHaveBeenCalledWith(err);
    });

    it('on MESSAGE_UNKNOWN: re-emits raw message on the service', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_UNKNOWN, listener);

      const raw = { type: 'never_seen', payload: 1 };
      service.messageProcessor.emit(SERVICE_EVENTS.MESSAGE_UNKNOWN, raw);

      expect(listener).toHaveBeenCalledWith(raw);
    });
  });

  // ===========================================================================
  // C. Session → service
  // ===========================================================================
  describe('Session relays', () => {
    describe('CONTACT_TIMEOUT_MAXIMUM_TIME_REACHED', () => {
      it('reconnects first when websocket is disconnected, then clears + recreates session and disconnects', async () => {
        service.session.createNewSession();
        jest
          .spyOn(service.websocket, 'getStatus')
          .mockReturnValue('disconnected');
        const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue();
        const isAllowedSpy = jest
          .spyOn(service.websocket, 'isContactAllowedToBeClosed')
          .mockResolvedValue();
        const clearSpy = jest.spyOn(service, 'clearSession');
        const createSpy = jest.spyOn(service, 'createNewSession');
        const setRegSpy = jest.spyOn(service.websocket, 'setRegistrationData');
        const disconnectSpy = jest
          .spyOn(service, 'disconnect')
          .mockImplementation(() => {});

        service.session.emit(
          SERVICE_EVENTS.CONTACT_TIMEOUT_MAXIMUM_TIME_REACHED,
        );

        // Drain the await this.connect() and the subsequent .then().
        await flushMicrotasks();
        await flushMicrotasks();

        expect(connectSpy).toHaveBeenCalledTimes(1);
        expect(isAllowedSpy).toHaveBeenCalledTimes(1);
        expect(clearSpy).toHaveBeenCalledTimes(1);
        expect(createSpy).toHaveBeenCalledTimes(1);
        expect(setRegSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            from: service.getSessionId(),
            callback: service.config.callbackUrl,
            session_type: service.config.storage,
          }),
        );
        expect(disconnectSpy).toHaveBeenCalledWith(false);
      });

      it('does not reconnect when websocket is already connected', async () => {
        service.session.createNewSession();
        jest.spyOn(service.websocket, 'getStatus').mockReturnValue('connected');
        const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue();
        jest
          .spyOn(service.websocket, 'isContactAllowedToBeClosed')
          .mockResolvedValue();
        jest.spyOn(service, 'disconnect').mockImplementation(() => {});

        service.session.emit(
          SERVICE_EVENTS.CONTACT_TIMEOUT_MAXIMUM_TIME_REACHED,
        );

        await flushMicrotasks();
        await flushMicrotasks();

        expect(connectSpy).not.toHaveBeenCalled();
      });

      it('emits ERROR when isContactAllowedToBeClosed rejects', async () => {
        service.session.createNewSession();
        jest.spyOn(service.websocket, 'getStatus').mockReturnValue('connected');
        const boom = new Error('contact still active');
        jest
          .spyOn(service.websocket, 'isContactAllowedToBeClosed')
          .mockRejectedValue(boom);
        const errorListener = jest.fn();
        service.on(SERVICE_EVENTS.ERROR, errorListener);
        const clearSpy = jest.spyOn(service, 'clearSession');

        service.session.emit(
          SERVICE_EVENTS.CONTACT_TIMEOUT_MAXIMUM_TIME_REACHED,
        );

        await flushMicrotasks();
        await flushMicrotasks();

        expect(errorListener).toHaveBeenCalledWith(boom);
        expect(clearSpy).not.toHaveBeenCalled();
      });
    });

    it('forwards CHAT_OPEN_CHANGED', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.CHAT_OPEN_CHANGED, listener);

      service.session.emit(SERVICE_EVENTS.CHAT_OPEN_CHANGED, true);
      service.session.emit(SERVICE_EVENTS.CHAT_OPEN_CHANGED, false);

      expect(listener).toHaveBeenNthCalledWith(1, true);
      expect(listener).toHaveBeenNthCalledWith(2, false);
    });
  });

  // ===========================================================================
  // D. State → service
  // ===========================================================================
  describe('State relays', () => {
    it('forwards STATE_CHANGED with (newState, oldState)', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.STATE_CHANGED, listener);

      const newState = { foo: 1 };
      const oldState = { foo: 0 };
      service.state.emit(SERVICE_EVENTS.STATE_CHANGED, newState, oldState);

      expect(listener).toHaveBeenCalledWith(newState, oldState);
    });
  });

  // ===========================================================================
  // E. Camera / Audio recorders → service
  // ===========================================================================
  describe('CameraRecorder relays', () => {
    it('forwards CAMERA_STREAM_RECEIVED', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.CAMERA_STREAM_RECEIVED, listener);

      const stream = { fake: 'stream' };
      service.cameraRecorder.emit(
        SERVICE_EVENTS.CAMERA_STREAM_RECEIVED,
        stream,
      );

      expect(listener).toHaveBeenCalledWith(stream);
    });

    it('forwards CAMERA_RECORDING_STARTED', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.CAMERA_RECORDING_STARTED, listener);

      service.cameraRecorder.emit(SERVICE_EVENTS.CAMERA_RECORDING_STARTED);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('forwards CAMERA_RECORDING_STOPPED', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.CAMERA_RECORDING_STOPPED, listener);

      service.cameraRecorder.emit(SERVICE_EVENTS.CAMERA_RECORDING_STOPPED);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('forwards CAMERA_DEVICES_CHANGED with device list', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.CAMERA_DEVICES_CHANGED, listener);

      const devices = [{ deviceId: 'a' }, { deviceId: 'b' }];
      service.cameraRecorder.emit(
        SERVICE_EVENTS.CAMERA_DEVICES_CHANGED,
        devices,
      );

      expect(listener).toHaveBeenCalledWith(devices);
    });
  });

  describe('AudioRecorder relays', () => {
    it('forwards RECORDING_STARTED', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.RECORDING_STARTED, listener);

      service.audioRecorder.emit(SERVICE_EVENTS.RECORDING_STARTED);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('forwards RECORDING_STOPPED with result', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.RECORDING_STOPPED, listener);

      const result = { duration: 5, base64: 'x' };
      service.audioRecorder.emit(SERVICE_EVENTS.RECORDING_STOPPED, result);

      expect(listener).toHaveBeenCalledWith(result);
    });

    it('forwards RECORDING_TICK with duration', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.RECORDING_TICK, listener);

      service.audioRecorder.emit(SERVICE_EVENTS.RECORDING_TICK, 2.5);

      expect(listener).toHaveBeenCalledWith(2.5);
    });

    it('forwards ERROR', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, listener);

      const err = new Error('audio boom');
      service.audioRecorder.emit(SERVICE_EVENTS.ERROR, err);

      expect(listener).toHaveBeenCalledWith(err);
    });
  });

  // ===========================================================================
  // F. FileHandler / HistoryManager → service
  // ===========================================================================
  describe('FileHandler relays', () => {
    it('forwards FILE_PROCESSED', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.FILE_PROCESSED, listener);

      const file = { type: 'image', base64: 'x' };
      service.fileHandler.emit(SERVICE_EVENTS.FILE_PROCESSED, file);

      expect(listener).toHaveBeenCalledWith(file);
    });

    it('forwards ERROR', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, listener);

      const err = new Error('file boom');
      service.fileHandler.emit(SERVICE_EVENTS.ERROR, err);

      expect(listener).toHaveBeenCalledWith(err);
    });
  });

  describe('HistoryManager relays', () => {
    it('forwards HISTORY_LOADED with messages', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.HISTORY_LOADED, listener);

      const messages = [{ id: 'h1' }, { id: 'h2' }];
      service.history.emit(SERVICE_EVENTS.HISTORY_LOADED, messages);

      expect(listener).toHaveBeenCalledWith(messages);
    });

    it('forwards ERROR', () => {
      const listener = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, listener);

      const err = new Error('history boom');
      service.history.emit(SERVICE_EVENTS.ERROR, err);

      expect(listener).toHaveBeenCalledWith(err);
    });
  });

  // ===========================================================================
  // G. Internal MESSAGE_SENT self-listener
  // ===========================================================================
  describe('MESSAGE_SENT self-listener', () => {
    beforeEach(() => {
      service.session.createNewSession();
    });

    it('updates state and session status to "sent" when the message has an id', () => {
      const updateStateSpy = jest.spyOn(service.state, 'updateMessage');
      const updateSessionSpy = jest.spyOn(
        service.session,
        'updateConversation',
      );
      const lastSpy = jest.spyOn(service.session, 'setLastMessageSentAt');

      service.emit(SERVICE_EVENTS.MESSAGE_SENT, {
        id: 'msg_x',
        type: 'text',
      });

      expect(updateStateSpy).toHaveBeenCalledWith('msg_x', { status: 'sent' });
      expect(updateSessionSpy).toHaveBeenCalledWith('msg_x', {
        status: 'sent',
      });
      expect(lastSpy).toHaveBeenCalledTimes(1);
      expect(typeof lastSpy.mock.calls[0][0]).toBe('number');
    });

    it('skips state/session updates when the message has no id but still updates lastMessageSentAt', () => {
      const updateStateSpy = jest.spyOn(service.state, 'updateMessage');
      const updateSessionSpy = jest.spyOn(
        service.session,
        'updateConversation',
      );
      const lastSpy = jest.spyOn(service.session, 'setLastMessageSentAt');

      service.emit(SERVICE_EVENTS.MESSAGE_SENT, {
        type: 'set_custom_field',
        data: { key: 'k', value: 'v' },
      });

      expect(updateStateSpy).not.toHaveBeenCalled();
      expect(updateSessionSpy).not.toHaveBeenCalled();
      expect(lastSpy).toHaveBeenCalledTimes(1);
    });

    it('clears pending custom fields when __includesPendingCustomFields is true', () => {
      const clearSpy = jest.spyOn(service.session, 'clearPendingCustomFields');

      service.emit(SERVICE_EVENTS.MESSAGE_SENT, {
        id: 'msg_y',
        type: 'text',
        __includesPendingCustomFields: true,
      });

      expect(clearSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT clear pending custom fields when __includesPendingCustomFields is missing/false', () => {
      const clearSpy = jest.spyOn(service.session, 'clearPendingCustomFields');

      service.emit(SERVICE_EVENTS.MESSAGE_SENT, { id: 'msg_y', type: 'text' });
      service.emit(SERVICE_EVENTS.MESSAGE_SENT, {
        id: 'msg_z',
        type: 'text',
        __includesPendingCustomFields: false,
      });

      expect(clearSpy).not.toHaveBeenCalled();
    });

    it.each(['text', 'image', 'video', 'audio', 'file'])(
      'starts the typing indicator for type=%s',
      (type) => {
        const typingSpy = jest.spyOn(
          service.messageProcessor,
          'startTypingOnMessageSent',
        );

        service.emit(SERVICE_EVENTS.MESSAGE_SENT, { id: 'msg_t', type });

        expect(typingSpy).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['order', 'set_custom_field', 'unknown'])(
      'does NOT start the typing indicator for type=%s',
      (type) => {
        const typingSpy = jest.spyOn(
          service.messageProcessor,
          'startTypingOnMessageSent',
        );

        service.emit(SERVICE_EVENTS.MESSAGE_SENT, { id: 'msg_t', type });

        expect(typingSpy).not.toHaveBeenCalled();
      },
    );
  });

  // ===========================================================================
  // Smoke: makeOpenSocketMock keeps WebSocketManager.send happy in send-error
  // tests downstream — included here to exercise removeEventListener path of
  // the helper.
  // ===========================================================================
  describe('helper smoke', () => {
    it('makeOpenSocketMock supports add/remove/fire event listener wiring', () => {
      const sock = makeOpenSocketMock();
      const cb = jest.fn();
      sock.addEventListener('open', cb);
      sock.fire('open', 'arg');
      expect(cb).toHaveBeenCalledWith('arg');

      sock.removeEventListener('open', cb);
      sock.fire('open', 'arg2');
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
});
