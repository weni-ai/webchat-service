import {
  buildMilestoneMessage,
  HUMAN_SUPPORT_EVENT_MESSAGE_TYPE,
  isRecord,
  isValidClientMessageId,
  normalizeAuthor,
  normalizeHumanSupportEvent,
  normalizeOrderKey,
  unixSecondsToMs,
} from './humanSupportWire';
import type {
  HumanSupportEvent,
  MessageAuthor,
  MilestoneMessage,
} from './humanSupportWire';
import { isServerMessageStatus, resolveForwardStatus } from './messageStatus';
import type { ServerMessageStatus } from './messageStatus';

export interface HistoryHumanSupportFields {
  clientMessageId?: string;
  author?: MessageAuthor;
  orderKey?: number;
  status?: ServerMessageStatus;
  serverTimestamp?: number;
}

export interface LatestMilestone {
  event: HumanSupportEvent;
  sortKey: number;
}

/**
 * Builds a milestone from a history item (`message.type` =
 * `human_support_event`), or returns a rejection reason.
 */
export function buildHistoryMilestone(item: unknown): {
  milestone?: MilestoneMessage;
  reason?: string;
} {
  const body = isRecord(item) && isRecord(item.message) ? item.message : null;
  const { event, reason } = normalizeHumanSupportEvent(
    body?.human_support_event,
  );

  if (!event) {
    return { reason };
  }

  const orderKey = isRecord(item)
    ? normalizeOrderKey(item.order_key)
    : undefined;
  return { milestone: buildMilestoneMessage(event, orderKey) };
}

/**
 * Reads the human-support fields of a history item (`message.id`, `author`,
 * `status`, `order_key`) without touching pre-launch items.
 */
export function readHistoryHumanSupportFields(
  item: unknown,
): HistoryHumanSupportFields & { authorReason?: string } {
  if (!isRecord(item)) {
    return {};
  }

  const body = isRecord(item.message) ? item.message : {};
  const fields: HistoryHumanSupportFields & { authorReason?: string } = {};

  if (item.direction === 'out' && isValidClientMessageId(body.id)) {
    fields.clientMessageId = body.id;
  }

  const { author, reason } = normalizeAuthor(body.author);
  if (author) {
    fields.author = author;
  }
  if (reason) {
    fields.authorReason = reason;
  }

  const orderKey = normalizeOrderKey(item.order_key);
  if (orderKey !== undefined) {
    fields.orderKey = orderKey;
    fields.serverTimestamp = unixSecondsToMs(body.timestamp);
  }

  if (item.direction === 'out' && isServerMessageStatus(body.status)) {
    fields.status = body.status;
  }

  return fields;
}

/**
 * Picks the most recent milestone of a raw history page by `order_key`
 * (falling back to the item `timestamp`). The socket returns history newest
 * first, so on a tie the first item wins.
 */
export function findLatestMilestone(
  rawHistory: unknown,
): LatestMilestone | undefined {
  if (!Array.isArray(rawHistory)) {
    return undefined;
  }

  let latest: LatestMilestone | undefined;

  for (const item of rawHistory) {
    if (
      !isRecord(item) ||
      !isRecord(item.message) ||
      item.message.type !== HUMAN_SUPPORT_EVENT_MESSAGE_TYPE
    ) {
      continue;
    }

    const { event } = normalizeHumanSupportEvent(
      item.message.human_support_event,
    );
    if (!event) {
      continue;
    }

    const sortKey =
      normalizeOrderKey(item.order_key) ??
      unixSecondsToMs(item.timestamp) ??
      event.occurredAt;

    if (!latest || sortKey > latest.sortKey) {
      latest = { event, sortKey };
    }
  }

  return latest;
}

interface MergeableMessage {
  orderKey?: number;
  author?: MessageAuthor;
  humanSupportEvent?: HumanSupportEvent;
  status?: string;
  __awaitingSave?: boolean;
  [key: string]: unknown;
}

function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Merges the server-owned fields of a history copy into the cached copy of the
 * same message. History wins for `orderKey`, `author` and `humanSupportEvent`;
 * the status only moves forward; a message the server saved is no longer
 * awaiting save. Returns the cached object itself when nothing changes.
 */
export function mergeServerOwnedFields<T extends MergeableMessage>(
  cached: T,
  history: MergeableMessage,
): T {
  const next: MergeableMessage = { ...cached };
  let changed = false;

  const serverOwnedFields = ['orderKey', 'author', 'humanSupportEvent'];
  serverOwnedFields.forEach((field) => {
    if (
      history[field] !== undefined &&
      !isSameValue(history[field], cached[field])
    ) {
      next[field] = history[field];
      changed = true;
    }
  });

  if (isServerMessageStatus(history.status)) {
    const status = resolveForwardStatus(cached.status, history.status);
    if (status !== cached.status) {
      next.status = status;
      changed = true;
    }
  } else if (
    history.orderKey !== undefined &&
    cached.__awaitingSave &&
    cached.status === 'pending'
  ) {
    delete next.status;
    changed = true;
  }

  if (cached.__awaitingSave) {
    delete next.__awaitingSave;
    changed = true;
  }

  return changed ? (next as T) : cached;
}
