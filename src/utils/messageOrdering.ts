export interface OrderableMessage {
  id?: string;
  direction?: string;
  orderKey?: number;
  status?: string;
  timestamp?: number | string;
  __awaitingSave?: boolean;
}

function hasOrderKey(message: OrderableMessage): boolean {
  return typeof message.orderKey === 'number';
}

/**
 * A shopper message the server has not placed yet: pending, failed, or
 * written to the socket but not confirmed by `message_saved`. These stay at
 * the end of the conversation, in local order (AD-002, item 4).
 */
export function isLocalTail(message: OrderableMessage): boolean {
  return (
    message.direction === 'outgoing' &&
    !hasOrderKey(message) &&
    (message.status === 'pending' ||
      message.status === 'error' ||
      message.__awaitingSave === true)
  );
}

/**
 * Sort key of an item: the server `orderKey`, or the timestamp in ms for
 * items saved before the launch (whose timestamp is on the socket clock).
 */
export function getSortKey(message: OrderableMessage): number {
  if (hasOrderKey(message)) {
    return message.orderKey as number;
  }

  const timestamp = Number(message.timestamp);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Whether `previous` must stay after `message` when scanning backward.
 */
function shouldPass(
  previous: OrderableMessage,
  message: OrderableMessage,
): boolean {
  return (
    isLocalTail(previous) ||
    (hasOrderKey(previous) &&
      (previous.orderKey as number) > (message.orderKey as number))
  );
}

/**
 * Orders a merged list (history + local): stable sort by sort key, with local
 * tail items appended in their current order. Stability keeps the order in
 * which the socket returned items with equal keys (it breaks ties by `_id`).
 */
export function sortMessages<T extends OrderableMessage>(messages: T[]): T[] {
  const placed: T[] = [];
  const tail: T[] = [];

  messages.forEach((message) => {
    (isLocalTail(message) ? tail : placed).push(message);
  });

  placed.sort((left, right) => getSortKey(left) - getSortKey(right));
  return [...placed, ...tail];
}

/**
 * Inserts a live item. Items without `orderKey` (AI streams, legacy frames,
 * local status rows) are appended in arrival order, because their timestamp
 * is the browser clock and must not be compared with socket-clock keys. Keyed
 * items go after the last item that is neither local tail nor keyed later.
 */
export function insertMessage<T extends OrderableMessage>(
  messages: T[],
  message: T,
): T[] {
  if (!hasOrderKey(message)) {
    return [...messages, message];
  }

  let index = messages.length;
  while (index > 0 && shouldPass(messages[index - 1], message)) {
    index -= 1;
  }

  return [...messages.slice(0, index), message, ...messages.slice(index)];
}

/**
 * Moves an item that just received its `orderKey` (from `message_saved`). It
 * only moves backward, so a shopper question never jumps below an AI reply
 * that started streaming before the confirmation arrived.
 */
export function repositionMessage<T extends OrderableMessage>(
  messages: T[],
  messageId: string,
): T[] {
  const current = messages.findIndex((item) => item.id === messageId);
  if (current === -1 || !hasOrderKey(messages[current])) {
    return messages;
  }

  const message = messages[current];
  let target = current;
  while (target > 0 && shouldPass(messages[target - 1], message)) {
    target -= 1;
  }

  if (target === current) {
    return messages;
  }

  const without = [
    ...messages.slice(0, current),
    ...messages.slice(current + 1),
  ];
  return [...without.slice(0, target), message, ...without.slice(target)];
}
