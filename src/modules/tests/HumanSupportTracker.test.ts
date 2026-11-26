import {
  HUMAN_SUPPORT_TRACKER_EVENTS,
  HumanSupportTracker,
} from '../HumanSupportTracker';
import type {
  HumanSupportStatePort,
  MessageUpdate,
  TrackedMessage,
} from '../humanSupportTypes';

const AGENT_ID = 'ha_5f0c3a9e1b7d4c2a8e6f0b1d3c5a7e9f';
const OTHER_AGENT_ID = 'ha_0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const START_ID = '6f1d2c3b-4a59-5e6f-8a7b-9c0d1e2f3a4b';
const END_ID = 'a2b3c4d5-e6f7-5a8b-9c0d-1e2f3a4b5c6d';

type StateValues = Record<string, unknown> & { messages: TrackedMessage[] };

function createState(messages: TrackedMessage[] = []) {
  const values: StateValues = {
    messages,
    connection: { status: 'connected' },
    features: { humanSupportStatus: false },
    humanSupport: { active: false },
    typingAuthor: null,
    isTyping: false,
  };

  const port: HumanSupportStatePort = {
    get: (key) => values[key],
    getMessage: (id) => values.messages.find((message) => message.id === id),
    getMessages: () => [...values.messages],
    setFeatures: (features) => {
      values.features = features;
    },
    setHumanSupport: (humanSupport) => {
      values.humanSupport = humanSupport;
    },
    setTypingAuthor: (typingAuthor) => {
      values.typingAuthor = typingAuthor;
    },
    setTyping: (isTyping) => {
      values.isTyping = isTyping;
    },
  };

  return { values, port };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function milestoneItem(eventId: string, event: string, orderKey: number) {
  return {
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

function milestone(
  eventId: string,
  event: 'started' | 'ended',
  orderKey: number,
): TrackedMessage {
  return {
    id: `hs_${eventId}`,
    type: 'human_support_event',
    direction: 'incoming',
    orderKey,
    humanSupportEvent: { eventId, event, occurredAt: orderKey },
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(messages: TrackedMessage[] = []) {
  const { values, port } = createState(messages);
  const request = deferred<{ active?: boolean }>();
  const transport = {
    requestHumanSupportState: jest.fn(() => request.promise),
  };
  const tracker = new HumanSupportTracker({
    state: port,
    transport,
    typingTimeoutMs: 10000,
    stateTimeoutMs: 10000,
  });
  const changed = jest.fn();
  const updated = jest.fn<void, [MessageUpdate[]]>();
  const typingStart = jest.fn();
  const typingStop = jest.fn();
  tracker.on(HUMAN_SUPPORT_TRACKER_EVENTS.HUMAN_SUPPORT_CHANGED, changed);
  tracker.on(HUMAN_SUPPORT_TRACKER_EVENTS.MESSAGES_UPDATED, updated);
  tracker.on(HUMAN_SUPPORT_TRACKER_EVENTS.TYPING_START, typingStart);
  tracker.on(HUMAN_SUPPORT_TRACKER_EVENTS.TYPING_STOP, typingStop);

  return {
    values,
    tracker,
    transport,
    request,
    changed,
    updated,
    typingStart,
    typingStop,
  };
}

describe('HumanSupportTracker', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('handleReady', () => {
    it('keeps the feature off and never asks Flows without human_support_enabled', () => {
      const { values, tracker, transport, changed } = setup();

      tracker.handleReady({ history: [milestoneItem(START_ID, 'started', 1)] });

      expect(values.features).toEqual({ humanSupportStatus: false });
      expect(values.humanSupport).toEqual({ active: false });
      expect(transport.requestHumanSupportState).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
    });

    it('deduces the state from the last milestone before Flows answers', () => {
      const { values, tracker, transport, changed } = setup();

      tracker.handleReady({
        human_support_enabled: true,
        history: [milestoneItem(START_ID, 'started', 1793727247312)],
      });

      expect(values.features).toEqual({ humanSupportStatus: true });
      expect(values.humanSupport).toEqual({ active: true });
      expect(changed).toHaveBeenCalledWith({ active: true });
      expect(transport.requestHumanSupportState).toHaveBeenCalledWith(10000);
    });

    it('applies the Flows confirmation, covering tickets without a start milestone', async () => {
      const { values, tracker, request } = setup();

      tracker.handleReady({ human_support_enabled: true, history: [] });
      request.resolve({ active: true });
      await flush();

      expect(values.humanSupport).toEqual({ active: true });
    });

    it('corrects a stale deduction when Flows says support is over', async () => {
      const { values, tracker, request } = setup();

      tracker.handleReady({
        human_support_enabled: true,
        history: [milestoneItem(START_ID, 'started', 1)],
      });
      request.resolve({ active: false });
      await flush();

      expect(values.humanSupport).toEqual({ active: false });
    });

    it('keeps the deduced state and warns once when Flows gives no answer', async () => {
      const { values, tracker, request } = setup();

      tracker.handleReady({
        human_support_enabled: true,
        history: [milestoneItem(START_ID, 'started', 1)],
      });
      request.resolve({});
      await flush();

      expect(values.humanSupport).toEqual({ active: true });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'HumanSupportTracker: human support state unconfirmed',
        {
          operation: 'confirm-human-support-state',
          connectionStatus: 'connected',
          reason: 'no_active',
        },
      );
    });

    it.each([
      [new Error('Human support state request timed out'), 'timeout'],
      [new Error('WebSocket not connected'), 'send_failed'],
    ])('keeps the deduced state on %p', async (error, reason) => {
      const { values, tracker, request } = setup();

      tracker.handleReady({
        human_support_enabled: true,
        history: [milestoneItem(START_ID, 'started', 1)],
      });
      request.reject(error);
      await flush();

      expect(values.humanSupport).toEqual({ active: true });
      expect(warn).toHaveBeenCalledWith(
        'HumanSupportTracker: human support state unconfirmed',
        expect.objectContaining({ reason }),
      );
    });

    it('ignores an answer that arrives after a newer live milestone', async () => {
      const { values, tracker, request } = setup();

      tracker.handleReady({
        human_support_enabled: true,
        history: [milestoneItem(START_ID, 'started', 100)],
      });
      tracker.handleProcessedMessage(milestone(END_ID, 'ended', 200));
      request.resolve({ active: true });
      await flush();

      expect(values.humanSupport).toEqual({ active: false });
    });

    it('ignores an answer from a previous connection', async () => {
      const { values, tracker, request } = setup();

      tracker.handleReady({ human_support_enabled: true, history: [] });
      tracker.handleConnectionLost();
      request.resolve({ active: true });
      await flush();

      expect(values.humanSupport).toEqual({ active: false });
      expect(warn).not.toHaveBeenCalled();
    });

    it('turns support off when the socket disables the feature', () => {
      const { values, tracker, changed } = setup();

      tracker.handleReady({
        human_support_enabled: true,
        history: [milestoneItem(START_ID, 'started', 1)],
      });
      tracker.handleReady({});

      expect(values.features).toEqual({ humanSupportStatus: false });
      expect(values.humanSupport).toEqual({ active: false });
      expect(changed).toHaveBeenLastCalledWith({ active: false });
    });
  });

  describe('milestones', () => {
    it('detects duplicates already in the conversation', () => {
      const { tracker } = setup([milestone(START_ID, 'started', 1)]);

      expect(
        tracker.isDuplicateMilestone(milestone(START_ID, 'started', 1)),
      ).toBe(true);
      expect(tracker.isDuplicateMilestone(milestone(END_ID, 'ended', 2))).toBe(
        false,
      );
      expect(tracker.isDuplicateMilestone({ id: 'msg_1', type: 'text' })).toBe(
        false,
      );
    });

    it('applies newer milestones and ignores older ones', () => {
      const { values, tracker, changed } = setup();

      tracker.handleProcessedMessage(milestone(START_ID, 'started', 100));
      expect(values.humanSupport).toEqual({ active: true });

      tracker.handleProcessedMessage(milestone(END_ID, 'ended', 200));
      expect(values.humanSupport).toEqual({ active: false });

      tracker.handleProcessedMessage(
        milestone('11111111-2222-5333-8444-555555555555', 'started', 150),
      );
      expect(values.humanSupport).toEqual({ active: false });
      expect(changed).toHaveBeenCalledTimes(2);
    });

    it('keeps support on across a disconnect', () => {
      const { values, tracker } = setup();

      tracker.handleProcessedMessage(milestone(START_ID, 'started', 100));
      tracker.handleConnectionLost();

      expect(values.humanSupport).toEqual({ active: true });
    });
  });

  describe('typing', () => {
    it('shows the agent name and hides it 10 s after the last heartbeat', () => {
      jest.useFakeTimers();
      const { values, tracker, typingStart, typingStop } = setup();
      const author = {
        type: 'human_agent' as const,
        id: AGENT_ID,
        name: 'Julia',
      };

      tracker.handleHumanAgentTyping(author);
      expect(values.typingAuthor).toEqual({
        type: 'human_agent',
        name: 'Julia',
      });
      expect(values.isTyping).toBe(true);
      expect(typingStart).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(5000);
      tracker.handleHumanAgentTyping(author);
      jest.advanceTimersByTime(9999);
      expect(values.isTyping).toBe(true);
      expect(typingStart).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1);
      expect(values.typingAuthor).toBeNull();
      expect(values.isTyping).toBe(false);
      expect(typingStop).toHaveBeenCalledTimes(1);
    });

    it('hides the indicator when that agent sends a message', () => {
      jest.useFakeTimers();
      const { values, tracker } = setup();

      tracker.handleHumanAgentTyping({ type: 'human_agent', id: AGENT_ID });
      tracker.handleProcessedMessage({
        id: 'msg_other',
        direction: 'incoming',
        author: { type: 'human_agent', id: OTHER_AGENT_ID },
      });
      expect(values.isTyping).toBe(true);

      tracker.handleProcessedMessage({
        id: 'msg_julia',
        direction: 'incoming',
        author: { type: 'human_agent', id: AGENT_ID, name: 'Julia' },
      });
      expect(values.isTyping).toBe(false);
      expect(values.typingAuthor).toBeNull();
    });

    it('matches any Live Desk message when an id is missing', () => {
      jest.useFakeTimers();
      const { values, tracker } = setup();

      tracker.handleHumanAgentTyping({ type: 'human_agent' });
      tracker.handleProcessedMessage({
        direction: 'incoming',
        author: { type: 'human_agent', id: AGENT_ID },
      });

      expect(values.isTyping).toBe(false);
    });

    it('hides the indicator on an ended milestone and on disconnect', () => {
      jest.useFakeTimers();
      const { values, tracker } = setup();

      tracker.handleHumanAgentTyping({ type: 'human_agent' });
      tracker.handleProcessedMessage(milestone(END_ID, 'ended', 1));
      expect(values.isTyping).toBe(false);

      tracker.handleHumanAgentTyping({ type: 'human_agent' });
      tracker.handleConnectionLost();
      expect(values.isTyping).toBe(false);
    });
  });

  describe('outgoing messages', () => {
    const enable = (tracker: HumanSupportTracker) =>
      tracker.handleReady({ human_support_enabled: true, history: [] });

    it('marks new messages as written by the shopper only with the feature on', () => {
      const { tracker } = setup();

      expect(tracker.decorateOutgoing({ id: 'msg_1' })).toEqual({
        id: 'msg_1',
      });
      enable(tracker);
      expect(tracker.decorateOutgoing({ id: 'msg_1' })).toEqual({
        id: 'msg_1',
        author: { type: 'contact' },
      });
    });

    it('marks a sent message as sent with the feature off', () => {
      const { tracker } = setup();

      expect(tracker.resolveLocalSendUpdates({ id: 'msg_1' })).toEqual({
        status: 'sent',
      });
    });

    it('clears the clock in AI mode and keeps it during human support', () => {
      const message = {
        id: 'msg_1',
        direction: 'outgoing',
        status: 'pending',
        author: { type: 'contact' as const },
      };
      const { tracker } = setup([message]);
      enable(tracker);

      expect(tracker.resolveLocalSendUpdates(message)).toEqual({
        __awaitingSave: true,
        status: undefined,
      });

      tracker.handleProcessedMessage(milestone(START_ID, 'started', 1));
      expect(tracker.resolveLocalSendUpdates(message)).toEqual({
        __awaitingSave: true,
      });
    });

    it('treats a message without a valid wire id as finished', () => {
      const message = {
        id: 'bad id',
        direction: 'outgoing',
        status: 'pending',
      };
      const { tracker } = setup([message]);
      enable(tracker);

      expect(tracker.resolveLocalSendUpdates(message)).toEqual({
        author: { type: 'contact' },
        status: undefined,
      });
    });
  });

  describe('message_saved and message_status', () => {
    function pending(id: string, extra: TrackedMessage = {}): TrackedMessage {
      return {
        id,
        direction: 'outgoing',
        status: 'pending',
        author: { type: 'contact' },
        __awaitingSave: true,
        ...extra,
      };
    }

    it('sets sent and the server position during human support', () => {
      const { tracker, updated } = setup([pending('msg_1')]);

      tracker.handleMessageSaved({
        type: 'message_saved',
        id: 'msg_1',
        order_key: 10,
        status: 'sent',
      });

      expect(updated).toHaveBeenCalledWith([
        {
          id: 'msg_1',
          updates: { orderKey: 10, status: 'sent' },
          internalUpdates: { __awaitingSave: undefined },
        },
      ]);
    });

    it('removes the clock when saved outside human support', () => {
      const { tracker, updated } = setup([pending('msg_1')]);

      tracker.handleMessageSaved({ id: 'msg_1', order_key: 10 });

      expect(updated.mock.calls[0][0][0].updates).toEqual({
        orderKey: 10,
        status: undefined,
      });
    });

    it('never downgrades a status that arrived first', () => {
      const { tracker, updated } = setup([
        pending('msg_1', { status: 'delivered', __awaitingSave: false }),
      ]);

      tracker.handleMessageSaved({
        id: 'msg_1',
        order_key: 10,
        status: 'sent',
      });

      expect(updated.mock.calls[0][0]).toEqual([
        { id: 'msg_1', updates: { orderKey: 10 }, internalUpdates: undefined },
      ]);
    });

    it('adds the shopper author when the message was queued before the gate', () => {
      const { tracker, updated } = setup([
        { id: 'msg_1', direction: 'outgoing', status: 'pending' },
      ]);

      tracker.handleMessageSaved({ id: 'msg_1', order_key: 10 });

      expect(updated.mock.calls[0][0][0].updates.author).toEqual({
        type: 'contact',
      });
    });

    it('ignores unknown and incoming ids silently', () => {
      const { tracker, updated } = setup([
        { id: 'msg_in', direction: 'incoming' },
      ]);

      tracker.handleMessageSaved({ id: 'msg_unknown', order_key: 1 });
      tracker.handleMessageSaved({ id: 'msg_in', order_key: 1 });
      tracker.handleMessageStatus({
        message_status: { ids: ['msg_unknown', 'msg_in'], status: 'read' },
      });

      expect(updated).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it('applies a read batch with forward-only transitions', () => {
      const { tracker, updated } = setup([
        pending('a', { status: 'delivered' }),
        pending('b', { status: 'read' }),
        pending('c', { status: undefined }),
      ]);

      tracker.handleMessageStatus({
        message_status: { ids: ['a', 'b', 'c'], status: 'read' },
      });

      expect(updated).toHaveBeenCalledWith([
        { id: 'a', updates: { status: 'read' } },
        { id: 'c', updates: { status: 'read' } },
      ]);
    });

    it('ignores delivered after read', () => {
      const { tracker, updated } = setup([pending('a', { status: 'read' })]);

      tracker.handleMessageStatus({
        message_status: { ids: ['a'], status: 'delivered' },
      });

      expect(updated).not.toHaveBeenCalled();
    });

    it('discards invalid frames with a privacy-safe warning', () => {
      const { tracker, updated } = setup([pending('msg_1')]);

      tracker.handleMessageSaved({ id: 'msg_1' });
      tracker.handleMessageStatus({
        message_status: { ids: [], status: 'read' },
      });

      expect(updated).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        'HumanSupportTracker: invalid frame discarded',
        {
          operation: 'normalize-message-saved',
          frameType: 'message_saved',
          reason: 'invalid_order_key',
        },
      );
      expect(warn).toHaveBeenCalledWith(
        'HumanSupportTracker: invalid frame discarded',
        {
          operation: 'normalize-message-status',
          frameType: 'message_status',
          reason: 'invalid_ids',
        },
      );
    });
  });

  describe('reconcileAwaitingSave', () => {
    const awaiting = (id: string): TrackedMessage => ({
      id,
      direction: 'outgoing',
      status: 'pending',
      __awaitingSave: true,
    });

    it('fails an awaiting message missing from a page that holds the whole conversation', () => {
      const { tracker, updated } = setup([awaiting('lost')]);

      tracker.reconcileAwaitingSave(new Set(['other']), false);

      expect(updated).toHaveBeenCalledWith([
        {
          id: 'lost',
          updates: { status: 'error' },
          internalUpdates: { __awaitingSave: undefined },
        },
      ]);
      expect(warn).toHaveBeenCalledWith(
        'HumanSupportTracker: message not confirmed after reconnect',
        {
          operation: 'reconcile-awaiting-save',
          messageId: 'lost',
          reason: 'missing_from_history',
        },
      );
    });

    it('fails it when a later local message was saved', () => {
      const { tracker, updated } = setup([
        awaiting('lost'),
        { id: 'later', direction: 'outgoing', orderKey: 5 },
      ]);

      tracker.reconcileAwaitingSave(new Set(['later']), true);

      expect(updated.mock.calls[0][0][0].id).toBe('lost');
    });

    it('leaves ambiguous and confirmed messages unchanged', () => {
      const { tracker, updated } = setup([
        awaiting('saved'),
        awaiting('maybe'),
      ]);

      tracker.reconcileAwaitingSave(new Set(['saved']), true);
      expect(updated).not.toHaveBeenCalled();
    });
  });

  it('destroy hides typing once, then drops timers and listeners', () => {
    jest.useFakeTimers();
    const { values, tracker, typingStop } = setup();

    tracker.handleHumanAgentTyping({ type: 'human_agent' });
    tracker.destroy();
    jest.advanceTimersByTime(20000);

    expect(values.isTyping).toBe(false);
    expect(typingStop).toHaveBeenCalledTimes(1);
    expect(tracker.listenerCount('typing:stop')).toBe(0);
  });
});
