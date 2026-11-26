import type {
  HumanSupportEvent,
  MessageAuthor,
  TypingAuthor,
} from '../utils/humanSupportWire';

export interface HumanSupportState {
  active: boolean;
}

export interface ServiceFeatures {
  humanSupportStatus: boolean;
}

export interface TrackedMessage {
  id?: string;
  type?: string;
  direction?: string;
  status?: string;
  orderKey?: number;
  timestamp?: number | string;
  author?: MessageAuthor;
  humanSupportEvent?: HumanSupportEvent;
  __awaitingSave?: boolean;
}

/**
 * One message change. `updates` is emitted publicly in `message:updated`;
 * `internalUpdates` is applied to state and storage but never emitted.
 * A key set to `undefined` removes that field.
 */
export interface MessageUpdate {
  id: string;
  updates: Record<string, unknown>;
  internalUpdates?: Record<string, unknown>;
}

/** The subset of StateManager the human support modules use. */
export interface HumanSupportStatePort {
  get(key: string): unknown;
  getMessage(id: string): TrackedMessage | undefined;
  getMessages(): TrackedMessage[];
  setFeatures(features: ServiceFeatures): void;
  setHumanSupport(humanSupport: HumanSupportState): void;
  setTypingAuthor(typingAuthor: TypingAuthor | null): void;
  setTyping(isTyping: boolean): void;
}

/** The subset of WebSocketManager the human support modules use. */
export interface HumanSupportTransportPort {
  requestHumanSupportState(timeoutMs: number): Promise<{ active?: boolean }>;
}
