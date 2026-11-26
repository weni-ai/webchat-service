import {
  buildHistoryMilestone,
  findLatestMilestone,
  mergeServerOwnedFields,
  readHistoryHumanSupportFields,
} from '../humanSupportHistory';

const AGENT = {
  type: 'human_agent',
  name: 'Julia',
  id: 'ha_5f0c3a9e1b7d4c2a8e6f0b1d3c5a7e9f',
};
const START_ID = '6f1d2c3b-4a59-5e6f-8a7b-9c0d1e2f3a4b';
const END_ID = 'a2b3c4d5-e6f7-5a8b-9c0d-1e2f3a4b5c6d';

function milestoneItem(eventId: string, event: string, orderKey?: number) {
  return {
    direction: 'in',
    timestamp: orderKey ? Math.floor(orderKey / 1000) : 1793727000,
    ...(orderKey !== undefined && { order_key: orderKey }),
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

describe('humanSupportHistory', () => {
  describe('buildHistoryMilestone', () => {
    it('builds a milestone with its order key', () => {
      const { milestone } = buildHistoryMilestone(
        milestoneItem(START_ID, 'started', 1793727247312),
      );

      expect(milestone).toEqual(
        expect.objectContaining({
          id: `hs_${START_ID}`,
          orderKey: 1793727247312,
          humanSupportEvent: expect.objectContaining({ event: 'started' }),
        }),
      );
    });

    it('rejects an invalid milestone item', () => {
      expect(
        buildHistoryMilestone({
          message: { type: 'human_support_event', human_support_event: {} },
        }),
      ).toEqual({ reason: 'invalid_event_id' });
    });
  });

  describe('readHistoryHumanSupportFields', () => {
    it('reads the client id, author, status, order key and server time of a shopper item', () => {
      expect(
        readHistoryHumanSupportFields({
          direction: 'out',
          timestamp: 1793727380,
          order_key: 1793727380207,
          message: {
            id: 'msg_1793195220123_k3j9x2',
            timestamp: '1793727379',
            author: { type: 'contact' },
            status: 'read',
          },
        }),
      ).toEqual({
        clientMessageId: 'msg_1793195220123_k3j9x2',
        author: { type: 'contact' },
        orderKey: 1793727380207,
        serverTimestamp: 1793727379000,
        status: 'read',
      });
    });

    it('ignores id and status on incoming items', () => {
      expect(
        readHistoryHumanSupportFields({
          direction: 'in',
          order_key: 10,
          message: { id: 'msg_1', status: 'read', author: AGENT },
        }),
      ).toEqual({
        author: AGENT,
        orderKey: 10,
        serverTimestamp: undefined,
      });
    });

    it('returns nothing for a pre-launch item', () => {
      expect(
        readHistoryHumanSupportFields({
          direction: 'in',
          timestamp: 1793640000,
          message: { type: 'text', text: 'old' },
        }),
      ).toEqual({});
    });

    it('reports an out-of-contract author', () => {
      expect(
        readHistoryHumanSupportFields({
          direction: 'in',
          message: { author: { type: 'robot' } },
        }),
      ).toEqual({ authorReason: 'unknown_author_type' });
    });
  });

  describe('findLatestMilestone', () => {
    it('picks the milestone with the highest order key', () => {
      const latest = findLatestMilestone([
        {
          direction: 'out',
          order_key: 9999999999999,
          message: { type: 'text' },
        },
        milestoneItem(START_ID, 'started', 1793727247312),
        milestoneItem(END_ID, 'ended', 1793727708044),
      ]);

      expect(latest?.event.event).toBe('ended');
      expect(latest?.sortKey).toBe(1793727708044);
    });

    it('returns nothing for a page without valid milestones', () => {
      expect(findLatestMilestone([{ message: { type: 'text' } }])).toBe(
        undefined,
      );
      expect(findLatestMilestone(undefined)).toBeUndefined();
      expect(
        findLatestMilestone([
          { message: { type: 'human_support_event', human_support_event: {} } },
        ]),
      ).toBeUndefined();
    });

    it('falls back to the item timestamp without an order key', () => {
      const latest = findLatestMilestone([milestoneItem(START_ID, 'started')]);

      expect(latest?.sortKey).toBe(1793727000000);
    });
  });

  describe('mergeServerOwnedFields', () => {
    it('takes server fields from history and moves the status forward', () => {
      const cached = {
        id: 'msg_1',
        direction: 'outgoing',
        status: 'sent',
        timestamp: 5,
      };
      const merged = mergeServerOwnedFields(cached, {
        orderKey: 10,
        author: { type: 'contact' as const },
        status: 'read',
      });

      expect(merged).toEqual({
        ...cached,
        orderKey: 10,
        author: { type: 'contact' },
        status: 'read',
      });
    });

    it('never moves a status backward', () => {
      const cached = { status: 'read', orderKey: 10 };

      expect(mergeServerOwnedFields(cached, { status: 'delivered' })).toBe(
        cached,
      );
    });

    it('clears the clock and awaiting flag of a message saved in AI mode', () => {
      const merged = mergeServerOwnedFields(
        { id: 'msg_1', status: 'pending', __awaitingSave: true },
        { id: 'msg_1', orderKey: 10 },
      );

      expect(merged).toEqual({ id: 'msg_1', orderKey: 10 });
    });

    it('returns the cached object when nothing changes', () => {
      const cached = {
        id: 'x',
        orderKey: 3,
        author: { type: 'ai_agent' as const },
      };

      expect(
        mergeServerOwnedFields(cached, {
          orderKey: 3,
          author: { type: 'ai_agent' },
        }),
      ).toBe(cached);
    });
  });
});
