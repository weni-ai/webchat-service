import EventEmitter from 'eventemitter3';

import {
  generateMessageId,
  isJsonObject,
  readCustomData,
  shouldIgnoreJsonObjectPayload,
  unescapeEscapedUrlSlashes,
} from '../utils/helpers';
import {
  DEFAULTS,
  SERVICE_EVENTS,
  MESSAGE_ID_PREFIX,
  MESSAGE_KINDS,
  STREAM_INITIAL_SEQUENCE,
} from '../utils/constants';
import { isOfficialHttpUrl } from '../utils/messageBuilder';
import {
  STREAM_PHASES,
  normalizeComponentHint,
  normalizeStreamComponent,
  normalizeStreamEndComponents,
  upsertComponentHint,
  warnComponentContract,
} from '../utils/streamComponents';

const MAX_COMPLETED_STREAM_IDS = 20;

/**
 * MessageProcessor
 *
 * Processes incoming and outgoing messages:
 * - Handles different message types (text, image, video, audio, file)
 * - Manages message queue with configurable delays
 * - Processes quick replies
 * - Manages typing indicators
 * - Validates messages
 */
export default class MessageProcessor extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      messageDelay: config.messageDelay || DEFAULTS.MESSAGE_DELAY,
      typingDelay: config.typingDelay || DEFAULTS.TYPING_DELAY,
      enableTypingIndicator:
        config.enableTypingIndicator !== false ||
        DEFAULTS.ENABLE_TYPING_INDICATOR,
      typingTimeout: config.typingTimeout || DEFAULTS.TYPING_TIMEOUT,
      ...config,
    };

    this.queue = [];
    this.isProcessing = false;
    this.typingTimer = null;
    this.isTypingActive = false;
    this.isThinkingActive = false;
    this.isAwaitingReply = false;
    this.streams = new Map();
    this.completedStreamIds = new Set();
    this.recentIncomingTexts = [];

    // Streaming state
    this._resetStreamState();
  }

  /**
   * Resets streaming state to initial values
   * Used when initializing, starting new stream, or cleaning up after stream end
   * @private
   * @param {string|null} [streamId=null] - Optional stream ID to set as active
   */
  _resetStreamState(streamId = null) {
    this.activeStreamId = streamId;
    this.pendingDeltas = new Map();
    this.nextExpectedSeq = STREAM_INITIAL_SEQUENCE;
    this.streamMessageEmitted = false;

    if (streamId === null) {
      this.isAwaitingReply = false;
    }
  }

  /**
   * Processes a received WebSocket message
   * Routes to appropriate handler based on message type
   * @param {Object} rawMessage Raw WebSocket message
   */
  process(rawMessage) {
    try {
      if (shouldIgnoreJsonObjectPayload(rawMessage)) {
        return;
      }

      const messageType = this._extractMessageType(rawMessage);

      switch (messageType) {
        case 'message':
          if (rawMessage.message_kind === MESSAGE_KINDS.RATIONALE) {
            this._processRationale(rawMessage);
          } else {
            this._processUserMessage(rawMessage);
          }
          break;
        case 'stream_start':
          this._processStreamStart(rawMessage);
          break;
        case 'stream_rationale':
          this._processStreamRationale(rawMessage);
          break;
        case 'stream_component_hint':
          this._processStreamComponentHint(rawMessage);
          break;
        case 'stream_component':
          this._processStreamComponent(rawMessage);
          break;
        case 'stream_text_end':
          this._processStreamTextEnd(rawMessage);
          break;
        case 'delta':
          this._processDelta(rawMessage);
          break;
        case 'stream_end':
          this._processStreamEnd(rawMessage);
          break;
        case 'typing_start':
          this._handleTypingIndicator(rawMessage);
          break;
        case 'ack':
          this._processMediaAck(rawMessage);
          break;
        default:
          this.emit(SERVICE_EVENTS.MESSAGE_UNKNOWN, rawMessage);
      }
    } catch (error) {
      this.emit(SERVICE_EVENTS.ERROR, error);
    }
  }

  /**
   * Processes user messages (text, media, etc)
   * Normalizes, validates, and queues the message
   * @private
   * @param {Object} rawMessage
   */
  _processUserMessage(rawMessage) {
    try {
      const message = this._normalizeMessage(rawMessage);

      if (!this._validateMessage(message)) {
        this.emit(SERVICE_EVENTS.ERROR, new Error('Invalid message format'));
        return;
      }

      if (message.direction === 'incoming') {
        this.isAwaitingReply = false;
      }

      if (
        message.direction === 'incoming' &&
        (this.isTypingActive || this.isThinkingActive)
      ) {
        this._stopTyping();
      }

      if (
        message.type === 'message' &&
        message.direction === 'incoming' &&
        typeof message.text === 'string' &&
        this._isDuplicateIncomingText(message.text)
      ) {
        return;
      }

      this.queue.push(message);
      this._processQueue();
    } catch (error) {
      this.emit(SERVICE_EVENTS.ERROR, error);
    }
  }

  /**
   * Accepts an upload acknowledgement. The official link must be http(s).
   * The ack is not queued as a chat message.
   * @private
   * @param {Object} raw
   */
  _processMediaAck(raw) {
    const messageType = raw?.message?.type;
    const mediaUrl = raw?.message?.media_url;

    if (!messageType || !isOfficialHttpUrl(mediaUrl)) {
      console.warn('MessageProcessor: media ack ignored', {
        operation: 'media-ack',
        messageType,
      });
      return;
    }

    this.emit(SERVICE_EVENTS.MESSAGE_MEDIA_ACK, {
      type: messageType,
      media: mediaUrl,
    });
  }

  /**
   * Extracts message type from raw WebSocket message
   * @private
   * @param {Object} raw
   * @returns {string}
   */
  _extractMessageType(raw) {
    if (!raw || typeof raw !== 'object') {
      return 'unknown';
    }

    // delta messages have 'v' and 'seq' but no 'type' field
    if ('v' in raw && 'seq' in raw && !('type' in raw)) {
      return 'delta';
    }

    if (raw.type) {
      return raw.type;
    }

    if (raw.message && raw.message.type) {
      return raw.message.type;
    }

    return 'unknown';
  }

  /**
   * Processes multiple messages (batch)
   * @param {Array} messages
   */
  processBatch(messages = []) {
    messages.forEach((msg) => this.process(msg));
  }

  /**
   * Clears the message queue
   */
  clearQueue() {
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * Normalizes message to standard format
   * @private
   * @param {Object} raw Raw message
   * @returns {Object} Normalized message
   */
  _normalizeMessage(raw) {
    const message = {
      id: raw.message?.messageId || raw.id || generateMessageId(),
      type: this._getMessageType(raw),
      timestamp: raw.timestamp || Date.now(),
      direction: 'incoming',
      status: 'delivered',
      persisted: raw.persisted || undefined,
    };

    if (raw.message && raw.message.text) {
      message.text = unescapeEscapedUrlSlashes(raw.message.text);
    }

    if (raw.message && raw.message.media) {
      message.media = raw.message.media;
    } else if (raw.message?.media_url) {
      message.media = raw.message.media_url;
    }

    if (typeof raw.message?.caption === 'string') {
      message.caption = unescapeEscapedUrlSlashes(raw.message.caption);
    }

    if (raw.message && raw.message.quick_replies) {
      message.quick_replies = raw.message.quick_replies;
    }

    if (raw.message?.list_message?.list_items?.length >= 1) {
      message.list_message = raw.message.list_message;
    }

    const CTAMessage = raw.message?.cta_message;

    if (CTAMessage?.url && CTAMessage?.display_text) {
      message.cta_message = {
        ...CTAMessage,
        url: unescapeEscapedUrlSlashes(CTAMessage.url),
      };
    }

    if (raw.metadata) {
      message.metadata = raw.metadata;
    }

    const interactive = raw.message?.interactive;

    if (interactive?.type === 'product_list') {
      message.product_list = {
        text: message.text,
        buttonText: interactive.action?.name,
        sections: interactive.action?.sections,
      };
    }

    if (interactive?.type === 'product_carousel') {
      message.product_carousel = {
        text: message.text,
        product_items: interactive.action?.product_items,
      };
    }

    if (interactive?.header) {
      message.header = unescapeEscapedUrlSlashes(interactive.header.text);
    }

    if (interactive?.footer) {
      message.footer = unescapeEscapedUrlSlashes(interactive.footer.text);
    }

    const { customData, discardedKind } = readCustomData(raw.message);

    if (customData) {
      message.customData = customData;
    } else if (discardedKind) {
      console.warn('MessageProcessor: custom_data discarded', {
        operation: 'normalize-custom-data',
        messageType: message.type,
        receivedKind: discardedKind,
      });
    }

    return message;
  }

  /**
   * Processes a stream_start message
   * Initializes stream state but does not trigger message emission until first delta
   * This allows typing indicator to be shown while the first delta has not arrived yet
   * @private
   * @param {Object} raw - { type: 'stream_start', id: string }
   */
  _processStreamStart(raw) {
    const messageId = this._getMessageIdFromRaw(raw);
    if (!messageId) {
      this.emit(
        SERVICE_EVENTS.ERROR,
        new Error('stream_start received without id'),
      );
      return;
    }

    this._beginStream(messageId);
  }

  /**
   * Records a stream as active with an empty buffer.
   * Does not emit a chat message; the first delta or component hint emits the streaming bubble.
   * @private
   * @param {string} streamId Prefixed message id
   */
  _beginStream(streamId) {
    this._resetStreamState(streamId);
    this.completedStreamIds.delete(streamId);
    this.streams.set(streamId, {
      text: '',
      timestamp: Date.now(),
      emitted: false,
      queuedMessage: null,
      streamPhase: STREAM_PHASES.STREAMING_TEXT,
      componentHints: [],
    });
  }

  /**
   * Resolves an existing stream entry or adopts one when stream_start was missed.
   * Ignores frames for already-completed streams or unrelated active streams.
   * @private
   * @param {string} streamId
   * @returns {Object|null}
   */
  _ensureStreamForFrame(streamId) {
    if (this.completedStreamIds.has(streamId)) {
      return null;
    }

    if (this.streams.has(streamId)) {
      return this.streams.get(streamId);
    }

    if (this.activeStreamId && this.activeStreamId !== streamId) {
      return null;
    }

    this._beginStream(streamId);
    return this.streams.get(streamId);
  }

  /**
   * Emits the initial streaming chat bubble for a stream.
   * @private
   * @param {string} streamId
   * @param {Object} streamData
   * @param {Object} [extraFields={}]
   */
  _emitInitialStreamMessage(streamId, streamData, extraFields = {}) {
    if (this.isTypingActive || this.isThinkingActive) {
      this._stopTyping();
    }

    const message = {
      ...this._createStreamingMessage(streamId, streamData.timestamp),
      text: streamData.text,
      streamPhase: streamData.streamPhase,
      ...extraFields,
    };

    if (streamData.componentHints.length > 0) {
      message.componentHints = [...streamData.componentHints];
    }

    streamData.emitted = true;
    streamData.queuedMessage = message;
    if (this.activeStreamId === streamId) {
      this.streamMessageEmitted = true;
    }

    this.queue.push(message);
    this._processQueue();
  }

  /**
   * Emits a stream update event or merges it into the still-queued initial message
   * when `_processQueue` is busy (e.g. `stream_component` arriving 1ms after
   * `stream_component_hint` while an earlier message is awaiting `messageDelay`).
   * @private
   * @param {string} streamId
   * @param {Object} updates
   */
  _emitStreamUpdate(streamId, updates) {
    const streamData = this.streams.get(streamId);
    if (streamData?.queuedMessage) {
      Object.assign(streamData.queuedMessage, updates);
      if ('componentHints' in updates && updates.componentHints === undefined) {
        delete streamData.queuedMessage.componentHints;
      }
      return;
    }

    this.emit(SERVICE_EVENTS.MESSAGE_UPDATED, streamId, updates);
  }

  /**
   * Processes a stream_component_hint frame, normalizing hints to camelCase
   * and emitting the streaming bubble immediately if not yet emitted (FR-008, FR-028).
   * @private
   * @param {Object} raw
   */
  _processStreamComponentHint(raw) {
    const streamId = this._getMessageIdFromRaw(raw);
    if (!streamId) {
      warnComponentContract(
        'MessageProcessor',
        'invalid component hint discarded',
        {
          operation: 'normalize-component-hint',
          reason: 'missing_id',
        },
      );
      return;
    }

    const streamData = this._ensureStreamForFrame(streamId);
    if (!streamData) {
      return;
    }

    const { hint, warning } = normalizeComponentHint(raw, streamId);
    if (warning || !hint) {
      warnComponentContract(
        'MessageProcessor',
        'invalid component hint discarded',
        warning,
      );
      return;
    }

    streamData.componentHints = upsertComponentHint(
      streamData.componentHints,
      hint,
    );

    if (!streamData.emitted) {
      this._emitInitialStreamMessage(streamId, streamData);
      return;
    }

    this._emitStreamUpdate(streamId, {
      componentHints: [...streamData.componentHints],
      status: 'streaming',
      streamPhase: streamData.streamPhase,
      timestamp: Date.now(),
    });
  }

  /**
   * Processes a stream_text_end frame, signaling that text streaming has ended
   * while one or more hinted components are still pending (FR-009, FR-018).
   * @private
   * @param {Object} raw
   */
  _processStreamTextEnd(raw) {
    const streamId = this._getMessageIdFromRaw(raw);
    if (!streamId) {
      warnComponentContract('MessageProcessor', 'stream_text_end ignored', {
        operation: 'stream-text-end',
        reason: 'missing_id',
      });
      return;
    }

    const streamData = this._ensureStreamForFrame(streamId);
    if (!streamData) {
      return;
    }

    if (this.isTypingActive || this.isThinkingActive) {
      this._stopTyping();
    }

    const contentIsLeakedJson =
      typeof raw.content === 'string' && isJsonObject(raw.content);
    const finalText = unescapeEscapedUrlSlashes(
      contentIsLeakedJson
        ? streamData.text || ''
        : typeof raw.content === 'string'
          ? raw.content
          : streamData.text || '',
    );

    streamData.text = finalText;
    streamData.streamPhase = STREAM_PHASES.AWAITING_COMPONENTS;

    if (!streamData.emitted) {
      this._emitInitialStreamMessage(streamId, streamData);
      return;
    }

    this._emitStreamUpdate(streamId, {
      text: finalText,
      status: 'streaming',
      streamPhase: STREAM_PHASES.AWAITING_COMPONENTS,
      timestamp: Date.now(),
    });
  }

  /**
   * Processes a stream_component frame delivering one validated component.
   * Keeps active componentHints intact until stream_end so multi-component
   * consumers hold remaining skeletons until every sibling resolves.
   * @private
   * @param {Object} raw
   */
  _processStreamComponent(raw) {
    const streamId = this._getMessageIdFromRaw(raw);
    if (!streamId) {
      warnComponentContract(
        'MessageProcessor',
        'invalid stream component discarded',
        {
          operation: 'normalize-stream-component',
          reason: 'missing_id',
        },
      );
      return;
    }

    const streamData = this._ensureStreamForFrame(streamId);
    if (!streamData) {
      return;
    }

    const { componentType, payload, warning } = normalizeStreamComponent(
      raw,
      streamId,
    );
    if (warning || !componentType || !payload) {
      warnComponentContract(
        'MessageProcessor',
        'invalid stream component discarded',
        warning,
      );
      return;
    }

    if (!streamData.emitted) {
      this._emitInitialStreamMessage(streamId, streamData, {
        [componentType]: payload,
      });
      return;
    }

    this._emitStreamUpdate(streamId, {
      [componentType]: payload,
      status: 'streaming',
      streamPhase: streamData.streamPhase,
      timestamp: Date.now(),
    });
  }

  /**
   * Finalizes all active emitted streams when the WebSocket disconnects or closes,
   * clearing componentHints and preserving partial text without error UI (FR-012).
   * @public
   */
  handleConnectionLost() {
    if (this.isTypingActive || this.isThinkingActive) {
      this._stopTyping();
    }

    const now = Date.now();
    for (const [streamId, streamData] of this.streams.entries()) {
      if (streamData?.emitted) {
        this._emitStreamUpdate(streamId, {
          status: 'delivered',
          streamPhase: STREAM_PHASES.COMPLETED,
          componentHints: undefined,
          timestamp: now,
        });
      }
      this._rememberCompletedStreamId(streamId);
    }

    this.streams.clear();
    this._resetStreamState();
  }

  /**
   * Applies a stream_rationale payload as thinking text for its stream.
   * A rationale is never queued or emitted as a chat message.
   * If stream_start was missed, adopts the stream so later deltas are applied.
   * @private
   * @param {Object} raw - { type: 'stream_rationale', id: string, content: string, index?: number }
   */
  _processStreamRationale(raw) {
    if (!this.config.enableTypingIndicator) {
      return;
    }

    const text = typeof raw?.content === 'string' ? raw.content.trim() : '';
    if (!text) {
      return;
    }

    const streamId = this._getMessageIdFromRaw(raw);
    if (!streamId) {
      return;
    }

    if (this.activeStreamId && this.activeStreamId !== streamId) {
      return;
    }

    if (!this.activeStreamId) {
      this._beginStream(streamId);
    }

    if (
      this.streamMessageEmitted ||
      this.nextExpectedSeq > STREAM_INITIAL_SEQUENCE
    ) {
      return;
    }

    this.showThinkingText(text);
  }

  /**
   * Processes a delta message
   * Handles sequence-based buffering and reordering
   * Requires stream_start first; deltas without an active stream are ignored
   * @private
   * @param {Object} raw - { v: string, seq: number }
   */
  _processDelta(raw) {
    const seq = raw.seq;
    const content = raw.v || '';

    if (!this._isValidSequenceNumber(seq)) {
      return;
    }

    if (!this.activeStreamId) {
      return;
    }

    // Handle first delta of the stream
    if (this._isFirstDelta(seq)) {
      this._handleFirstDelta();
    }

    this._processDeltaSequence(seq, content);
  }

  /**
   * Validates that sequence number is a positive integer
   * @private
   * @param {number} seq
   * @returns {boolean}
   */
  _isValidSequenceNumber(seq) {
    return typeof seq === 'number' && seq >= STREAM_INITIAL_SEQUENCE;
  }

  /**
   * Checks if this is the first delta of the current stream
   * @private
   * @param {number} seq
   * @returns {boolean}
   */
  _isFirstDelta(seq) {
    return (
      this.nextExpectedSeq === STREAM_INITIAL_SEQUENCE &&
      seq >= STREAM_INITIAL_SEQUENCE
    );
  }

  /**
   * Handles first delta: stops typing and emits deferred message if needed
   * @private
   */
  _handleFirstDelta() {
    if (this.isTypingActive || this.isThinkingActive) {
      this._stopTyping();
    }

    if (!this.streamMessageEmitted) {
      this._emitDeferredStreamMessage();
    }
  }

  /**
   * Emits the deferred initial streaming message
   * Called when first delta arrives after stream_start
   * @private
   */
  _emitDeferredStreamMessage() {
    const streamId = this.activeStreamId;
    const streamData = this.streams.get(streamId);
    const timestamp = streamData?.timestamp || Date.now();

    const message = this._createStreamingMessage(streamId, timestamp);
    if (streamData) {
      streamData.emitted = true;
      streamData.queuedMessage = message;
    }
    this.streamMessageEmitted = true;
    this.queue.push(message);
    this._processQueue();
  }

  /**
   * Creates a streaming message object
   * @private
   * @param {string} id
   * @param {number} timestamp
   * @returns {Object}
   */
  _createStreamingMessage(id, timestamp) {
    return {
      id,
      type: 'text',
      text: '',
      timestamp,
      direction: 'incoming',
      status: 'streaming',
      streamPhase: STREAM_PHASES.STREAMING_TEXT,
    };
  }

  /**
   * Finalized incoming text message (e.g. stream_end without prior local stream state)
   * @private
   * @param {string} id
   * @param {string} text
   * @param {number} timestamp
   * @returns {Object}
   */
  _createDeliveredTextMessage(id, text, timestamp) {
    return {
      id,
      type: 'text',
      text,
      timestamp,
      direction: 'incoming',
      status: 'delivered',
    };
  }

  /**
   * Processes delta based on sequence number
   * Applies in-order deltas immediately, buffers out-of-order ones
   * @private
   * @param {number} seq
   * @param {string} content
   */
  _processDeltaSequence(seq, content) {
    const streamId = this.activeStreamId;

    if (seq === this.nextExpectedSeq) {
      // In order - apply immediately
      this._appendStreamContent(streamId, content);
      this.nextExpectedSeq++;

      // Check for buffered deltas and apply them in order
      this._applyPendingDeltas(streamId);
    } else if (seq > this.nextExpectedSeq) {
      // Out of order - buffer for later
      this.pendingDeltas.set(seq, content);
    }
    // Ignore seq < nextExpectedSeq (duplicate)
  }

  /**
   * Applies buffered deltas in sequence order
   * @private
   * @param {string} streamId
   */
  _applyPendingDeltas(streamId) {
    while (this.pendingDeltas.has(this.nextExpectedSeq)) {
      const content = this.pendingDeltas.get(this.nextExpectedSeq);
      this.pendingDeltas.delete(this.nextExpectedSeq);
      this._appendStreamContent(streamId, content);
      this.nextExpectedSeq++;
    }
  }

  /**
   * Appends content to an active stream and emits update
   * @private
   * @param {string} streamId
   * @param {string} content
   */
  _appendStreamContent(streamId, content) {
    const current = this.streams.get(streamId);
    if (!current) return;

    const timestamp = Date.now();
    const mergedText = unescapeEscapedUrlSlashes(current.text + content);
    const streamPhase = current.streamPhase || STREAM_PHASES.STREAMING_TEXT;
    this.streams.set(streamId, {
      ...current,
      text: mergedText,
      timestamp,
      streamPhase,
    });

    this._emitStreamUpdate(streamId, {
      text: mergedText,
      status: 'streaming',
      streamPhase,
      timestamp,
    });
  }

  /**
   * Processes a stream_end message
   * Finalizes the stream and cleans up state
   * When raw.content is a string, it is the authoritative final text (e.g. after missed stream_start)
   * JSON object strings in content are ignored (backend leak); fall back to accumulated stream text
   * @private
   * @param {Object} raw - { type: 'stream_end', id: string, content?: string, quick_replies?, list_message?, cta_message? }
   */
  _processStreamEnd(raw) {
    const messageId = this._getMessageIdFromRaw(raw);
    if (!messageId) {
      this.emit(
        SERVICE_EVENTS.ERROR,
        new Error('stream_end received without id'),
      );
      return;
    }

    this.isAwaitingReply = false;

    if (this.isTypingActive || this.isThinkingActive) {
      this._stopTyping();
    }

    const streamData = this.streams.get(messageId);
    const contentIsLeakedJson =
      typeof raw.content === 'string' && isJsonObject(raw.content);
    const finalText = unescapeEscapedUrlSlashes(
      contentIsLeakedJson
        ? streamData?.text || ''
        : typeof raw.content === 'string'
          ? raw.content
          : streamData?.text || '',
    );

    const { components, warnings } = normalizeStreamEndComponents(
      raw,
      messageId,
    );
    warnings.forEach((warning) => {
      warnComponentContract(
        'MessageProcessor',
        'invalid stream component discarded',
        warning,
      );
    });

    const hasComponents = Object.keys(components).length > 0;
    const wasEmitted = Boolean(streamData?.emitted);
    const now = Date.now();

    if (wasEmitted) {
      this._emitStreamUpdate(messageId, {
        text: finalText,
        status: 'delivered',
        streamPhase: STREAM_PHASES.COMPLETED,
        componentHints: undefined,
        ...components,
        timestamp: now,
      });
    } else if (!hasComponents && finalText.length === 0) {
      // Never emitted and nothing to show: skip MESSAGE_UPDATED (consumers
      // never received MESSAGE_PROCESSED for this id) and just clean up.
    } else if (contentIsLeakedJson && !hasComponents) {
      this._cleanupStream(messageId);
      this._rememberCompletedStreamId(messageId);
      return;
    } else {
      const message = {
        ...this._createDeliveredTextMessage(
          messageId,
          finalText,
          streamData?.timestamp || now,
        ),
        streamPhase: STREAM_PHASES.COMPLETED,
        ...components,
      };
      this.queue.push(message);
      this._processQueue();
    }

    this._cleanupStream(messageId);
    this._rememberCompletedStreamId(messageId);
    this._rememberIncomingText(finalText);
  }

  /**
   * Records a finalized stream id in a bounded set so late component or hint
   * frames arriving after stream_end/disconnect never reopen a bubble.
   * @private
   * @param {string} streamId
   */
  _rememberCompletedStreamId(streamId) {
    this.completedStreamIds.add(streamId);
    if (this.completedStreamIds.size > MAX_COMPLETED_STREAM_IDS) {
      const oldest = this.completedStreamIds.values().next().value;
      this.completedStreamIds.delete(oldest);
    }
  }

  /**
   * Cleans up stream resources after completion
   * @private
   * @param {string} messageId
   */
  _cleanupStream(messageId) {
    this.streams.delete(messageId);

    if (this.activeStreamId === messageId) {
      this._resetStreamState();
    }
  }

  /**
   * Extracts messageId from various raw message structures
   * @private
   * @param {Object} raw
   * @returns {string|null} Prefixed message ID or null if not found
   */
  _getMessageIdFromRaw(raw) {
    const id = raw?.message?.messageId || raw?.id;
    return id ? MESSAGE_ID_PREFIX + id : null;
  }

  /**
   * Gets message type from raw message
   * @private
   * @param {Object} raw
   * @returns {string}
   */
  _getMessageType(raw) {
    // Push envelope: type "message" wraps inner content type (file, image, text, …)
    if (raw.type === 'message' && raw.message?.type) {
      return raw.message.type;
    }

    if (raw.type) {
      return raw.type;
    }

    if (raw.message) {
      if (raw.message.type) {
        return raw.message.type;
      }

      if (raw.message.text) {
        return 'text';
      }

      if (raw.message.media) {
        return 'media';
      }
    }

    return 'text';
  }

  /**
   * Validates message structure
   * @private
   * @param {Object} message
   * @returns {boolean}
   */
  _validateMessage(message) {
    if (!message || typeof message !== 'object') {
      return false;
    }

    if (!message.type) {
      return false;
    }

    return true;
  }

  /**
   * Processes message queue with delays
   * @private
   */
  async _processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const message = this.queue.shift();
      const streamData = message?.id ? this.streams.get(message.id) : null;
      if (streamData && streamData.queuedMessage === message) {
        streamData.queuedMessage = null;
      }

      this.emit(SERVICE_EVENTS.MESSAGE_PROCESSED, message);

      // Delay between messages
      if (this.queue.length > 0) {
        await this._delay(this.config.messageDelay);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Shows rationale text on the thinking indicator.
   * Starts thinking (or keeps it on) and resets the typing timeout.
   * @param {string} text Trimmed rationale text
   */
  showThinkingText(text) {
    this._handleTypingIndicator({ from: 'ai-assistant' });
    this.emit(SERVICE_EVENTS.THINKING_TEXT_CHANGED, text);
  }

  /**
   * Applies a rationale payload as thinking text.
   * A rationale is never queued or emitted as a chat message.
   * @private
   * @param {Object} raw
   */
  _processRationale(raw) {
    if (!this.config.enableTypingIndicator) {
      return;
    }

    const rawText = raw?.message?.text;
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) {
      return;
    }

    const answerAlreadyStreaming =
      this.streamMessageEmitted ||
      (this.activeStreamId && this.nextExpectedSeq > STREAM_INITIAL_SEQUENCE);
    if (answerAlreadyStreaming) {
      return;
    }

    const arrivedAfterAnswer = !this.isAwaitingReply && !this.isThinkingActive;
    if (arrivedAfterAnswer) {
      return;
    }

    this.showThinkingText(text);
  }

  /**
   * Handles typing indicator from server
   * Distinguishes between AI thinking and human typing
   * Allows typing indicator if stream started but no deltas received yet
   * Does not display typing indicator if streaming has received deltas
   * @private
   * @param {Object} rawMessage
   */
  _handleTypingIndicator(rawMessage) {
    if (!this.config.enableTypingIndicator) {
      return;
    }

    // Do not display typing indicator if streaming bubble is already visible
    if (
      this.streamMessageEmitted ||
      (this.activeStreamId && this.nextExpectedSeq > STREAM_INITIAL_SEQUENCE)
    ) {
      return;
    }

    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }

    const isAiAssistant = rawMessage.from === 'ai-assistant';

    if (isAiAssistant) {
      this.isThinkingActive = true;
      this.emit(SERVICE_EVENTS.THINKING_START);
    } else {
      this.isTypingActive = true;
      this.emit(SERVICE_EVENTS.TYPING_START);
    }

    this.typingTimer = setTimeout(() => {
      this._stopTyping();
    }, this.config.typingTimeout);
  }

  /**
   * Starts the typing indicator after TYPING_DELAY
   * Called when a message is sent by the user
   * @public
   */
  startTypingOnMessageSent() {
    this.isAwaitingReply = true;

    if (!this.config.enableTypingIndicator) {
      return;
    }

    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
    }

    this.typingTimer = setTimeout(() => {
      if (!this.isTypingActive && !this.isThinkingActive) {
        this.isTypingActive = true;
        this.emit(SERVICE_EVENTS.TYPING_START);
      }
    }, this.config.typingDelay);
  }

  /**
   * Stops the typing indicator
   * @private
   */
  _stopTyping() {
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }

    if (this.isTypingActive) {
      this.isTypingActive = false;
      this.emit(SERVICE_EVENTS.TYPING_STOP);
    }

    if (this.isThinkingActive) {
      this.isThinkingActive = false;
      this.emit(SERVICE_EVENTS.THINKING_STOP);
    }
  }

  /**
   * Helper delay function
   * @private
   * @param {number} ms
   * @returns {Promise}
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Checks if text matches any of the last 5 finalized incoming texts
   * @private
   * @param {string} text
   * @returns {boolean}
   */
  _isDuplicateIncomingText(text) {
    if (!text) return false;
    return this.recentIncomingTexts.includes(text);
  }

  /**
   * Stores a finalized incoming text, keeping only the last 5
   * @private
   * @param {string} text
   */
  _rememberIncomingText(text) {
    if (typeof text !== 'string' || text.length === 0) return;
    this.recentIncomingTexts.push(text);
    if (this.recentIncomingTexts.length > 5) {
      this.recentIncomingTexts.splice(0, this.recentIncomingTexts.length - 5);
    }
  }
}
