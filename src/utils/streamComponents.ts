export type ComponentType = 'quick_replies' | 'list_message' | 'cta_message';

export type StreamPhase =
  | 'streaming_text'
  | 'awaiting_components'
  | 'completed';

export interface ComponentHint {
  componentType: ComponentType;
  labels?: string[];
  count?: number;
  itemCount?: number;
}

export interface QuickReplyObject {
  type?: string;
  title: string;
  payload?: string;
}

export type QuickReplyItem = string | QuickReplyObject;

export interface ListMessageItem {
  uuid: string;
  title: string;
  description?: string;
}

export interface ListMessage {
  button_text: string;
  list_items: ListMessageItem[];
  item_count?: number;
}

export interface CtaMessage {
  display_text: string;
  url: string;
}

export interface StreamComponentsBundle {
  quick_replies?: QuickReplyItem[];
  list_message?: ListMessage;
  cta_message?: CtaMessage;
}

export interface ComponentValidationWarning {
  operation: string;
  messageId?: string;
  componentType?: string;
  reason: string;
}

export interface NormalizedHintResult {
  hint?: ComponentHint;
  warning?: ComponentValidationWarning;
}

export interface NormalizedComponentResult {
  componentType?: ComponentType;
  payload?: QuickReplyItem[] | ListMessage | CtaMessage;
  warning?: ComponentValidationWarning;
}

export interface NormalizedBundleResult {
  components: StreamComponentsBundle;
  warnings: ComponentValidationWarning[];
}

export const COMPONENT_TYPES = {
  QUICK_REPLIES: 'quick_replies',
  LIST_MESSAGE: 'list_message',
  CTA_MESSAGE: 'cta_message',
} as const;

export const STREAM_PHASES = {
  STREAMING_TEXT: 'streaming_text',
  AWAITING_COMPONENTS: 'awaiting_components',
  COMPLETED: 'completed',
} as const;

const VALID_COMPONENT_TYPES = new Set<string>(Object.values(COMPONENT_TYPES));

function resolveComponentType(rawType: unknown): ComponentType | undefined {
  return typeof rawType === 'string' && VALID_COMPONENT_TYPES.has(rawType)
    ? (rawType as ComponentType)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Validates that a CTA URL is a complete absolute http(s) URL with a non-empty
 * hostname, blocking partial URLs and unsafe schemes (BD-004, FR-018).
 */
export function isCompleteHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const trimmed = value.trim();
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Logs a structured, privacy-safe warning without message text, labels, or URLs.
 */
export function warnComponentContract(
  modulePrefix: 'MessageProcessor' | 'HistoryManager',
  message: string,
  warning: ComponentValidationWarning,
): void {
  const context: Record<string, string> = {
    operation: warning.operation,
    reason: warning.reason,
  };

  if (warning.messageId) {
    context.messageId = warning.messageId;
  }
  if (warning.componentType) {
    context.componentType = warning.componentType;
  }

  console.warn(`${modulePrefix}: ${message}`, context);
}

/**
 * Validates and normalizes a `quick_replies` wire payload.
 * Accepts non-empty string labels and legacy `{ title }` objects.
 */
export function normalizeQuickReplies(
  raw: unknown,
): QuickReplyItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }

  const valid: QuickReplyItem[] = [];

  for (const item of raw) {
    if (isNonEmptyString(item)) {
      valid.push(item);
    } else if (isRecord(item) && isNonEmptyString(item.title)) {
      const normalized: QuickReplyObject = { title: item.title };
      if (typeof item.type === 'string') {
        normalized.type = item.type;
      }
      if (typeof item.payload === 'string') {
        normalized.payload = item.payload;
      }
      valid.push(normalized);
    }
  }

  return valid.length > 0 ? valid : undefined;
}

/**
 * Validates and normalizes a `list_message` wire payload.
 * Preserves optional positive integer `item_count` (AD-006, FR-019).
 */
export function normalizeListMessage(raw: unknown): ListMessage | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  if (!isNonEmptyString(raw.button_text) || !Array.isArray(raw.list_items)) {
    return undefined;
  }

  const items: ListMessageItem[] = [];
  for (const rawItem of raw.list_items) {
    if (
      !isRecord(rawItem) ||
      !isNonEmptyString(rawItem.uuid) ||
      !isNonEmptyString(rawItem.title)
    ) {
      continue;
    }

    const item: ListMessageItem = {
      uuid: rawItem.uuid,
      title: rawItem.title,
    };

    if (typeof rawItem.description === 'string') {
      item.description = rawItem.description;
    }

    items.push(item);
  }

  if (items.length === 0) {
    return undefined;
  }

  const normalized: ListMessage = {
    button_text: raw.button_text,
    list_items: items,
  };

  if (isPositiveInteger(raw.item_count)) {
    normalized.item_count = raw.item_count;
  }

  return normalized;
}

function unescapeHttpUrlSlashes(url: string): string {
  if (!url.includes('\\/')) {
    return url;
  }

  return url.replace(/https?:(?:\/\/|\\\/\\\/)[^\s<>"']+/gi, (match) =>
    match.replace(/\\\//g, '/'),
  );
}

/**
 * Validates and normalizes a `cta_message` wire payload, unescaping JSON-escaped
 * slashes in `url` and enforcing a complete absolute http(s) URL (BD-004).
 */
export function normalizeCtaMessage(raw: unknown): CtaMessage | undefined {
  if (!isRecord(raw) || !isNonEmptyString(raw.display_text)) {
    return undefined;
  }

  if (typeof raw.url !== 'string') {
    return undefined;
  }

  const unescapedUrl = unescapeHttpUrlSlashes(raw.url);
  if (!isCompleteHttpUrl(unescapedUrl)) {
    return undefined;
  }

  return {
    display_text: raw.display_text,
    url: unescapedUrl.trim(),
  };
}

/**
 * Validates and normalizes a `stream_component_hint` wire frame into camelCase
 * `ComponentHint`. Whitelists contract fields only so a CTA URL can never leak
 * through a hint (BD-004, AD-002, AD-005).
 */
export function normalizeComponentHint(
  raw: unknown,
  messageId?: string,
): NormalizedHintResult {
  if (!isRecord(raw)) {
    return {
      warning: {
        operation: 'normalize-component-hint',
        messageId,
        reason: 'invalid_payload',
      },
    };
  }

  const rawType = raw.component_type;
  const componentType = resolveComponentType(rawType);

  if (!componentType) {
    return {
      warning: {
        operation: 'normalize-component-hint',
        messageId,
        componentType: typeof rawType === 'string' ? rawType : 'unknown',
        reason: 'invalid_component_type',
      },
    };
  }

  const hint: ComponentHint = { componentType };

  if (Array.isArray(raw.labels)) {
    const validLabels = raw.labels.filter(isNonEmptyString);
    if (validLabels.length > 0) {
      hint.labels = validLabels;
    }
  }

  if (isPositiveInteger(raw.count)) {
    hint.count = raw.count;
  }

  if (
    componentType === COMPONENT_TYPES.LIST_MESSAGE &&
    isPositiveInteger(raw.item_count)
  ) {
    hint.itemCount = raw.item_count;
  }

  return { hint };
}

/**
 * Upserts a normalized `ComponentHint` into an existing hints array idempotently
 * by `componentType` without mutating the input array.
 */
export function upsertComponentHint(
  existingHints: readonly ComponentHint[],
  nextHint: ComponentHint,
): ComponentHint[] {
  const index = existingHints.findIndex(
    (entry) => entry.componentType === nextHint.componentType,
  );

  if (index === -1) {
    return [...existingHints, nextHint];
  }

  const updated = [...existingHints];
  updated[index] = nextHint;
  return updated;
}

/**
 * Validates and normalizes a `stream_component` wire frame.
 */
export function normalizeStreamComponent(
  raw: unknown,
  messageId?: string,
): NormalizedComponentResult {
  if (!isRecord(raw)) {
    return {
      warning: {
        operation: 'normalize-stream-component',
        messageId,
        reason: 'invalid_payload',
      },
    };
  }

  const rawType = raw.component_type;
  const componentType = resolveComponentType(rawType);

  if (!componentType) {
    return {
      warning: {
        operation: 'normalize-stream-component',
        messageId,
        componentType: typeof rawType === 'string' ? rawType : 'unknown',
        reason: 'invalid_component_type',
      },
    };
  }

  const NORMALIZERS: Record<
    ComponentType,
    () => QuickReplyItem[] | ListMessage | CtaMessage | undefined
  > = {
    quick_replies: () => normalizeQuickReplies(raw.quick_replies),
    list_message: () => normalizeListMessage(raw.list_message),
    cta_message: () => normalizeCtaMessage(raw.cta_message),
  };

  const payload = NORMALIZERS[componentType]();
  if (!payload) {
    return {
      warning: {
        operation: 'normalize-stream-component',
        messageId,
        componentType,
        reason:
          componentType === COMPONENT_TYPES.CTA_MESSAGE
            ? 'invalid_cta_payload'
            : 'invalid_component_payload',
      },
    };
  }

  return { componentType, payload };
}

/**
 * Extracts and validates all optional component payloads present on a
 * `stream_end` wire frame. Invalid individual components are reported as
 * warnings while valid siblings are preserved (BD-006, FR-012).
 */
export function normalizeStreamEndComponents(
  raw: unknown,
  messageId?: string,
): NormalizedBundleResult {
  const components: StreamComponentsBundle = {};
  const warnings: ComponentValidationWarning[] = [];

  if (!isRecord(raw)) {
    return { components, warnings };
  }

  if (raw.quick_replies !== undefined && raw.quick_replies !== null) {
    const normalized = normalizeQuickReplies(raw.quick_replies);
    if (normalized) {
      components.quick_replies = normalized;
    } else {
      warnings.push({
        operation: 'normalize-stream-component',
        messageId,
        componentType: COMPONENT_TYPES.QUICK_REPLIES,
        reason: 'invalid_component_payload',
      });
    }
  }

  if (raw.list_message !== undefined && raw.list_message !== null) {
    const normalized = normalizeListMessage(raw.list_message);
    if (normalized) {
      components.list_message = normalized;
    } else {
      warnings.push({
        operation: 'normalize-stream-component',
        messageId,
        componentType: COMPONENT_TYPES.LIST_MESSAGE,
        reason: 'invalid_component_payload',
      });
    }
  }

  if (raw.cta_message !== undefined && raw.cta_message !== null) {
    const normalized = normalizeCtaMessage(raw.cta_message);
    if (normalized) {
      components.cta_message = normalized;
    } else {
      warnings.push({
        operation: 'normalize-stream-component',
        messageId,
        componentType: COMPONENT_TYPES.CTA_MESSAGE,
        reason: 'invalid_cta_payload',
      });
    }
  }

  return { components, warnings };
}

/**
 * Returns a storage-safe copy of a message with transient live-streaming fields
 * (`componentHints`, `streamPhase`) removed and in-flight `status: 'streaming'`
 * normalized to `'delivered'` so reloads/restores never replay skeletons or
 * entrance animations (BD-007, FR-029, AD-005). Never mutates the input.
 */
export function stripTransientStreamingFields<T>(message: T): T {
  if (!isRecord(message)) {
    return message;
  }

  const hasHints = 'componentHints' in message;
  const hasPhase = 'streamPhase' in message;
  const isStreamingStatus = message.status === 'streaming';

  if (!hasHints && !hasPhase && !isStreamingStatus) {
    return message;
  }

  const copy: Record<string, unknown> = { ...message };
  delete copy.componentHints;
  delete copy.streamPhase;

  if (isStreamingStatus) {
    copy.status = 'delivered';
  }

  return copy as T;
}
