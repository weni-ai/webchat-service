import {
  buildMilestoneMessage,
  HUMAN_SUPPORT_EVENTS,
  isValidClientMessageId,
  MESSAGE_AUTHOR_TYPES,
  normalizeAuthor,
  normalizeHumanSupportEvent,
  normalizeMessageSavedFrame,
  normalizeMessageStatusFrame,
  normalizeOrderKey,
  readHumanSupportStateActive,
  toTypingAuthor,
  unixSecondsToMs,
  warnHumanSupportContract,
} from '../humanSupportWire';

const AGENT_ID = 'ha_5f0c3a9e1b7d4c2a8e6f0b1d3c5a7e9f';
const EVENT_ID = '6f1d2c3b-4a59-5e6f-8a7b-9c0d1e2f3a4b';

describe('humanSupportWire', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes author types and milestone events', () => {
    expect(MESSAGE_AUTHOR_TYPES).toEqual({
      CONTACT: 'contact',
      AI_AGENT: 'ai_agent',
      HUMAN_AGENT: 'human_agent',
    });
    expect(HUMAN_SUPPORT_EVENTS).toEqual({
      STARTED: 'started',
      ENDED: 'ended',
    });
  });

  describe('isValidClientMessageId', () => {
    it('accepts the contract pattern', () => {
      expect(isValidClientMessageId('msg_1793195220123_k3j9x2')).toBe(true);
      expect(isValidClientMessageId('a'.repeat(64))).toBe(true);
    });

    it('rejects empty, too long, or unsafe ids', () => {
      expect(isValidClientMessageId('')).toBe(false);
      expect(isValidClientMessageId('a'.repeat(65))).toBe(false);
      expect(isValidClientMessageId('has space')).toBe(false);
      expect(isValidClientMessageId('<script>')).toBe(false);
      expect(isValidClientMessageId(42)).toBe(false);
    });
  });

  describe('normalizeOrderKey', () => {
    it('keeps non-negative safe integers only', () => {
      expect(normalizeOrderKey(1793727247312)).toBe(1793727247312);
      expect(normalizeOrderKey(0)).toBe(0);
      expect(normalizeOrderKey(-1)).toBeUndefined();
      expect(normalizeOrderKey(1.5)).toBeUndefined();
      expect(normalizeOrderKey('1793727247312')).toBeUndefined();
      expect(normalizeOrderKey(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
    });
  });

  describe('normalizeAuthor', () => {
    it('returns nothing for an absent author', () => {
      expect(normalizeAuthor(undefined)).toEqual({});
      expect(normalizeAuthor(null)).toEqual({});
    });

    it('keeps contact and AI authors without extra keys', () => {
      expect(normalizeAuthor({ type: 'contact', name: 'x' })).toEqual({
        author: { type: 'contact' },
      });
      expect(normalizeAuthor({ type: 'ai_agent' })).toEqual({
        author: { type: 'ai_agent' },
      });
    });

    it('keeps only the first name and opaque id of a Live Desk agent', () => {
      expect(
        normalizeAuthor({
          type: 'human_agent',
          id: AGENT_ID,
          name: '  Julia ',
          email: 'julia@example.com',
          last_name: 'Souza',
        }),
      ).toEqual({
        author: { type: 'human_agent', id: AGENT_ID, name: 'Julia' },
      });
    });

    it('accepts a Live Desk system message without id or name', () => {
      expect(normalizeAuthor({ type: 'human_agent' })).toEqual({
        author: { type: 'human_agent' },
      });
    });

    it('drops the name of an agent with an invalid or missing id', () => {
      expect(
        normalizeAuthor({ type: 'human_agent', id: 'julia', name: 'Julia' }),
      ).toEqual({
        author: { type: 'human_agent' },
        reason: 'invalid_author_id',
      });
      expect(normalizeAuthor({ type: 'human_agent', name: 'Julia' })).toEqual({
        author: { type: 'human_agent' },
        reason: 'name_without_id',
      });
    });

    it('drops an empty or too long name', () => {
      expect(
        normalizeAuthor({ type: 'human_agent', id: AGENT_ID, name: '  ' }),
      ).toEqual({
        author: { type: 'human_agent', id: AGENT_ID },
        reason: 'invalid_author_name',
      });
      expect(
        normalizeAuthor({
          type: 'human_agent',
          id: AGENT_ID,
          name: 'J'.repeat(81),
        }),
      ).toEqual({
        author: { type: 'human_agent', id: AGENT_ID },
        reason: 'invalid_author_name',
      });
    });

    it('rejects unknown types and non-objects', () => {
      expect(normalizeAuthor({ type: 'robot' })).toEqual({
        reason: 'unknown_author_type',
      });
      expect(normalizeAuthor('contact')).toEqual({ reason: 'invalid_author' });
    });
  });

  describe('normalizeHumanSupportEvent', () => {
    it('converts the wire event to camelCase with occurredAt in ms', () => {
      expect(
        normalizeHumanSupportEvent({
          event_id: EVENT_ID,
          event: 'started',
          occurred_at: '2026-11-03T17:34:05.120Z',
        }),
      ).toEqual({
        event: {
          eventId: EVENT_ID,
          event: 'started',
          occurredAt: Date.parse('2026-11-03T17:34:05.120Z'),
        },
      });
    });

    it.each([
      [null, 'invalid_human_support_event'],
      [
        {
          event_id: 'nope',
          event: 'started',
          occurred_at: '2026-11-03T17:34:05Z',
        },
        'invalid_event_id',
      ],
      [
        {
          event_id: EVENT_ID,
          event: 'accepted',
          occurred_at: '2026-11-03T17:34:05Z',
        },
        'invalid_event_type',
      ],
      [
        { event_id: EVENT_ID, event: 'ended', occurred_at: 'yesterday' },
        'invalid_occurred_at',
      ],
      [
        { event_id: EVENT_ID, event: 'ended', occurred_at: 1793727245120 },
        'invalid_occurred_at',
      ],
    ])('rejects %p with %s', (raw, reason) => {
      expect(normalizeHumanSupportEvent(raw)).toEqual({ reason });
    });
  });

  describe('buildMilestoneMessage', () => {
    it('builds a deterministic milestone item shown at occurredAt', () => {
      const event = {
        eventId: EVENT_ID,
        event: 'ended' as const,
        occurredAt: 1793727707903,
      };

      expect(buildMilestoneMessage(event, 1793727708044)).toEqual({
        id: `hs_${EVENT_ID}`,
        type: 'human_support_event',
        timestamp: 1793727707903,
        orderKey: 1793727708044,
        direction: 'incoming',
        humanSupportEvent: event,
      });
      expect(buildMilestoneMessage(event)).not.toHaveProperty('orderKey');
    });
  });

  describe('frames', () => {
    it('normalizes message_saved with and without status', () => {
      expect(
        normalizeMessageSavedFrame({
          type: 'message_saved',
          id: 'msg_1',
          order_key: 10,
          status: 'sent',
        }),
      ).toEqual({ saved: { id: 'msg_1', orderKey: 10, status: 'sent' } });
      expect(
        normalizeMessageSavedFrame({ id: 'msg_1', order_key: 10 }),
      ).toEqual({ saved: { id: 'msg_1', orderKey: 10 } });
    });

    it('rejects an invalid message_saved', () => {
      expect(
        normalizeMessageSavedFrame({ id: 'bad id', order_key: 1 }),
      ).toEqual({ reason: 'invalid_message_id' });
      expect(normalizeMessageSavedFrame({ id: 'msg_1' })).toEqual({
        reason: 'invalid_order_key',
      });
      expect(
        normalizeMessageSavedFrame({
          id: 'msg_1',
          order_key: 1,
          status: 'read',
        }),
      ).toEqual({ reason: 'invalid_status' });
    });

    it('normalizes message_status and deduplicates ids', () => {
      expect(
        normalizeMessageStatusFrame({
          message_status: { ids: ['a', 'b', 'a'], status: 'read' },
        }),
      ).toEqual({ update: { ids: ['a', 'b'], status: 'read' } });
    });

    it('rejects message_status with bad ids or status', () => {
      const tooMany = Array.from({ length: 201 }, (_, index) => `m${index}`);

      expect(normalizeMessageStatusFrame({})).toEqual({
        reason: 'invalid_message_status',
      });
      expect(
        normalizeMessageStatusFrame({
          message_status: { ids: ['a'], status: 'sent' },
        }),
      ).toEqual({ reason: 'invalid_status' });
      expect(
        normalizeMessageStatusFrame({
          message_status: { ids: [], status: 'read' },
        }),
      ).toEqual({ reason: 'invalid_ids' });
      expect(
        normalizeMessageStatusFrame({
          message_status: { ids: tooMany, status: 'read' },
        }),
      ).toEqual({ reason: 'invalid_ids' });
      expect(
        normalizeMessageStatusFrame({
          message_status: { ids: ['ok', 'not ok'], status: 'read' },
        }),
      ).toEqual({ reason: 'invalid_ids' });
    });

    it('reads human_support_state.active only when boolean', () => {
      expect(readHumanSupportStateActive({ active: true })).toBe(true);
      expect(readHumanSupportStateActive({ active: false })).toBe(false);
      expect(readHumanSupportStateActive({})).toBeUndefined();
      expect(readHumanSupportStateActive({ active: 'yes' })).toBeUndefined();
    });
  });

  it('converts Unix seconds to ms', () => {
    expect(unixSecondsToMs('1793727372')).toBe(1793727372000);
    expect(unixSecondsToMs(1793727372)).toBe(1793727372000);
    expect(unixSecondsToMs('')).toBeUndefined();
    expect(unixSecondsToMs('abc')).toBeUndefined();
    expect(unixSecondsToMs(undefined)).toBeUndefined();
  });

  it('exposes the typing author without the agent id', () => {
    expect(
      toTypingAuthor({ type: 'human_agent', id: AGENT_ID, name: 'Julia' }),
    ).toEqual({ type: 'human_agent', name: 'Julia' });
    expect(toTypingAuthor({ type: 'human_agent', id: AGENT_ID })).toEqual({
      type: 'human_agent',
    });
    expect(toTypingAuthor(undefined)).toEqual({ type: 'human_agent' });
  });

  it('logs only non-empty identifiers and reasons', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    warnHumanSupportContract('HumanSupportTracker', 'invalid frame discarded', {
      operation: 'normalize-message-saved',
      reason: 'invalid_order_key',
      messageId: '',
      frameType: 'message_saved',
    });

    expect(warn).toHaveBeenCalledWith(
      'HumanSupportTracker: invalid frame discarded',
      {
        operation: 'normalize-message-saved',
        reason: 'invalid_order_key',
        frameType: 'message_saved',
      },
    );
  });
});
