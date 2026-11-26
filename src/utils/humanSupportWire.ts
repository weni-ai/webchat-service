export type MessageAuthor =
  | { type: 'contact' }
  | { type: 'ai_agent' }
  | { type: 'human_agent'; id?: string; name?: string };

export type HumanSupportEventType = 'started' | 'ended';

export interface HumanSupportEvent {
  eventId: string;
  event: HumanSupportEventType;
  /** Epoch milliseconds of the ticket opening or closing. */
  occurredAt: number;
}

export interface TypingAuthor {
  type: 'human_agent';
  name?: string;
}

export interface MilestoneMessage {
  id: string;
  type: 'human_support_event';
  timestamp: number;
  orderKey?: number;
  direction: 'incoming';
  humanSupportEvent: HumanSupportEvent;
}

export interface MessageSaved {
  id: string;
  orderKey: number;
  status?: 'sent';
}

export interface MessageStatusUpdate {
  ids: string[];
  status: 'delivered' | 'read';
}

export interface HumanSupportWarning {
  operation: string;
  reason: string;
  messageId?: string;
  eventId?: string;
  frameType?: string;
  messageType?: string;
  connectionStatus?: string;
}

export const MESSAGE_AUTHOR_TYPES = {
  CONTACT: 'contact',
  AI_AGENT: 'ai_agent',
  HUMAN_AGENT: 'human_agent',
} as const;

export const HUMAN_SUPPORT_EVENTS = {
  STARTED: 'started',
  ENDED: 'ended',
} as const;

export const HUMAN_SUPPORT_EVENT_MESSAGE_TYPE = 'human_support_event';

export const MILESTONE_ID_PREFIX = 'hs_';

const CLIENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HUMAN_AGENT_ID_PATTERN = /^ha_[0-9a-f]{32}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MAX_AUTHOR_NAME_LENGTH = 80;
const MAX_STATUS_IDS = 200;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether a value is a shopper message id accepted on the wire (AD-003).
 */
export function isValidClientMessageId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_MESSAGE_ID_PATTERN.test(value);
}

/**
 * Normalizes a server ordering key: epoch milliseconds on the socket clock.
 */
export function normalizeOrderKey(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Normalizes a wire `author` against the closed shared schema. Only the first
 * name and the opaque id of a Live Desk agent are kept; any other key (last
 * name, e-mail) is dropped (BD-003). A Live Desk agent with an invalid id is
 * kept as a nameless `human_agent`, so the message still reads as human
 * support instead of a pre-launch item.
 */
export function normalizeAuthor(value: unknown): {
  author?: MessageAuthor;
  reason?: string;
} {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    return { reason: 'invalid_author' };
  }

  if (value.type === 'contact' || value.type === 'ai_agent') {
    return { author: { type: value.type } };
  }

  if (value.type !== 'human_agent') {
    return { reason: 'unknown_author_type' };
  }

  if (value.id === undefined) {
    return value.name === undefined
      ? { author: { type: 'human_agent' } }
      : { author: { type: 'human_agent' }, reason: 'name_without_id' };
  }

  if (typeof value.id !== 'string' || !HUMAN_AGENT_ID_PATTERN.test(value.id)) {
    return { author: { type: 'human_agent' }, reason: 'invalid_author_id' };
  }

  const author: MessageAuthor = { type: 'human_agent', id: value.id };
  if (value.name === undefined) {
    return { author };
  }

  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (name.length === 0 || name.length > MAX_AUTHOR_NAME_LENGTH) {
    return { author, reason: 'invalid_author_name' };
  }

  return { author: { ...author, name } };
}

/**
 * Normalizes a wire `human_support_event` (`event_id`, `event`,
 * `occurred_at` in RFC 3339) to camelCase with `occurredAt` in epoch ms.
 */
export function normalizeHumanSupportEvent(value: unknown): {
  event?: HumanSupportEvent;
  reason?: string;
} {
  if (!isRecord(value)) {
    return { reason: 'invalid_human_support_event' };
  }

  const { event_id: eventId, event, occurred_at: occurredAt } = value;

  if (typeof eventId !== 'string' || !UUID_PATTERN.test(eventId)) {
    return { reason: 'invalid_event_id' };
  }

  if (event !== 'started' && event !== 'ended') {
    return { reason: 'invalid_event_type' };
  }

  const occurredAtMs =
    typeof occurredAt === 'string' && RFC3339_PATTERN.test(occurredAt)
      ? Date.parse(occurredAt)
      : NaN;
  if (!Number.isFinite(occurredAtMs)) {
    return { reason: 'invalid_occurred_at' };
  }

  return { event: { eventId, event, occurredAt: occurredAtMs } };
}

/**
 * Builds the chat item of a milestone. The id is deterministic per event, so
 * the same milestone received live, from history, or from the stored session
 * collapses into one item. The time shown is `occurredAt`; the position is
 * `orderKey`.
 */
export function buildMilestoneMessage(
  event: HumanSupportEvent,
  orderKey?: number,
): MilestoneMessage {
  const message: MilestoneMessage = {
    id: `${MILESTONE_ID_PREFIX}${event.eventId}`,
    type: HUMAN_SUPPORT_EVENT_MESSAGE_TYPE,
    timestamp: event.occurredAt,
    direction: 'incoming',
    humanSupportEvent: { ...event },
  };

  if (orderKey !== undefined) {
    message.orderKey = orderKey;
  }

  return message;
}

/**
 * Converts a Unix-seconds wire timestamp (string or number) to epoch ms.
 */
export function unixSecondsToMs(value: unknown): number | undefined {
  const seconds =
    typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : typeof value === 'number'
        ? value
        : NaN;

  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

export function normalizeMessageSavedFrame(raw: unknown): {
  saved?: MessageSaved;
  reason?: string;
} {
  if (!isRecord(raw) || !isValidClientMessageId(raw.id)) {
    return { reason: 'invalid_message_id' };
  }

  const orderKey = normalizeOrderKey(raw.order_key);
  if (orderKey === undefined) {
    return { reason: 'invalid_order_key' };
  }

  if (raw.status !== undefined && raw.status !== 'sent') {
    return { reason: 'invalid_status' };
  }

  const saved: MessageSaved = { id: raw.id, orderKey };
  if (raw.status === 'sent') {
    saved.status = 'sent';
  }
  return { saved };
}

export function normalizeMessageStatusFrame(raw: unknown): {
  update?: MessageStatusUpdate;
  reason?: string;
} {
  const body = isRecord(raw) ? raw.message_status : undefined;
  if (!isRecord(body)) {
    return { reason: 'invalid_message_status' };
  }

  if (body.status !== 'delivered' && body.status !== 'read') {
    return { reason: 'invalid_status' };
  }

  const { ids } = body;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_STATUS_IDS ||
    !ids.every(isValidClientMessageId)
  ) {
    return { reason: 'invalid_ids' };
  }

  return { update: { ids: [...new Set(ids)], status: body.status } };
}

/**
 * Reads `human_support_state.active`. Absent means Flows failed or timed out,
 * and the caller keeps the state deduced from history (FR-045).
 */
export function readHumanSupportStateActive(raw: unknown): boolean | undefined {
  return isRecord(raw) && typeof raw.active === 'boolean'
    ? raw.active
    : undefined;
}

/**
 * Public typing identity: never carries the agent id, which stays internal.
 */
export function toTypingAuthor(
  author: MessageAuthor | undefined,
): TypingAuthor {
  if (author?.type === 'human_agent' && author.name) {
    return { type: 'human_agent', name: author.name };
  }
  return { type: 'human_agent' };
}

/**
 * Logs a structured, privacy-safe warning. Only identifiers and reasons are
 * logged: never message text, agent names, agent ids, or raw frames.
 */
export function warnHumanSupportContract(
  modulePrefix: string,
  message: string,
  warning: HumanSupportWarning,
): void {
  const context: Record<string, string> = {};
  (Object.keys(warning) as Array<keyof HumanSupportWarning>).forEach((key) => {
    const value = warning[key];
    if (typeof value === 'string' && value.length > 0) {
      context[key] = value;
    }
  });

  console.warn(`${modulePrefix}: ${message}`, context);
}
