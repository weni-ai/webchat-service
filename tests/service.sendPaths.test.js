import WeniWebchatService from '../src/index';
import { SERVICE_EVENTS } from '../src/utils/constants';
import {
  installBrowserMocks,
  makeOpenSocketMock,
  makeConfig,
  createConnectedService,
} from './_helpers/serviceMocks';

/**
 * Drains pending microtasks. Needed because runQueue() spawns each send via
 * forEach-async — the actual websocket.send call lives in a microtask the
 * caller doesn't await.
 */
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WeniWebchatService — outgoing send paths', () => {
  let service;
  let socket;

  beforeEach(() => {
    installBrowserMocks();
  });

  afterEach(() => {
    if (service) {
      service.destroy();
      service = null;
    }
    socket = null;
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------
  describe('sendMessage()', () => {
    it('rejects when text is empty / non-string', async () => {
      ({ service } = createConnectedService());

      await expect(service.sendMessage('')).rejects.toThrow(
        'Message text is required',
      );
      await expect(service.sendMessage(null)).rejects.toThrow();
      await expect(service.sendMessage(123)).rejects.toThrow();
    });

    it('adds the message to state + session, queues it, and flushes when connected', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      const addMessageSpy = jest.spyOn(service.state, 'addMessage');
      const appendSpy = jest.spyOn(service.session, 'appendToConversation');
      const sentListener = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_SENT, sentListener);

      await service.sendMessage('Hello!');
      await flushMicrotasks();

      expect(addMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'text',
          text: 'Hello!',
          direction: 'outgoing',
        }),
      );
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text', text: 'Hello!' }),
      );
      expect(socket.send).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(socket.send.mock.calls[0][0]);
      expect(payload.type).toBe('message');
      expect(payload.message).toEqual({ type: 'text', text: 'Hello!' });
      expect(payload.from).toBe(service.getSessionId());
      expect(sentListener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text', text: 'Hello!' }),
      );
      expect(service.messagesQueue).toEqual([]);
    });

    it('skips state.addMessage and session.appendToConversation when options.hidden=true', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      const addMessageSpy = jest.spyOn(service.state, 'addMessage');
      const appendSpy = jest.spyOn(service.session, 'appendToConversation');

      await service.sendMessage('hidden ping', { hidden: true });
      await flushMicrotasks();

      expect(addMessageSpy).not.toHaveBeenCalled();
      expect(appendSpy).not.toHaveBeenCalled();
      expect(socket.send).toHaveBeenCalledTimes(1);
    });

    it('attaches pending custom fields when the user has not sent any message yet', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      service.session.addPendingCustomField('utm', 'launch');
      service.session.addPendingCustomField('referrer', 'home');
      const sentListener = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_SENT, sentListener);

      await service.sendMessage('first message');
      await flushMicrotasks();

      const sentMessage = sentListener.mock.calls[0][0];
      expect(sentMessage.__customFields).toEqual({
        utm: 'launch',
        referrer: 'home',
      });
      expect(sentMessage.__includesPendingCustomFields).toBe(true);

      // The MESSAGE_SENT self-listener clears them.
      expect(service.session.getPendingCustomFields()).toEqual({});

      // The websocket payload uses the message_with_fields type.
      const payload = JSON.parse(socket.send.mock.calls[0][0]);
      expect(payload.type).toBe('message_with_fields');
      expect(payload.data).toEqual({ utm: 'launch', referrer: 'home' });
    });

    it('does NOT attach pending custom fields once the user has already sent a message', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      service.session.setLastMessageSentAt(Date.now());
      service.session.addPendingCustomField('lateField', 'value');

      await service.sendMessage('another one');
      await flushMicrotasks();

      const payload = JSON.parse(socket.send.mock.calls[0][0]);
      expect(payload.type).toBe('message');
      expect(payload.data).toBeUndefined();
    });

    it('queues the message and does not send while disconnected', async () => {
      service = new WeniWebchatService(makeConfig());

      await service.sendMessage('queued');

      expect(service.messagesQueue).toHaveLength(1);
      expect(service.messagesQueue[0]).toMatchObject({
        type: 'text',
        text: 'queued',
        direction: 'outgoing',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // sendAttachment
  // ---------------------------------------------------------------------------
  describe('sendAttachment()', () => {
    it('throws when no file is provided', async () => {
      ({ service } = createConnectedService());

      await expect(service.sendAttachment()).rejects.toThrow(
        'File is required',
      );
      await expect(service.sendAttachment(null)).rejects.toThrow(
        'File is required',
      );
    });

    it('processes the file, adds the message to state/session, and flushes', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();

      const processed = {
        type: 'image',
        base64: 'data:image/png;base64,xxx',
        filename: 'pic.png',
        size: 1024,
        mimeType: 'image/png',
      };
      jest.spyOn(service.fileHandler, 'process').mockResolvedValue(processed);
      const addMessageSpy = jest.spyOn(service.state, 'addMessage');
      const appendSpy = jest.spyOn(service.session, 'appendToConversation');

      await service.sendAttachment(new Blob(['x']));
      await flushMicrotasks();

      expect(addMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'image',
          media: processed.base64,
          direction: 'outgoing',
          metadata: {
            filename: 'pic.png',
            size: 1024,
            mimeType: 'image/png',
          },
        }),
      );
      expect(appendSpy).toHaveBeenCalled();
      expect(socket.send).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(socket.send.mock.calls[0][0]);
      expect(payload.message.type).toBe('image');
    });

    it('attaches pending custom fields on the very first send', async () => {
      ({ service } = createConnectedService());
      service.session.createNewSession();
      service.session.addPendingCustomField('utm', 'paid');
      jest.spyOn(service.fileHandler, 'process').mockResolvedValue({
        type: 'image',
        base64: 'b64',
        filename: 'a.png',
        size: 1,
        mimeType: 'image/png',
      });
      const sentListener = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_SENT, sentListener);

      await service.sendAttachment(new Blob(['x']));
      await flushMicrotasks();

      const sent = sentListener.mock.calls[0][0];
      expect(sent.__customFields).toEqual({ utm: 'paid' });
      expect(sent.__includesPendingCustomFields).toBe(true);
    });

    it('skips the pending-custom-fields block once the user has already sent a message (line 460 false branch)', async () => {
      // Covers the `if (!this.session.hasUserSentAnyMessage())` false
      // branch at line 460 of src/index.js.
      ({ service } = createConnectedService());
      service.session.createNewSession();
      service.session.setLastMessageSentAt(Date.now());
      // Even with pending fields queued, hasUserSentAnyMessage=true means
      // the block is skipped — they should NOT be attached.
      service.session.addPendingCustomField('utm', 'late');
      jest.spyOn(service.fileHandler, 'process').mockResolvedValue({
        type: 'image',
        base64: 'b64',
        filename: 'a.png',
        size: 1,
        mimeType: 'image/png',
      });
      const sentListener = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_SENT, sentListener);

      await service.sendAttachment(new Blob(['x']));
      await flushMicrotasks();

      const sent = sentListener.mock.calls[0][0];
      expect(sent.__customFields).toBeUndefined();
      expect(sent.__includesPendingCustomFields).toBeUndefined();
    });

    it('emits ERROR and rethrows when fileHandler.process rejects', async () => {
      ({ service } = createConnectedService());
      const boom = new Error('file too big');
      jest.spyOn(service.fileHandler, 'process').mockRejectedValue(boom);
      const errorListener = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, errorListener);

      await expect(service.sendAttachment(new Blob(['x']))).rejects.toBe(boom);

      expect(errorListener).toHaveBeenCalledWith(boom);
    });
  });

  // ---------------------------------------------------------------------------
  // sendAudio
  // ---------------------------------------------------------------------------
  describe('sendAudio()', () => {
    it('throws when audioData is missing or has no base64', async () => {
      ({ service } = createConnectedService());

      await expect(service.sendAudio()).rejects.toThrow(
        'Audio data is required',
      );
      await expect(service.sendAudio({})).rejects.toThrow(
        'Audio data is required',
      );
      await expect(service.sendAudio({ duration: 5 })).rejects.toThrow(
        'Audio data is required',
      );
    });

    it('builds an audio media message and flushes through the socket', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      const addMessageSpy = jest.spyOn(service.state, 'addMessage');

      await service.sendAudio({
        base64: 'data:audio/mpeg;base64,xxx',
        duration: 12,
        mimeType: 'audio/mpeg',
      });
      await flushMicrotasks();

      expect(addMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'audio',
          media: 'data:audio/mpeg;base64,xxx',
          direction: 'outgoing',
          metadata: { duration: 12, mimeType: 'audio/mpeg' },
        }),
      );
      const payload = JSON.parse(socket.send.mock.calls[0][0]);
      expect(payload.message.type).toBe('audio');
    });

    it('attaches pending custom fields on the first audio message', async () => {
      ({ service } = createConnectedService());
      service.session.createNewSession();
      service.session.addPendingCustomField('source', 'mic');
      const sentListener = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_SENT, sentListener);

      await service.sendAudio({
        base64: 'x',
        duration: 1,
        mimeType: 'audio/mpeg',
      });
      await flushMicrotasks();

      const sent = sentListener.mock.calls[0][0];
      expect(sent.__customFields).toEqual({ source: 'mic' });
      expect(sent.__includesPendingCustomFields).toBe(true);
    });

    it('skips the pending-custom-fields block once the user has already sent a message (line 499 false branch)', async () => {
      // Covers the `if (!this.session.hasUserSentAnyMessage())` false
      // branch at line 499 of src/index.js.
      ({ service } = createConnectedService());
      service.session.createNewSession();
      service.session.setLastMessageSentAt(Date.now());
      service.session.addPendingCustomField('source', 'late');
      const sentListener = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_SENT, sentListener);

      await service.sendAudio({
        base64: 'x',
        duration: 1,
        mimeType: 'audio/mpeg',
      });
      await flushMicrotasks();

      const sent = sentListener.mock.calls[0][0];
      expect(sent.__customFields).toBeUndefined();
      expect(sent.__includesPendingCustomFields).toBeUndefined();
    });

    it('emits ERROR and rethrows when downstream send setup throws', async () => {
      ({ service } = createConnectedService());
      const boom = new Error('builder boom');
      jest
        .spyOn(service.session, 'appendToConversation')
        .mockImplementation(() => {
          throw boom;
        });
      const errorListener = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, errorListener);

      await expect(
        service.sendAudio({ base64: 'x', duration: 1, mimeType: 'audio/mpeg' }),
      ).rejects.toBe(boom);

      expect(errorListener).toHaveBeenCalledWith(boom);
    });
  });

  // ---------------------------------------------------------------------------
  // runQueue
  // ---------------------------------------------------------------------------
  describe('runQueue()', () => {
    it('returns early when not connected AND _connecting is true', async () => {
      ({ service, socket } = createConnectedService());
      service._connected = false;
      service.websocket.status = 'connecting';
      service._connecting = true;
      service.messagesQueue.push({ id: 'msg_x', type: 'text', text: 'x' });

      await service.runQueue();

      expect(socket.send).not.toHaveBeenCalled();
      expect(service.messagesQueue).toHaveLength(1);
    });

    it('returns early when websocket is reconnecting', async () => {
      ({ service, socket } = createConnectedService());
      service._connected = false;
      service.websocket.status = 'reconnecting';
      service.messagesQueue.push({ id: 'msg_x', type: 'text', text: 'x' });

      await service.runQueue();

      expect(socket.send).not.toHaveBeenCalled();
      expect(service.messagesQueue).toHaveLength(1);
    });

    it('flushes every message in order and clears the queue when connected', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      service.messagesQueue.push(
        { id: 'msg_1', type: 'text', text: 'one' },
        { id: 'msg_2', type: 'text', text: 'two' },
      );
      const sentListener = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_SENT, sentListener);

      await service.runQueue();
      await flushMicrotasks();

      expect(socket.send).toHaveBeenCalledTimes(2);
      expect(service.messagesQueue).toEqual([]);
      expect(sentListener).toHaveBeenCalledTimes(2);
    });

    it('reconnects when disconnected with connectOn=demand and re-runs the queue', async () => {
      service = new WeniWebchatService(makeConfig({ connectOn: 'demand' }));
      service.session.createNewSession();
      service.messagesQueue.push({ id: 'msg_1', type: 'text', text: 'one' });

      const connectSpy = jest
        .spyOn(service, 'connect')
        .mockImplementation(async () => {
          // After connect, the second runQueue call sees connected.
          const sock = makeOpenSocketMock();
          service.websocket.socket = sock;
          service.websocket.status = 'connected';
          service._connected = true;
          socket = sock;
        });

      await service.runQueue();
      await flushMicrotasks();

      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(socket.send).toHaveBeenCalledTimes(1);
    });

    it('does NOT reconnect when mode=preview, even with connectOn=demand', async () => {
      service = new WeniWebchatService(
        makeConfig({ connectOn: 'demand', mode: 'preview' }),
      );
      service.messagesQueue.push({ id: 'msg_1', type: 'text', text: 'one' });
      const connectSpy = jest.spyOn(service, 'connect');

      await service.runQueue();

      expect(connectSpy).not.toHaveBeenCalled();
      expect(service.messagesQueue).toHaveLength(1);
    });

    it('does NOT auto-connect when disconnected with connectOn=manual', async () => {
      // Covers the branch alternative at line 309 of src/index.js where
      // the outer `else if (this.config.connectOn === 'demand')` is false
      // (here, connectOn is 'manual'), so runQueue is a no-op while
      // disconnected.
      service = new WeniWebchatService(makeConfig({ connectOn: 'manual' }));
      service.messagesQueue.push({ id: 'msg_1', type: 'text', text: 'one' });
      const connectSpy = jest.spyOn(service, 'connect');

      await service.runQueue();

      expect(connectSpy).not.toHaveBeenCalled();
      expect(service.messagesQueue).toHaveLength(1);
    });

    it('does NOT auto-connect when disconnected with default connectOn=mount', async () => {
      service = new WeniWebchatService(makeConfig({ connectOn: 'mount' }));
      service.messagesQueue.push({ id: 'msg_1', type: 'text', text: 'one' });
      const connectSpy = jest.spyOn(service, 'connect');

      await service.runQueue();

      expect(connectSpy).not.toHaveBeenCalled();
      expect(service.messagesQueue).toHaveLength(1);
    });

    it('marks the message as error and emits ERROR when websocket.send rejects', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      const boom = new Error('socket gone');
      socket.send = jest.fn(() => {
        throw boom;
      });
      const updateSpy = jest.spyOn(service.state, 'updateMessage');
      const errorListener = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, errorListener);

      // runQueue() uses `forEach(async ...)` and rethrows after recording
      // the failure. The rethrow surfaces as an unhandled rejection that
      // Jest would treat as a test failure. We monkey-patch
      // Array.prototype.forEach for the duration of this test to attach a
      // no-op `.catch` to any returned promise, restoring the original on
      // the way out.
      const originalForEach = Array.prototype.forEach;
      Array.prototype.forEach = function (cb, thisArg) {
        return originalForEach.call(this, function (item, idx, arr) {
          const r = cb.call(thisArg, item, idx, arr);
          if (r && typeof r.catch === 'function') r.catch(() => {});
        });
      };

      try {
        service.messagesQueue.push({ id: 'msg_1', type: 'text', text: 'one' });

        await service.runQueue();
        await flushMicrotasks();

        expect(updateSpy).toHaveBeenCalledWith('msg_1', { status: 'error' });
        expect(errorListener).toHaveBeenCalledWith(boom);
      } finally {
        Array.prototype.forEach = originalForEach;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // enqueueMessages
  // ---------------------------------------------------------------------------
  describe('enqueueMessages()', () => {
    it('appends every input message to messagesQueue', () => {
      service = new WeniWebchatService(makeConfig());
      service.messagesQueue = [{ id: 'm0' }];

      service.enqueueMessages([{ id: 'm1' }, { id: 'm2' }]);

      expect(service.messagesQueue).toEqual([
        { id: 'm0' },
        { id: 'm1' },
        { id: 'm2' },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // setCustomField
  // ---------------------------------------------------------------------------
  describe('setCustomField()', () => {
    it('stores the value as a pending custom field when the user has not sent any message yet', () => {
      service = new WeniWebchatService(makeConfig());
      service.session.createNewSession();
      const addPendingSpy = jest.spyOn(
        service.session,
        'addPendingCustomField',
      );

      service.setCustomField('country', 'BR');

      expect(addPendingSpy).toHaveBeenCalledWith('country', 'BR');
      expect(service.messagesQueue).toEqual([]);
    });

    it('enqueues a set_custom_field message and flushes when already initialized + sent', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      service.session.setLastMessageSentAt(Date.now());
      service._initialized = true;

      service.setCustomField('lang', 'en');
      await flushMicrotasks();

      // After flush the queue should be empty and the websocket should have
      // received the set_custom_field payload directly.
      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'set_custom_field',
          data: { key: 'lang', value: 'en' },
        }),
      );
      expect(service.messagesQueue).toEqual([]);
    });

    it('only enqueues without flushing when not yet initialized', () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      service.session.setLastMessageSentAt(Date.now());
      service._initialized = false;

      service.setCustomField('lang', 'en');

      expect(socket.send).not.toHaveBeenCalled();
      expect(service.messagesQueue).toHaveLength(1);
      expect(service.messagesQueue[0]).toEqual({
        type: 'set_custom_field',
        data: { key: 'lang', value: 'en' },
        status: 'pending',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // sendOrder — auto-flush when initialized
  // ---------------------------------------------------------------------------
  describe('sendOrder() auto-flush', () => {
    it('flushes through the websocket when _initialized=true', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      service._initialized = true;

      await service.sendOrder([{ product_retailer_id: 'p1', quantity: 1 }]);
      await flushMicrotasks();

      expect(socket.send).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(socket.send.mock.calls[0][0]);
      expect(payload.message.type).toBe('order');
      expect(payload.message.order.product_items).toEqual([
        { product_retailer_id: 'p1', quantity: 1 },
      ]);
    });

    it('only enqueues without flushing when _initialized=false', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      service._initialized = false;

      await service.sendOrder([{ product_retailer_id: 'p1', quantity: 1 }]);
      await flushMicrotasks();

      expect(socket.send).not.toHaveBeenCalled();
      expect(service.messagesQueue).toHaveLength(1);
    });
  });
});
