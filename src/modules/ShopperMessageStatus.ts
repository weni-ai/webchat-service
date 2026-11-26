import {
  isValidClientMessageId,
  normalizeMessageSavedFrame,
  normalizeMessageStatusFrame,
  warnHumanSupportContract,
} from '../utils/humanSupportWire';
import { resolveForwardStatus } from '../utils/messageStatus';
import type {
  HumanSupportStatePort,
  MessageUpdate,
  TrackedMessage,
} from './humanSupportTypes';

const LOG_PREFIX = 'HumanSupportTracker';

export interface ShopperMessageGate {
  isEnabled(): boolean;
  isActive(): boolean;
}

/**
 * ShopperMessageStatus
 *
 * Computes the status changes of shopper messages (AD-003): what happens on
 * local send, on `message_saved` and on `message_status`, and how a reconnect
 * settles messages the server never confirmed. Statuses only move forward;
 * the status is never derived from milestone positions. Every method returns
 * the changes and leaves applying them to the caller.
 */
export class ShopperMessageStatus {
  private readonly state: HumanSupportStatePort;
  private readonly gate: ShopperMessageGate;

  constructor(state: HumanSupportStatePort, gate: ShopperMessageGate) {
    this.state = state;
    this.gate = gate;
  }

  /**
   * Changes to apply once a shopper message was written to the socket. With
   * the feature off, the message becomes `sent` as before. With it on, the
   * server decides: during human support the clock stays until
   * `message_saved`; in AI mode it goes away now, with no status icon
   * (AD-003, item 7; FR-022).
   */
  resolveLocalSend(message: TrackedMessage): Record<string, unknown> {
    if (!this.gate.isEnabled()) {
      return { status: 'sent' };
    }

    const current =
      (message.id && this.state.getMessage(message.id)) || message;
    const updates: Record<string, unknown> = {};

    if (!current.author) {
      updates.author = { type: 'contact' };
    }

    if (current.orderKey !== undefined) {
      return updates;
    }

    // Without a valid id on the wire the server never confirms the message,
    // so it is treated as finished and never shows a status.
    if (!isValidClientMessageId(current.id)) {
      updates.status = undefined;
      return updates;
    }

    // `__awaitingSave` tells a reload or reconnect that this message already
    // reached the socket and must not be sent again.
    updates.__awaitingSave = true;
    if (!this.gate.isActive()) {
      updates.status = undefined;
    }
    return updates;
  }

  /** `message_saved`: server position and, during support, `sent`. */
  resolveMessageSaved(raw: unknown): MessageUpdate[] {
    const { saved, reason } = normalizeMessageSavedFrame(raw);
    if (!saved) {
      warnInvalidFrame('normalize-message-saved', 'message_saved', reason);
      return [];
    }

    const message = this.findOutgoing(saved.id);
    if (!message) {
      return [];
    }

    const updates: Record<string, unknown> = { orderKey: saved.orderKey };
    if (!message.author) {
      updates.author = { type: 'contact' };
    }

    if (saved.status === 'sent') {
      const status = resolveForwardStatus(message.status, 'sent');
      if (status !== message.status) {
        updates.status = status;
      }
    } else if (message.status === 'pending') {
      updates.status = undefined;
    }

    return [
      {
        id: saved.id,
        updates,
        internalUpdates: message.__awaitingSave
          ? { __awaitingSave: undefined }
          : undefined,
      },
    ];
  }

  /**
   * `message_status` (`delivered`, `read`) for a batch of ids. A message
   * without a status receives it anyway: the server only sends these for
   * messages it forwarded to the Live Desk (self-healing, AD-003, item 7).
   */
  resolveMessageStatus(raw: unknown): MessageUpdate[] {
    const { update, reason } = normalizeMessageStatusFrame(raw);
    if (!update) {
      warnInvalidFrame('normalize-message-status', 'message_status', reason);
      return [];
    }

    const changes: MessageUpdate[] = [];
    update.ids.forEach((id) => {
      const message = this.findOutgoing(id);
      if (!message) {
        return;
      }

      const status = resolveForwardStatus(message.status, update.status);
      if (status !== message.status) {
        changes.push({ id, updates: { status } });
      }
    });

    return changes;
  }

  /**
   * After a reconnect, fails every message still awaiting save that the
   * history page proves the server never saved: the page holds the whole
   * conversation, or a later local message is in it. Ambiguous cases stay
   * unchanged. Messages are never resent, to avoid duplicates for the agent.
   */
  resolveAwaitingSave(
    historyIds: Set<string>,
    pageWasFull: boolean,
  ): MessageUpdate[] {
    const outgoing = this.state
      .getMessages()
      .filter((message) => message?.direction === 'outgoing');
    const changes: MessageUpdate[] = [];

    outgoing.forEach((message, index) => {
      if (
        !message.__awaitingSave ||
        !message.id ||
        historyIds.has(message.id)
      ) {
        return;
      }

      const laterSaved = outgoing
        .slice(index + 1)
        .some((later) => later.id && historyIds.has(later.id));

      if (pageWasFull && !laterSaved) {
        return;
      }

      warnHumanSupportContract(
        LOG_PREFIX,
        'message not confirmed after reconnect',
        {
          operation: 'reconcile-awaiting-save',
          messageId: message.id,
          reason: 'missing_from_history',
        },
      );
      changes.push({
        id: message.id,
        updates: { status: 'error' },
        internalUpdates: { __awaitingSave: undefined },
      });
    });

    return changes;
  }

  private findOutgoing(id: string): TrackedMessage | undefined {
    const message = this.state.getMessage(id);
    return message?.direction === 'outgoing' ? message : undefined;
  }
}

function warnInvalidFrame(
  operation: string,
  frameType: string,
  reason = 'invalid_frame',
): void {
  warnHumanSupportContract(LOG_PREFIX, 'invalid frame discarded', {
    operation,
    frameType,
    reason,
  });
}
