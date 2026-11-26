import {
  getStatusRank,
  isServerMessageStatus,
  resolveForwardStatus,
} from '../messageStatus';

describe('messageStatus', () => {
  it('recognizes only server statuses', () => {
    expect(isServerMessageStatus('sent')).toBe(true);
    expect(isServerMessageStatus('delivered')).toBe(true);
    expect(isServerMessageStatus('read')).toBe(true);
    expect(isServerMessageStatus('pending')).toBe(false);
    expect(isServerMessageStatus('error')).toBe(false);
    expect(isServerMessageStatus('toString')).toBe(false);
    expect(isServerMessageStatus(undefined)).toBe(false);
  });

  it('ranks local and absent statuses below every server status', () => {
    expect(getStatusRank(undefined)).toBe(0);
    expect(getStatusRank('pending')).toBe(0);
    expect(getStatusRank('error')).toBe(0);
    expect(getStatusRank('streaming')).toBe(0);
    expect(getStatusRank('sent')).toBe(1);
    expect(getStatusRank('delivered')).toBe(2);
    expect(getStatusRank('read')).toBe(3);
  });

  it.each([
    [undefined, 'sent', 'sent'],
    ['pending', 'sent', 'sent'],
    ['error', 'delivered', 'delivered'],
    ['sent', 'delivered', 'delivered'],
    ['sent', 'read', 'read'],
    ['delivered', 'read', 'read'],
    ['delivered', 'sent', 'delivered'],
    ['read', 'delivered', 'read'],
    ['read', 'sent', 'read'],
    ['read', 'read', 'read'],
  ] as const)('moves %s with %s to %s', (current, next, expected) => {
    expect(resolveForwardStatus(current, next)).toBe(expected);
  });
});
