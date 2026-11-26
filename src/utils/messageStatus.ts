export type ServerMessageStatus = 'sent' | 'delivered' | 'read';

const SERVER_STATUS_RANK: Record<ServerMessageStatus, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

/**
 * Whether a value is one of the statuses the server confirms for a shopper
 * message. Local states (`pending`, `error`, `streaming`) never travel on the
 * wire.
 */
export function isServerMessageStatus(
  value: unknown,
): value is ServerMessageStatus {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(SERVER_STATUS_RANK, value)
  );
}

/**
 * Rank of a shopper message status. Local states and an absent status rank 0,
 * so any server status moves them forward.
 */
export function getStatusRank(status: unknown): number {
  return isServerMessageStatus(status) ? SERVER_STATUS_RANK[status] : 0;
}

/**
 * Returns the status a message must have after receiving `next`. Statuses only
 * move forward (`sent` < `delivered` < `read`), so an equal or lower status
 * from a late or duplicate frame leaves the current one untouched (FR-020).
 */
export function resolveForwardStatus<T>(
  current: T,
  next: ServerMessageStatus,
): T | ServerMessageStatus {
  return getStatusRank(next) > getStatusRank(current) ? next : current;
}
