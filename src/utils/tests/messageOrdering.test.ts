import {
  getSortKey,
  insertMessage,
  isLocalTail,
  repositionMessage,
  sortMessages,
} from '../messageOrdering';
import type { OrderableMessage } from '../messageOrdering';

const ids = (messages: OrderableMessage[]) => messages.map(({ id }) => id);

describe('messageOrdering', () => {
  describe('isLocalTail', () => {
    it('is true for unplaced shopper messages only', () => {
      expect(isLocalTail({ direction: 'outgoing', status: 'pending' })).toBe(
        true,
      );
      expect(isLocalTail({ direction: 'outgoing', status: 'error' })).toBe(
        true,
      );
      expect(isLocalTail({ direction: 'outgoing', __awaitingSave: true })).toBe(
        true,
      );
      expect(
        isLocalTail({ direction: 'outgoing', status: 'pending', orderKey: 5 }),
      ).toBe(false);
      expect(isLocalTail({ direction: 'outgoing', status: 'sent' })).toBe(
        false,
      );
      expect(isLocalTail({ direction: 'incoming', status: 'pending' })).toBe(
        false,
      );
    });
  });

  describe('getSortKey', () => {
    it('prefers orderKey, then a numeric timestamp, then 0', () => {
      expect(getSortKey({ orderKey: 10, timestamp: 99 })).toBe(10);
      expect(getSortKey({ timestamp: 99 })).toBe(99);
      expect(getSortKey({ timestamp: '42' })).toBe(42);
      expect(getSortKey({ timestamp: 'not-a-number' })).toBe(0);
      expect(getSortKey({})).toBe(0);
    });
  });

  describe('sortMessages', () => {
    it('orders by orderKey with legacy items by timestamp and keeps local tail last', () => {
      const sorted = sortMessages<OrderableMessage>([
        {
          id: 'pending',
          direction: 'outgoing',
          status: 'pending',
          timestamp: 1,
        },
        { id: 'new', orderKey: 3000 },
        { id: 'legacy', timestamp: 1000 },
        { id: 'middle', orderKey: 2000 },
      ]);

      expect(ids(sorted)).toEqual(['legacy', 'middle', 'new', 'pending']);
    });

    it('keeps the given order for equal keys', () => {
      const sorted = sortMessages<OrderableMessage>([
        { id: 'b', orderKey: 5 },
        { id: 'a', orderKey: 5 },
      ]);

      expect(ids(sorted)).toEqual(['b', 'a']);
    });
  });

  describe('insertMessage', () => {
    it('appends items without orderKey in arrival order', () => {
      const list: OrderableMessage[] = [
        { id: 'keyed', orderKey: 9000 },
        { id: 'pending', direction: 'outgoing', status: 'pending' },
      ];

      expect(ids(insertMessage(list, { id: 'stream', timestamp: 1 }))).toEqual([
        'keyed',
        'pending',
        'stream',
      ]);
    });

    it('places keyed items by orderKey, before local tail items', () => {
      const list: OrderableMessage[] = [
        { id: 'a', orderKey: 100 },
        { id: 'c', orderKey: 300 },
        { id: 'pending', direction: 'outgoing', status: 'pending' },
      ];

      expect(ids(insertMessage(list, { id: 'b', orderKey: 200 }))).toEqual([
        'a',
        'b',
        'c',
        'pending',
      ]);
    });

    it('never passes an unkeyed live item', () => {
      const list: OrderableMessage[] = [
        { id: 'stream', timestamp: 999999 },
        { id: 'later', orderKey: 500 },
      ];

      expect(ids(insertMessage(list, { id: 'early', orderKey: 100 }))).toEqual([
        'stream',
        'early',
        'later',
      ]);
    });

    it('keeps arrival order for equal keys and does not mutate the input', () => {
      const list: OrderableMessage[] = [{ id: 'first', orderKey: 7 }];
      const result = insertMessage(list, { id: 'second', orderKey: 7 });

      expect(ids(result)).toEqual(['first', 'second']);
      expect(ids(list)).toEqual(['first']);
    });
  });

  describe('repositionMessage', () => {
    it('moves a confirmed message back past local tail and later keyed items', () => {
      const list: OrderableMessage[] = [
        { id: 'a', orderKey: 100 },
        { id: 'offline', direction: 'outgoing', status: 'pending' },
        { id: 'agent', orderKey: 400 },
        { id: 'saved', direction: 'outgoing', orderKey: 300 },
      ];

      expect(ids(repositionMessage(list, 'saved'))).toEqual([
        'a',
        'saved',
        'offline',
        'agent',
      ]);
    });

    it('stops at an unkeyed live item instead of passing it', () => {
      const list: OrderableMessage[] = [
        { id: 'older', orderKey: 300 },
        { id: 'ai-stream', timestamp: 1 },
        { id: 'question', direction: 'outgoing', orderKey: 200 },
      ];

      expect(repositionMessage(list, 'question')).toBe(list);
    });

    it('keeps a question above an AI reply that started before its confirmation', () => {
      const list: OrderableMessage[] = [
        { id: 'question', direction: 'outgoing', orderKey: 200 },
        { id: 'ai-stream', timestamp: 1 },
      ];

      expect(ids(repositionMessage(list, 'question'))).toEqual([
        'question',
        'ai-stream',
      ]);
    });

    it('returns the same list when the id is unknown or has no orderKey', () => {
      const list: OrderableMessage[] = [{ id: 'x' }];

      expect(repositionMessage(list, 'missing')).toBe(list);
      expect(repositionMessage(list, 'x')).toBe(list);
    });
  });
});
