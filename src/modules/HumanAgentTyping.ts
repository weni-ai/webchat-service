import { toTypingAuthor } from '../utils/humanSupportWire';
import type { MessageAuthor, TypingAuthor } from '../utils/humanSupportWire';

export interface TypingStatePort {
  get(key: string): unknown;
  setTypingAuthor(typingAuthor: TypingAuthor | null): void;
  setTyping(isTyping: boolean): void;
}

/**
 * HumanAgentTyping
 *
 * Typing indicator of a Live Desk agent, driven by heartbeats with no stop
 * event (AD-004): each heartbeat renews the expiry, so a lost heartbeat can
 * only hide the indicator, never leave it stuck (NFR-002). It has its own
 * timer so AI typing and thinking frames cannot clear or extend it.
 */
export class HumanAgentTyping {
  private readonly state: TypingStatePort;
  private readonly timeoutMs: number;
  private readonly onTypingChange: (isTyping: boolean) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Kept here only to match the agent's next message; never exposed.
  private agentId: string | undefined;

  constructor(
    state: TypingStatePort,
    timeoutMs: number,
    onTypingChange: (isTyping: boolean) => void,
  ) {
    this.state = state;
    this.timeoutMs = timeoutMs;
    this.onTypingChange = onTypingChange;
  }

  isActive(): boolean {
    return this.timer !== null;
  }

  /** Shows the agent as typing and renews the expiry. */
  handleHeartbeat(author: MessageAuthor | undefined): void {
    const wasTyping = this.isActive();
    const typingAuthor = toTypingAuthor(author);
    this.agentId = author?.type === 'human_agent' ? author.id : undefined;

    const current = this.state.get('typingAuthor') as TypingAuthor | null;
    if (!current || current.name !== typingAuthor.name) {
      this.state.setTypingAuthor(typingAuthor);
    }

    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.clear(), this.timeoutMs);

    if (!wasTyping) {
      this.state.setTyping(true);
      this.onTypingChange(true);
    }
  }

  /**
   * Hides the indicator when a message from the typing agent arrives. When
   * either side has no id, any Live Desk message matches.
   */
  handleAgentMessage(author: MessageAuthor | undefined): void {
    if (!this.isActive() || author?.type !== 'human_agent') {
      return;
    }

    const sameAgent = !this.agentId || !author.id || author.id === this.agentId;
    if (sameAgent) {
      this.clear();
    }
  }

  /** Hides the indicator, if shown. */
  clear(): void {
    const wasTyping = this.isActive();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.agentId = undefined;

    if (!wasTyping) {
      return;
    }

    this.state.setTypingAuthor(null);
    this.state.setTyping(false);
    this.onTypingChange(false);
  }
}
