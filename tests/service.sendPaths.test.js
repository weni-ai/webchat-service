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
    global.URL.createObjectURL = jest.fn(() => 'blob:preview');
    global.URL.revokeObjectURL = jest.fn();
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

    it('serializes from_conversation_starter when fromConversationStarter is true', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();

      await service.sendMessage('Q?', { fromConversationStarter: true });
      await flushMicrotasks();

      expect(socket.send).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(socket.send.mock.calls[0][0]);
      expect(payload.type).toBe('message');
      expect(payload.message).toEqual({
        type: 'text',
        text: 'Q?',
        from_conversation_starter: true,
      });
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
          media: 'blob:preview',
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
          media: 'blob:preview',
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

  describe('media preview and upload ack', () => {
    function lastStoredConversation() {
      const calls = service.session.storage.set.mock.calls;
      return calls[calls.length - 1][1].conversation;
    }

    it.each(['image', 'video', 'file'])(
      'previews %s as a blob URL and uploads the data URL',
      async (type) => {
        ({ service, socket } = createConnectedService());
        jest.spyOn(service.session.storage, 'set');
        service.session.createNewSession();
        jest.spyOn(service.fileHandler, 'process').mockResolvedValue({
          type,
          base64: `data:${type}/x;base64,AAA`,
          filename: 'a.bin',
          size: 3,
          mimeType: 'application/octet-stream',
        });

        await service.sendAttachment(new Blob(['x']));
        await flushMicrotasks();

        const storedMessage = service.state.getMessages().at(-1);
        expect(storedMessage.media).toBe('blob:preview');
        expect(JSON.stringify(storedMessage)).not.toContain('data:');
        const payload = JSON.parse(socket.send.mock.calls[0][0]);
        expect(payload.message.media).toBe(`data:${type}/x;base64,AAA`);
        expect(
          lastStoredConversation().some(
            (item) =>
              typeof item.media === 'string' &&
              (item.media.startsWith('data:') ||
                item.media.startsWith('blob:')),
          ),
        ).toBe(false);
      },
    );

    it('previews audio from a blob and uploads the data URL', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      const recording = new Blob(['audio'], { type: 'audio/mpeg' });

      await service.sendAudio({
        base64: 'data:audio/mpeg;base64,AAA',
        blob: recording,
        duration: 2,
        mimeType: 'audio/mpeg',
      });
      await flushMicrotasks();

      expect(service.state.getMessages().at(-1).media).toBe('blob:preview');
      expect(URL.createObjectURL).toHaveBeenCalledWith(recording);
      const payload = JSON.parse(socket.send.mock.calls[0][0]);
      expect(payload.message.media).toBe('data:audio/mpeg;base64,AAA');
    });

    it('replaces the blob with the official link and stores it once', async () => {
      ({ service } = createConnectedService());
      jest.spyOn(service.session.storage, 'set');
      service.session.createNewSession();
      jest.spyOn(service.fileHandler, 'process').mockResolvedValue({
        type: 'video',
        base64: 'data:video/mp4;base64,AAA',
        filename: 'clip.mp4',
        size: 3,
        mimeType: 'video/mp4',
      });

      await service.sendAttachment(new Blob(['x']));
      await flushMicrotasks();

      service.messageProcessor.process({
        type: 'ack',
        to: 'user',
        from: 'socket',
        message: {
          type: 'video',
          timestamp: '1793296215',
          media_url: 'https://cdn.example/real',
          list_message: { button_text: '', list_items: null },
        },
      });

      const videos = service.state
        .getMessages()
        .filter((item) => item.type === 'video');
      expect(videos).toHaveLength(1);
      expect(videos[0].media).toBe('https://cdn.example/real');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
      expect(
        lastStoredConversation().filter((item) => item.type === 'video'),
      ).toEqual([
        expect.objectContaining({ media: 'https://cdn.example/real' }),
      ]);

      service.messageProcessor.process({
        type: 'ack',
        message: { type: 'video', media_url: 'https://cdn.example/again' },
      });
      expect(
        service.state.getMessages().filter((item) => item.type === 'video'),
      ).toHaveLength(1);
      expect(videos[0].media).toBe('https://cdn.example/real');
    });

    it('matches a document ack to a local file message', async () => {
      ({ service } = createConnectedService());
      service.session.createNewSession();
      jest.spyOn(service.fileHandler, 'process').mockResolvedValue({
        type: 'file',
        base64: 'data:application/pdf;base64,AAA',
        filename: 'a.pdf',
        size: 3,
        mimeType: 'application/pdf',
      });
      await service.sendAttachment(new Blob(['x']));
      await flushMicrotasks();

      service.messageProcessor.process({
        type: 'ack',
        message: {
          type: 'document',
          media_url: 'https://cdn.example/file.pdf',
        },
      });

      expect(service.state.getMessages().at(-1).media).toBe(
        'https://cdn.example/file.pdf',
      );
    });

    it('ignores a non-http ack and an unmatched ack', async () => {
      ({ service } = createConnectedService());
      service.session.createNewSession();
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(service.fileHandler, 'process').mockResolvedValue({
        type: 'image',
        base64: 'data:image/png;base64,AAA',
        filename: 'a.png',
        size: 1,
        mimeType: 'image/png',
      });
      await service.sendAttachment(new Blob(['x']));
      await flushMicrotasks();

      service.messageProcessor.process({
        type: 'ack',
        message: { type: 'image', media_url: 'javascript:alert(1)' },
      });
      expect(service.state.getMessages().at(-1).media).toBe('blob:preview');

      service.messageProcessor.process({
        type: 'ack',
        message: { type: 'audio', media_url: 'https://cdn.example/nope' },
      });
      expect(warn).toHaveBeenCalledWith(
        'WeniWebchatService: media ack unmatched',
        expect.objectContaining({
          operation: 'media-ack',
          messageType: 'audio',
          reason: 'no-pending-media',
        }),
      );
      warn.mockRestore();
    });

    it('revokes the blob when the socket send fails', async () => {
      ({ service, socket } = createConnectedService());
      service.session.createNewSession();
      socket.send.mockImplementationOnce(() => {
        throw new Error('offline');
      });
      jest.spyOn(service.fileHandler, 'process').mockResolvedValue({
        type: 'image',
        base64: 'data:image/png;base64,AAA',
        filename: 'a.png',
        size: 1,
        mimeType: 'image/png',
      });

      const originalForEach = Array.prototype.forEach;
      Array.prototype.forEach = function (callback, thisArg) {
        return originalForEach.call(this, function (item, index, array) {
          const result = callback.call(thisArg, item, index, array);
          if (result && typeof result.catch === 'function') {
            result.catch(() => {});
          }
        });
      };

      try {
        await service.sendAttachment(new Blob(['x']));
        await flushMicrotasks();
      } finally {
        Array.prototype.forEach = originalForEach;
      }

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
      expect(service.state.getMessages().at(-1).status).toBe('error');
    });
  });
});
