import EventEmitter from 'eventemitter3';

import { findLatestMilestone } from '../utils/humanSupportHistory';
import {
  HUMAN_SUPPORT_EVENT_MESSAGE_TYPE,
  readHumanSupportStateActive,
  warnHumanSupportContract,
} from '../utils/humanSupportWire';
import type { MessageAuthor } from '../utils/humanSupportWire';
import { HumanAgentTyping } from './HumanAgentTyping';
import { ShopperMessageStatus } from './ShopperMessageStatus';
import type {
  HumanSupportState,
  HumanSupportStatePort,
  HumanSupportTransportPort,
  MessageUpdate,
  ServiceFeatures,
  TrackedMessage,
} from './humanSupportTypes';

export const HUMAN_SUPPORT_TRACKER_EVENTS = {
  HUMAN_SUPPORT_CHANGED: 'human_support:changed',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  MESSAGES_UPDATED: 'messages:updated',
} as const;

export interface HumanSupportTrackerOptions {
  state: HumanSupportStatePort;
  transport: HumanSupportTransportPort;
  typingTimeoutMs: number;
  stateTimeoutMs: number;
}

/**
 * HumanSupportTracker
 *
 * Single entry point of the human support feature for the service facade
 * (AD-002, AD-003, AD-004). It owns the per-connection feature gate and
 * `humanSupport.active` (history deduction, Flows confirmation and live
 * milestones), and delegates shopper statuses to ShopperMessageStatus and
 * the agent typing indicator to HumanAgentTyping.
 *
 * Emits `human_support:changed`, `typing:start`, `typing:stop`, and
 * `messages:updated` with MessageUpdate[] for the facade to apply.
 */
export class HumanSupportTracker extends EventEmitter {
  private readonly state: HumanSupportStatePort;
  private readonly transport: HumanSupportTransportPort;
  private readonly stateTimeoutMs: number;
  private readonly typing: HumanAgentTyping;
  private readonly shopperStatus: ShopperMessageStatus;

  // Incremented on every ready_for_message and disconnect so a Flows answer
  // that belongs to a previous connection is never applied.
  private connectionEpoch = 0;
  // Incremented on every applied live milestone; a confirmation requested
  // before a newer milestone is stale and must not override it.
  private liveMilestoneSeq = 0;
  private lastAppliedMilestoneKey: number | undefined;

  constructor(options: HumanSupportTrackerOptions) {
    super();
    this.state = options.state;
    this.transport = options.transport;
    this.stateTimeoutMs = options.stateTimeoutMs;
    this.typing = new HumanAgentTyping(
      options.state,
      options.typingTimeoutMs,
      (isTyping) =>
        this.emit(
          isTyping
            ? HUMAN_SUPPORT_TRACKER_EVENTS.TYPING_START
            : HUMAN_SUPPORT_TRACKER_EVENTS.TYPING_STOP,
        ),
    );
    this.shopperStatus = new ShopperMessageStatus(options.state, {
      isEnabled: () => this.isEnabled(),
      isActive: () => this.isActive(),
    });
  }

  /** Whether the socket enabled the feature for the current connection. */
  isEnabled(): boolean {
    const features = this.state.get('features') as ServiceFeatures | undefined;
    return features?.humanSupportStatus === true;
  }

  /** Whether the conversation is currently in human support. */
  isActive(): boolean {
    const humanSupport = this.state.get('humanSupport') as
      | HumanSupportState
      | undefined;
    return humanSupport?.active === true;
  }

  /**
   * Applies `ready_for_message.data`: sets the feature gate, deduces the state
   * from the last milestone in the history page, then asks the socket to
   * confirm it with Flows.
   */
  handleReady(readyData: unknown): void {
    this.connectionEpoch += 1;

    const data = (readyData ?? {}) as Record<string, unknown>;
    const enabled = data.human_support_enabled === true;
    this.state.setFeatures({ humanSupportStatus: enabled });

    if (!enabled) {
      this.lastAppliedMilestoneKey = undefined;
      this.setActive(false);
      this.typing.clear();
      return;
    }

    // A page without milestones is ambiguous: keep the current value until
    // Flows confirms it.
    const latest = findLatestMilestone(data.history);
    if (latest) {
      this.lastAppliedMilestoneKey = latest.sortKey;
      this.setActive(latest.event.event === 'started');
    }

    this.confirmState();
  }

  /**
   * Hides the typing indicator and discards any in-flight confirmation. The
   * feature gate and `humanSupport.active` are kept, so the tag stays until
   * the real state is known again (FR-035, FR-045).
   */
  handleConnectionLost(): void {
    this.connectionEpoch += 1;
    this.typing.clear();
  }

  /** Resets module-local state when the session is cleared. */
  reset(): void {
    this.handleConnectionLost();
    this.lastAppliedMilestoneKey = undefined;
  }

  destroy(): void {
    this.reset();
    this.removeAllListeners();
  }

  /**
   * Marks a new outgoing message as written by the shopper, so the widget
   * shows its time and clock while it is pending (FR-010, FR-018).
   */
  decorateOutgoing<T extends TrackedMessage>(message: T): T {
    if (this.isEnabled() && message && !message.author) {
      message.author = { type: 'contact' };
    }
    return message;
  }

  /** Changes to apply once a shopper message was written to the socket. */
  resolveLocalSendUpdates(message: TrackedMessage): Record<string, unknown> {
    return this.shopperStatus.resolveLocalSend(message);
  }

  /** Whether a processed milestone is already in the conversation. */
  isDuplicateMilestone(message: TrackedMessage): boolean {
    return (
      message?.type === HUMAN_SUPPORT_EVENT_MESSAGE_TYPE &&
      typeof message.id === 'string' &&
      this.state.getMessage(message.id) !== undefined
    );
  }

  /**
   * Reacts to an item just added to the conversation: a newer milestone sets
   * `humanSupport.active`; a Live Desk message hides that agent's typing.
   */
  handleProcessedMessage(message: TrackedMessage): void {
    if (message?.type === HUMAN_SUPPORT_EVENT_MESSAGE_TYPE) {
      this.applyLiveMilestone(message);
      return;
    }

    if (message?.direction === 'incoming') {
      this.typing.handleAgentMessage(message.author);
    }
  }

  /** Live Desk typing heartbeat (AD-004, NFR-002). */
  handleHumanAgentTyping(author: MessageAuthor | undefined): void {
    this.typing.handleHeartbeat(author);
  }

  handleMessageSaved(raw: unknown): void {
    this.emitUpdates(this.shopperStatus.resolveMessageSaved(raw));
  }

  handleMessageStatus(raw: unknown): void {
    this.emitUpdates(this.shopperStatus.resolveMessageStatus(raw));
  }

  /** Settles messages the server never confirmed, after a reconnect. */
  reconcileAwaitingSave(historyIds: Set<string>, pageWasFull: boolean): void {
    this.emitUpdates(
      this.shopperStatus.resolveAwaitingSave(historyIds, pageWasFull),
    );
  }

  private confirmState(): void {
    const epoch = this.connectionEpoch;
    const milestoneSeq = this.liveMilestoneSeq;

    this.transport
      .requestHumanSupportState(this.stateTimeoutMs)
      .then((response) => {
        if (epoch !== this.connectionEpoch) {
          return;
        }

        const active = readHumanSupportStateActive(response);
        if (active === undefined) {
          this.warnUnconfirmed('no_active');
          return;
        }

        if (milestoneSeq === this.liveMilestoneSeq) {
          this.setActive(active);
        }
      })
      .catch((error: unknown) => {
        if (epoch !== this.connectionEpoch) {
          return;
        }

        const timedOut =
          error instanceof Error && error.message.includes('timed out');
        this.warnUnconfirmed(timedOut ? 'timeout' : 'send_failed');
      });
  }

  private applyLiveMilestone(message: TrackedMessage): void {
    const event = message.humanSupportEvent;
    if (!event) {
      return;
    }

    // An older milestone (late delivery) is shown in place but does not
    // change the current state.
    const key = message.orderKey ?? event.occurredAt;
    if (
      this.lastAppliedMilestoneKey !== undefined &&
      key < this.lastAppliedMilestoneKey
    ) {
      return;
    }

    this.lastAppliedMilestoneKey = key;
    this.liveMilestoneSeq += 1;
    this.setActive(event.event === 'started');

    if (event.event === 'ended') {
      this.typing.clear();
    }
  }

  private setActive(active: boolean): void {
    if (this.isActive() === active) {
      return;
    }

    const humanSupport = { active };
    this.state.setHumanSupport(humanSupport);
    this.emit(HUMAN_SUPPORT_TRACKER_EVENTS.HUMAN_SUPPORT_CHANGED, humanSupport);
  }

  private emitUpdates(changes: MessageUpdate[]): void {
    if (changes.length > 0) {
      this.emit(HUMAN_SUPPORT_TRACKER_EVENTS.MESSAGES_UPDATED, changes);
    }
  }

  private warnUnconfirmed(reason: string): void {
    const connection = this.state.get('connection') as
      | { status?: string }
      | undefined;
    warnHumanSupportContract(
      'HumanSupportTracker',
      'human support state unconfirmed',
      {
        operation: 'confirm-human-support-state',
        connectionStatus: connection?.status,
        reason,
      },
    );
  }
}
