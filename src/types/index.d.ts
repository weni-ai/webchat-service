/**
 * Service configuration options
 */
export interface ServiceConfig {
  // Required
  socketUrl: string;
  channelUuid: string;

  // Connection
  host?: string;
  mode?: 'preview' | 'live';
  connectOn?: 'mount' | 'manual' | 'demand';
  storage?: 'local' | 'session';
  callbackUrl?: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
  pingInterval?: number;

  // Session
  sessionId?: string;
  sessionToken?: string;
  clientId?: string;

  // Messages
  initPayload?: string;
  messageDelay?: number | ((message: Message) => number);
  typingDelay?: number;
  customMessageDelay?: (text: string) => number;

  // Cache
  autoClearCache?: boolean;
  cacheTimeout?: number;
  contactTimeout?: number;

  // Advanced
  customData?: Record<string, unknown>;
  params?: Record<string, unknown>;

  // NEW: Professional logging system
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  logEnabled?: boolean;

  // NEW: Page tracking manager
  enablePageTracking?: boolean;
}

/**
 * Message types
 */
export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'location'
  | 'interactive'
  | 'conversation_status';

/**
 * Message structure
 */
export interface Message {
  // Core fields
  id?: string;
  ID?: string; // Uppercase for history compatibility
  type: MessageType;
  text?: string;
  /** Semantic category for conversation_status rows (e.g. success, info); host-defined */
  statusType?: string;

  // Media fields
  media?: string; // Base64 or URL for sending or receiving
  caption?: string; // Media caption

  // Metadata
  timestamp?: number;
  direction?: 'incoming' | 'outgoing' | 'in' | 'out';
  sender?: 'response' | 'client';
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'error'; // NEW: Message status tracking

  // Interactive elements
  quick_replies?: QuickReply[];
  header?: string;
  footer?: string;
  product_list?: {
    text?: string;
    buttonText?: string;
    sections?: unknown[];
  };
  product_carousel?: {
    text?: string;
    product_items?: unknown[];
  };

  // Additional data
  metadata?: Record<string, unknown>;
  persisted?: boolean;
  /** True when the outgoing text came from a conversation-starter click */
  from_conversation_starter?: boolean;
}

/**
 * Quick reply button
 */
export interface QuickReply {
  type: 'text' | 'location' | 'email' | 'phone';
  title: string;
  payload?: string;
}

/**
 * Chat state
 */
export interface ChatState {
  messages: Message[];
  session: SessionData;
  connection: ConnectionState;
  context: string;
  isTyping: boolean;
  thinkingText: string | null;
  error?: Error | null;
}

/**
 * Session data
 */
export interface SessionData {
  id: string;
  createdAt: number;
  lastActivity: number;
  metadata?: Record<string, unknown>;
}

/**
 * Connection state
 */
export interface ConnectionState {
  status:
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'error'
    | 'reconnecting';
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
  nextAttemptAt?: number;
  lastError?: string;
}

/**
 * WebSocket message payload
 */
export interface WebSocketMessage {
  type: string;
  message?: unknown;
  context?: string;
  from?: string;
  session_type?: string;
  callback?: string;
  token?: string;
  trigger?: string;
}

/**
 * Socket event sent before the first answer delta of a stream.
 * Shown as thinking text; not stored as a chat message.
 */
export interface StreamRationaleMessage {
  type: 'stream_rationale';
  id: string;
  content: string;
  index?: number;
}

/**
 * Product data for PDP conversation starters request
 */
export interface StartersData {
  account: string;
  linkText: string;
  productPath?: string;
  productName?: string;
  description?: string;
  brand?: string;
  attributes?: Record<string, string>;
}

/**
 * History request options
 */
export interface HistoryOptions {
  limit?: number;
  page?: number;
  before?: number;
  after?: number;
}

/**
 * File upload data
 */
export interface FileUploadData {
  type: MessageType;
  base64: string;
  filename?: string;
  size?: number;
  mimeType?: string;
}

/**
 * Audio recording options
 */
export interface AudioRecordingOptions {
  maxDuration?: number;
  mimeType?: string;
  audioBitsPerSecond?: number;
}

/**
 * NEW: Error types (structured error handling)
 */
export type ErrorType =
  | 'network'
  | 'validation'
  | 'permission'
  | 'storage'
  | 'server'
  | 'websocket'
  | 'unknown';

/**
 * WebSocket error types
 */
export type WebSocketErrorType =
  | 'forbidden'
  | 'warning'
  | 'error'
  | 'connection_closed'
  | 'duplicate_session';

/**
 * NEW: Error entry (structured error tracking)
 */
export interface ErrorEntry {
  id: string;
  error: Error;
  type: ErrorType;
  context: Record<string, unknown>;
  timestamp: number;
  stack?: string | null;
}

/**
 * NEW: WebSocket error action (structured error handling)
 */
export interface WebSocketErrorAction {
  type: string | null;
  canReconnect: boolean;
  delay: number;
  showModal: boolean;
  message: string;
}

/**
 * NEW: Logger configuration (professional logging)
 */
export interface LoggerConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
  prefix?: string;
  enabled?: boolean;
  timestamp?: boolean;
  colors?: boolean;
  transports?: string[];
}

/**
 * NEW: Retry strategy configuration (exponential backoff)
 */
export interface RetryStrategyConfig {
  baseDelay?: number;
  maxDelay?: number;
  factor?: number;
  jitter?: boolean;
  maxJitter?: number;
}

/**
 * NEW: Metadata configuration (centralized metadata manager)
 */
export interface MetadataConfig {
  linkTarget?: string;
  userInput?: string;
  pageChangeCallbacks?: PageChangeCallback[];
  domHighlight?: DOMHighlightConfig | null;
  pageEventCallbacks?: unknown[];
}

/**
 * Page change callback
 */
export interface PageChangeCallback {
  url: string;
  callbackIntent?: string;
  intent?: string;
  regex?: boolean;
  errorIntent?: string | null;
  enabled?: boolean;
}

/**
 * NEW: DOM highlight configuration (DOM interaction manager)
 */
export interface DOMHighlightConfig {
  selector: string;
  style?: Record<string, string>;
  class?: string;
  scroll?: boolean;
}

/**
 * NEW: Analytics event (analytics manager)
 */
export interface AnalyticsEvent {
  id: string;
  name: string;
  data: Record<string, unknown>;
  timestamp: number;
  sessionTime: number;
}

/**
 * NEW: Analytics metrics (analytics manager)
 */
export interface AnalyticsMetrics {
  messagesSent: number;
  messagesReceived: number;
  attachmentsSent: number;
  recordingsSent: number;
  connectionAttempts: number;
  connectionFailures: number;
  sessionStartTime: number;
  totalUptime: number;
  averageSessionDuration?: number;
  successRate?: number;
}

/**
 * Params configuration
 */
export interface ParamsConfig {
  storage?: 'local' | 'session';
  [key: string]: unknown;
}

/**
 * Retry information
 */
export interface RetryInfo {
  attempts: number;
  nextDelay: number;
  maxAttempts: number;
}

/**
 * File configuration
 */
export interface FileConfig {
  allowedTypes: string[];
  maxFileSize: number;
  acceptAttribute: string;
}

export interface AddToCartItem {
  id: string;
  seller: string;
  quantity?: number;
  /** Product image URL copied onto the order message thumbnail */
  image?: string;
}

export interface AddProductToCartProps {
  VTEXAccountName: string;
  orderFormId: string;
  /** Preferred batch shape */
  items?: AddToCartItem[];
  /** @deprecated Prefer `items`. Legacy single-item API. */
  seller?: string;
  /** @deprecated Prefer `items`. Legacy single-item API. */
  id?: string;
  /** @deprecated Prefer `items`. Legacy single-item API. */
  quantity?: number;
}

export interface CartUpdatedItem {
  id: string;
  quantity?: number;
}

export type UtmSource =
  | 'cx_shopping_assistant_conv_starter'
  | 'cx_shopping_assistant'
  | 'cx_shopping_assistant_cart';

export interface SendUtmData {
  vtex_account: string;
  order_form_id: string;
  utm_source: UtmSource;
}

/**
 * Main service class
 */
export default class WeniWebchatService {
  constructor(config: ServiceConfig);

  // Lifecycle
  init(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): void;
  destroy(): void;

  // Messages
  sendMessage(text: string, options?: SendMessageOptions): Promise<void>;
  addConversationStatus(
    text: string,
    statusType: string,
    options?: ConversationStatusOptions,
  ): Message;
  watchStorefront(): void;
  unwatchStorefront(): void;
  getStorefrontSnapshot(): import('../modules/storefront/types').StorefrontSnapshot;
  setPendingCartItem(
    key: string,
    quantity: number,
    origin: 'conversation' | 'catalog',
  ): void;
  flushPendingCart(keys?: string[]): Promise<void>;
  requestAvailabilityNotify(
    skuId: string,
    sellerId: string,
    contact: string,
  ): Promise<void>;
  getHostSegment(): Promise<string | null>;
  enterVoiceSession(): Promise<void>;
  exitVoiceSession(): void;
  speakIncomingText(text: string, messageId: string): Promise<void>;

  addProductToCart(
    props: AddProductToCartProps,
    timeoutMs?: number,
  ): Promise<{ items: CartUpdatedItem[] }>;
  sendUtm(
    data: SendUtmData,
    timeoutMs?: number,
  ): Promise<{ utm_source: UtmSource }>;
  sendAttachment(file: File): Promise<void>;
  sendAudio(audioData: AudioPayload): Promise<void>;

  // History
  getHistory(options?: HistoryOptions): Promise<Message[]>;

  // Starters
  getStarters(productData: StartersData): void;
  clearStarters(): void;

  // Context
  setContext(context: string): void;
  getContext(): string;

  // State
  getState(): ChatState;
  /**
   * Shows rationale text on the thinking indicator and emits `thinking:text:changed`.
   * Throws when `text` is not a non-empty string.
   */
  setThinkingText(text: string): void;
  getMessages(): Message[];
  getSessionId(): string | null;
  getConnectionStatus(): string;
  isConnected(): boolean;
  isModeVisible(): boolean;

  // Session
  clearSession(): void;

  // Audio recording
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  cancelRecording(): void;

  // Retry strategy
  getRetryInfo(): RetryInfo;
  resetRetryStrategy(): void;
  reconnectNow(): Promise<void>;

  // File configuration
  getAllowedFileTypes(): string[];
  getFileConfig(): FileConfig;

  // Events
  on(event: string, callback: ServiceEventListener): this;
  off(event: string, callback: ServiceEventListener): this;
  emit(event: string, ...args: unknown[]): boolean;

  // Static methods
  static isAudioRecordingSupported(): boolean;

  // Static constants
  static ALLOWED_FILE_TYPES: string[];
  static MESSAGE_TYPES: Record<string, MessageType>;
  static MESSAGE_KINDS: {
    RATIONALE: 'rationale';
    FINAL_RESPONSE: 'final_response';
  };
  static MESSAGE_STATUS: Record<string, string>;
  static MESSAGE_DIRECTIONS: Record<string, string>;
  static CONNECTION_STATUS: Record<string, string>;
  static STORAGE_TYPES: Record<string, string>;
  static ERROR_TYPES: Record<string, string>;
  static QUICK_REPLY_TYPES: Record<string, string>;
  static SERVICE_EVENTS: Record<string, string>;
  static DEFAULTS: ServiceDefaults;
}

// Named exports for constants
export const ALLOWED_FILE_TYPES: string[];
export const MESSAGE_TYPES: Record<string, MessageType>;
export const MESSAGE_KINDS: {
  RATIONALE: 'rationale';
  FINAL_RESPONSE: 'final_response';
};
export const MESSAGE_STATUS: Record<string, string>;
export const MESSAGE_DIRECTIONS: Record<string, string>;
export const CONNECTION_STATUS: Record<string, string>;
export const STORAGE_TYPES: Record<string, string>;
export const ERROR_TYPES: Record<string, string>;
export const QUICK_REPLY_TYPES: Record<string, string>;
export const SERVICE_EVENTS: Record<string, string>;
export const DEFAULTS: ServiceDefaults;

/**
 * Options accepted by sendMessage
 */
export interface SendMessageOptions {
  id?: string;
  timestamp?: number;
  status?: Message['status'];
  metadata?: Record<string, unknown>;
  hidden?: boolean;
  fromConversationStarter?: boolean;
}

/**
 * Options accepted by addConversationStatus
 */
export interface ConversationStatusOptions {
  id?: string;
  timestamp?: number;
  direction?: Message['direction'];
  metadata?: Record<string, unknown>;
}

/**
 * Audio payload accepted by sendAudio
 */
export interface AudioPayload {
  base64: string;
  blob?: Blob;
  duration?: number;
  mimeType?: string;
}

/**
 * Listener registered with on/off. `never` keeps the callback parameter
 * open so callers can pass a function with a concrete event payload.
 */
export type ServiceEventListener = (...args: never[]) => void;

/**
 * Built-in service defaults
 */
export interface ServiceDefaults {
  RENDER_PERCENTAGE: number;
  MODE: string;
  CONNECT_ON: string;
  STORAGE: string;
  AUTO_RECONNECT: boolean;
  MAX_RECONNECT_ATTEMPTS: number;
  MAX_RECLAIM_ATTEMPTS: number;
  RECONNECT_INTERVAL: number;
  PING_INTERVAL: number;
  MAX_PING_LIMIT: number;
  MESSAGE_DELAY: number;
  TYPING_DELAY: number;
  ENABLE_TYPING_INDICATOR: boolean;
  TYPING_TIMEOUT: number;
  DISPLAY_UNREAD_COUNT: boolean;
  AUTO_CLEAR_CACHE: boolean;
  CACHE_TIMEOUT: number;
  CONTACT_TIMEOUT: number;
  MAX_FILE_SIZE: number;
  COMPRESS_IMAGES: boolean;
  IMAGE_QUALITY: number;
  MAX_IMAGE_WIDTH: number;
  MAX_IMAGE_HEIGHT: number;
  MAX_RECORDING_DURATION: number;
  AUDIO_BITS_PER_SECOND: number;
  HISTORY_LIMIT: number;
  HISTORY_PAGE: number;
  LOG_LEVEL: string;
  LOG_ENABLED: boolean;
}
