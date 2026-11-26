import { SERVICE_EVENTS } from '../src/utils/constants';
import {
  installBrowserMocks,
  createConnectedService,
} from './_helpers/serviceMocks';

const AGENT = {
  type: 'human_agent',
  name: 'Julia',
  id: 'ha_5f0c3a9e1b7d4c2a8e6f0b1d3c5a7e9f',
};
const START_ID = '6f1d2c3b-4a59-5e6f-8a7b-9c0d1e2f3a4b';
const END_ID = 'a2b3c4d5-e6f7-5a8b-9c0d-1e2f3a4b5c6d';

function wait(ms = 10) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function receive(service, frame) {
  service.websocket._handleMessage({ data: JSON.stringify(frame) });
}

function sentFrames(socket) {
  return socket.send.mock.calls.map(([raw]) => JSON.parse(raw));
}

function sentOfType(socket, type) {
  return sentFrames(socket).filter((frame) => frame.type === type);
}

function milestoneFrame(eventId, event, orderKey, occurredAt) {
  return {
    type: 'human_support_event',
    order_key: orderKey,
    human_support_event: {
      event_id: eventId,
      event,
      occurred_at: occurredAt,
    },
  };
}

function milestoneHistoryItem(eventId, event, orderKey) {
  return {
    ID: `mongo_${eventId}`,
    direction: 'in',
    timestamp: Math.floor(orderKey / 1000),
    order_key: orderKey,
    message: {
      type: 'human_support_event',
      human_support_event: {
        event_id: eventId,
        event,
        occurred_at: '2026-11-03T17:34:05.120Z',
      },
    },
  };
}

/**
 * Connects a service: answers ready_for_message, the history page and the
 * human support state request.
 */
async function connect(
  service,
  { enabled = true, history = [], active = undefined } = {},
) {
  receive(service, {
    type: 'ready_for_message',
    data: {
      history,
      ...(enabled && { human_support_enabled: true }),
    },
  });
  receive(service, { type: 'history', history });
  if (enabled) {
    receive(service, {
      type: 'human_support_state',
      ...(active !== undefined && { active }),
    });
  }
  await wait();
}

function findMessage(service, predicate) {
  return service.getMessages().find(predicate);
}

describe('WeniWebchatService — human support status', () => {
  let service;
  let socket;
  let warn;

  beforeEach(() => {
    installBrowserMocks();
    global.URL.createObjectURL = jest.fn(() => 'blob:preview');
    global.URL.revokeObjectURL = jest.fn();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    ({ service, socket } = createConnectedService({ messageDelay: 1 }));
    service.session.createNewSession();
    service.state.setSession(service.session.getSession());
  });

  afterEach(() => {
    service.destroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('connection', () => {
    it('enables the feature and confirms the state with the socket', async () => {
      const changed = jest.fn();
      service.on(SERVICE_EVENTS.HUMAN_SUPPORT_CHANGED, changed);

      await connect(service, { active: true });

      expect(service.getState().features).toEqual({ humanSupportStatus: true });
      expect(sentOfType(socket, 'get_human_support_state')).toHaveLength(1);
      expect(service.getState().humanSupport).toEqual({ active: true });
      expect(changed).toHaveBeenCalledWith({ active: true });
    });

    it('shows the state deduced from history before the socket confirms it', () => {
      receive(service, {
        type: 'ready_for_message',
        data: {
          human_support_enabled: true,
          history: [milestoneHistoryItem(START_ID, 'started', 1793727247312)],
        },
      });

      expect(service.getState().humanSupport).toEqual({ active: true });
    });

    it('keeps the deduced state without an error when the state is unconfirmed', async () => {
      const errors = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, errors);

      await connect(service, {
        history: [milestoneHistoryItem(START_ID, 'started', 1793727247312)],
      });

      expect(service.getState().humanSupport).toEqual({ active: true });
      expect(errors).not.toHaveBeenCalled();
    });

    it('behaves as before when the socket does not enable the feature', async () => {
      await connect(service, { enabled: false });
      await service.sendMessage('Oi');
      await wait();

      const [message] = service.getMessages();
      expect(service.getState().features).toEqual({
        humanSupportStatus: false,
      });
      expect(sentOfType(socket, 'get_human_support_state')).toHaveLength(0);
      expect(message.status).toBe('sent');
      expect(message).not.toHaveProperty('author');
      expect(message).not.toHaveProperty('__awaitingSave');

      receive(service, { type: 'typing_start', from: 'human_agent' });
      expect(service.getState().isTyping).toBe(true);
      expect(service.getState().typingAuthor).toBeNull();
    });
  });

  describe('full human support lifecycle', () => {
    it('orders, tracks status and typing from transfer to close', async () => {
      const received = jest.fn();
      const updated = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_RECEIVED, received);
      service.on(SERVICE_EVENTS.MESSAGE_UPDATED, updated);
      await connect(service, { active: false });

      receive(service, {
        type: 'message',
        order_key: 1793727240100,
        message: {
          type: 'text',
          timestamp: '1793727240',
          text: 'Vou te encaminhar agora',
          author: { type: 'ai_agent' },
        },
      });
      receive(
        service,
        milestoneFrame(
          START_ID,
          'started',
          1793727247312,
          '2026-11-03T17:34:05.120Z',
        ),
      );
      receive(
        service,
        milestoneFrame(
          START_ID,
          'started',
          1793727247312,
          '2026-11-03T17:34:05.120Z',
        ),
      );
      await wait(30);

      const types = service.getMessages().map((message) => message.type);
      expect(types).toEqual(['text', 'human_support_event']);
      expect(service.getMessages()[0].timestamp).toBe(1793727240000);
      expect(service.getState().humanSupport).toEqual({ active: true });
      expect(
        received.mock.calls.filter(
          ([message]) => message.type === 'human_support_event',
        ),
      ).toHaveLength(1);
      expect(service.getMessages()[1]).toEqual(
        expect.objectContaining({
          id: `hs_${START_ID}`,
          timestamp: Date.parse('2026-11-03T17:34:05.120Z'),
          humanSupportEvent: {
            eventId: START_ID,
            event: 'started',
            occurredAt: Date.parse('2026-11-03T17:34:05.120Z'),
          },
        }),
      );

      // Shopper message during human support: pending until message_saved
      await service.sendMessage('Quero trocar o tamanho');
      await wait();
      const shopper = findMessage(
        service,
        (message) => message.direction === 'outgoing',
      );
      const [wireMessage] = sentOfType(socket, 'message');
      expect(wireMessage.message.id).toBe(shopper.id);
      expect(shopper).toEqual(
        expect.objectContaining({
          status: 'pending',
          author: { type: 'contact' },
          __awaitingSave: true,
        }),
      );

      receive(service, {
        type: 'message_saved',
        id: shopper.id,
        order_key: 1793727380207,
        status: 'sent',
      });
      expect(findMessage(service, (m) => m.id === shopper.id)).toEqual(
        expect.objectContaining({ status: 'sent', orderKey: 1793727380207 }),
      );
      expect(
        findMessage(service, (m) => m.id === shopper.id),
      ).not.toHaveProperty('__awaitingSave');
      expect(updated).toHaveBeenCalledWith(shopper.id, {
        orderKey: 1793727380207,
        status: 'sent',
      });

      receive(service, {
        type: 'message_status',
        message_status: { ids: [shopper.id], status: 'read' },
      });
      receive(service, {
        type: 'message_status',
        message_status: { ids: [shopper.id], status: 'delivered' },
      });
      expect(findMessage(service, (m) => m.id === shopper.id).status).toBe(
        'read',
      );

      // Agent typing and reply
      receive(service, {
        type: 'typing_start',
        from: 'human_agent',
        author: AGENT,
      });
      expect(service.getState().typingAuthor).toEqual({
        type: 'human_agent',
        name: 'Julia',
      });
      expect(service.getState().isTyping).toBe(true);

      receive(service, {
        type: 'message',
        order_key: 1793727390000,
        message: {
          type: 'text',
          timestamp: '1793727390',
          text: 'Oi! Sou a Julia',
          author: { ...AGENT, email: 'julia@example.com' },
        },
      });
      await wait(30);
      expect(service.getState().typingAuthor).toBeNull();
      expect(service.getState().isTyping).toBe(false);
      expect(service.getMessages().at(-1).author).toEqual(AGENT);

      // End of human support
      receive(
        service,
        milestoneFrame(
          END_ID,
          'ended',
          1793727708044,
          '2026-11-03T17:41:47.903Z',
        ),
      );
      await wait(30);
      expect(service.getState().humanSupport).toEqual({ active: false });

      // AI mode: no status after local send nor after message_saved
      await service.sendMessage('Obrigado');
      await wait();
      const aiModeMessage = service
        .getMessages()
        .find((message) => message.text === 'Obrigado');
      expect(aiModeMessage).not.toHaveProperty('status');
      expect(aiModeMessage.__awaitingSave).toBe(true);

      receive(service, {
        type: 'message_saved',
        id: aiModeMessage.id,
        order_key: 1793727800000,
      });
      const saved = findMessage(service, (m) => m.id === aiModeMessage.id);
      expect(saved).not.toHaveProperty('status');
      expect(saved.orderKey).toBe(1793727800000);

      expect(service.getMessages().map((message) => message.orderKey)).toEqual([
        1793727240100, 1793727247312, 1793727380207, 1793727390000,
        1793727708044, 1793727800000,
      ]);
      expect(
        service.session.getConversation().map((message) => message.id),
      ).toEqual(service.getMessages().map((message) => message.id));
    });

    it('gives each human support period its own ordered milestones', async () => {
      await connect(service, { active: false });
      const periods = [
        ['11111111-1111-5111-8111-111111111111', 'started', 100],
        ['22222222-2222-5222-8222-222222222222', 'ended', 200],
        ['33333333-3333-5333-8333-333333333333', 'started', 300],
        ['44444444-4444-5444-8444-444444444444', 'ended', 400],
      ];

      periods.forEach(([eventId, event, orderKey]) => {
        receive(
          service,
          milestoneFrame(eventId, event, orderKey, '2026-11-03T17:34:05.120Z'),
        );
      });
      await wait(30);

      expect(
        service.getMessages().map((message) => message.humanSupportEvent.event),
      ).toEqual(['started', 'ended', 'started', 'ended']);
      expect(service.getState().humanSupport).toEqual({ active: false });
    });

    it('applies a 200-id read batch with one storage write', async () => {
      await connect(service, { active: true });
      const ids = Array.from({ length: 200 }, (_, index) => `msg_${index}`);
      service.state.setState({
        messages: ids.map((id, index) => ({
          id,
          type: 'text',
          direction: 'outgoing',
          status: 'delivered',
          orderKey: index,
        })),
      });
      service.session.setConversation(service.getMessages());
      const save = jest.spyOn(service.session, '_save');
      const updated = jest.fn();
      service.on(SERVICE_EVENTS.MESSAGE_UPDATED, updated);

      receive(service, {
        type: 'message_status',
        message_status: { ids, status: 'read' },
      });

      expect(save).toHaveBeenCalledTimes(1);
      expect(updated).toHaveBeenCalledTimes(200);
      expect(
        service.getMessages().every((message) => message.status === 'read'),
      ).toBe(true);
    });

    it('does not show optimistic typing after a send during human support', async () => {
      jest.spyOn(service.messageProcessor, 'startTypingOnMessageSent');
      await connect(service, { active: true });

      await service.sendMessage('Alguém aí?');
      await wait();

      expect(
        service.messageProcessor.startTypingOnMessageSent,
      ).not.toHaveBeenCalled();
    });

    it('keeps a delivered message delivered when no read frame arrives', async () => {
      await connect(service, { active: true });
      await service.sendMessage('Pedido 9482');
      await wait();
      const [message] = service.getMessages();

      receive(service, {
        type: 'message_saved',
        id: message.id,
        order_key: 10,
        status: 'sent',
      });
      receive(service, {
        type: 'message_status',
        message_status: { ids: [message.id], status: 'delivered' },
      });
      receive(service, {
        type: 'history',
        history: [
          {
            ID: 'mongo_1',
            direction: 'out',
            timestamp: 0,
            order_key: 10,
            message: {
              id: message.id,
              type: 'text',
              text: 'Pedido 9482',
              author: { type: 'contact' },
              status: 'sent',
            },
          },
        ],
      });

      expect(service.getMessages()[0].status).toBe('delivered');
    });
  });

  describe('history and reconnection', () => {
    it('merges server fields and statuses into the local copy', async () => {
      await connect(service, { active: true });
      await service.sendMessage('Oi');
      await wait();
      const [local] = service.getMessages();
      receive(service, {
        type: 'message_saved',
        id: local.id,
        order_key: 2000,
        status: 'sent',
      });

      const request = service.getHistory({ page: 1, limit: 20 });
      receive(service, {
        type: 'history',
        history: [
          {
            ID: 'mongo_out',
            direction: 'out',
            timestamp: 2,
            order_key: 2000,
            message: {
              id: local.id,
              type: 'text',
              text: 'Oi',
              author: { type: 'contact' },
              status: 'read',
            },
          },
          milestoneHistoryItem(START_ID, 'started', 1000),
          {
            ID: 'mongo_legacy',
            direction: 'in',
            timestamp: 0.5,
            message: { type: 'text', text: 'antes do lançamento' },
          },
        ],
      });
      await request;

      const messages = service.getMessages();
      expect(messages.map((message) => message.id)).toEqual([
        'mongo_legacy',
        `hs_${START_ID}`,
        local.id,
      ]);
      expect(messages[2].status).toBe('read');
      expect(messages[0]).not.toHaveProperty('author');
    });

    it('keeps history-matched shopper messages and fails unconfirmed ones on reconnect', async () => {
      await connect(service, { active: true });
      await service.sendMessage('Salvo');
      await service.sendMessage('Perdido');
      await wait();
      const [savedMessage, lostMessage] = service.getMessages();
      service.state.updateMessage(savedMessage.id, { status: 'sent' });
      service.session.updateConversation(savedMessage.id, { status: 'sent' });

      service._handleWebSocketConnected();
      receive(service, {
        type: 'history',
        history: [
          {
            ID: 'mongo_saved',
            direction: 'out',
            timestamp: 1,
            order_key: 1000,
            message: {
              id: savedMessage.id,
              type: 'text',
              text: 'Salvo',
              author: { type: 'contact' },
              status: 'delivered',
            },
          },
        ],
      });
      await wait();

      const messages = service.getMessages();
      expect(messages.find((m) => m.id === savedMessage.id).status).toBe(
        'delivered',
      );
      expect(messages.find((m) => m.id === lostMessage.id).status).toBe(
        'error',
      );
      expect(warn).toHaveBeenCalledWith(
        'HumanSupportTracker: message not confirmed after reconnect',
        expect.objectContaining({ messageId: lostMessage.id }),
      );
    });

    it('does not resend a message that already reached the socket after a reload', async () => {
      service.destroy();
      ({ service, socket } = createConnectedService({ mode: 'preview' }));
      jest.spyOn(service.session, 'restore').mockResolvedValue({
        id: 'session',
        conversation: [
          {
            id: 'msg_awaiting',
            type: 'text',
            direction: 'outgoing',
            status: 'pending',
            __awaitingSave: true,
          },
          {
            id: 'msg_offline',
            type: 'text',
            direction: 'outgoing',
            status: 'pending',
          },
        ],
      });

      await service.init();

      expect(service.messagesQueue.map((message) => message.id)).toEqual([
        'msg_offline',
      ]);
    });

    it('keeps the tag and the feature gate across a disconnect, but hides typing', async () => {
      await connect(service, { active: true });
      receive(service, {
        type: 'typing_start',
        from: 'human_agent',
        author: AGENT,
      });

      service.websocket._handleDisconnect({});

      expect(service.getState().humanSupport).toEqual({ active: true });
      expect(service.getState().features).toEqual({ humanSupportStatus: true });
      expect(service.getState().typingAuthor).toBeNull();
    });
  });

  describe('contract errors', () => {
    it('discards invalid frames without emitting errors or messages', async () => {
      const errors = jest.fn();
      const received = jest.fn();
      service.on(SERVICE_EVENTS.ERROR, errors);
      service.on(SERVICE_EVENTS.MESSAGE_RECEIVED, received);
      await connect(service, { active: false });

      receive(
        service,
        milestoneFrame('not-a-uuid', 'started', 1, '2026-11-03T17:34:05Z'),
      );
      receive(service, { type: 'message_saved', id: 'msg_x' });
      receive(service, {
        type: 'message_status',
        message_status: { ids: ['msg_x'], status: 'seen' },
      });
      await wait();

      expect(errors).not.toHaveBeenCalled();
      expect(received).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(3);
      warn.mock.calls.forEach(([, context]) => {
        expect(JSON.stringify(context)).not.toMatch(/Julia|Oi|text/);
      });
    });

    it('omits an invalid caller-provided id from the wire', async () => {
      await connect(service, { active: false });

      await service.sendMessage('Oi', { id: 'has spaces' });
      await wait();

      const [frame] = sentOfType(socket, 'message');
      expect(frame.message).not.toHaveProperty('id');
      expect(service.getMessages()[0]).not.toHaveProperty('status');
      expect(service.getMessages()[0]).not.toHaveProperty('__awaitingSave');
    });
  });

  it('replays human support frames through simulateMessageReceived', async () => {
    await connect(service, { active: false });

    service.simulateMessageReceived(
      milestoneFrame(START_ID, 'started', 1, '2026-11-03T17:34:05.120Z'),
    );
    await wait();

    expect(service.getMessages()[0].type).toBe('human_support_event');
    expect(service.getState().humanSupport).toEqual({ active: true });
  });
});
