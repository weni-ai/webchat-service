import EventEmitter from 'eventemitter3';

import { generateMessageId } from '../utils/helpers';
import {
  DEFAULTS,
  SERVICE_EVENTS,
  MESSAGE_ID_PREFIX,
  STREAM_INITIAL_SEQUENCE,
} from '../utils/constants';

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
    this.streams = new Map();
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
  }

  /**
   * Processes a received WebSocket message
   * Routes to appropriate handler based on message type
   * @param {Object} rawMessage Raw WebSocket message
   */
  process(rawMessage) {
    try {
      const messageType = this._extractMessageType(rawMessage);

      switch (messageType) {
        case 'message':
          this._processUserMessage(rawMessage);
          break;
        case 'stream_start':
          this._processStreamStart(rawMessage);
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
      message.text = raw.message.text;
    }

    if (raw.message && raw.message.media) {
      message.media = raw.message.media;
    }

    if (raw.message && raw.message.quick_replies) {
      message.quick_replies = raw.message.quick_replies;
    }

    if (raw.message?.list_message?.list_items?.length >= 1) {
      message.list_message = raw.message.list_message;
    }

    const CTAMessage = raw.message?.cta_message;

    if (CTAMessage?.url && CTAMessage?.display_text) {
      message.cta_message = CTAMessage;
    }

    if (raw.metadata) {
      message.metadata = raw.metadata;
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

    this._resetStreamState(messageId);
    this.streams.set(messageId, { text: '', timestamp: Date.now() });
  }

  /**
   * Processes a delta message
   * Handles sequence-based buffering and reordering
   * @private
   * @param {Object} raw - { v: string, seq: number }
   */
  _processDelta(raw) {
    const seq = raw.seq;
    const content = raw.v || '';

    if (!this._isValidSequenceNumber(seq)) {
      return;
    }

    // Create synthetic stream if delta arrives without stream_start
    if (!this.activeStreamId) {
      this._initializeSyntheticStream(raw);
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
   * Creates a synthetic stream when delta arrives without stream_start
   * This handles edge cases where stream_start message is lost
   * @private
   * @param {Object} raw
   */
  _initializeSyntheticStream(raw) {
    const messageId = this._getMessageIdFromRaw(raw);
    this._resetStreamState(messageId);
    this.streamMessageEmitted = true;

    const timestamp = Date.now();
    this.streams.set(messageId, { text: '', timestamp });

    const message = this._createStreamingMessage(messageId, timestamp);
    this.queue.push(message);
    this._processQueue();
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
    const mergedText = current.text + content;
    this.streams.set(streamId, { text: mergedText, timestamp });

    this.emit(SERVICE_EVENTS.MESSAGE_UPDATED, streamId, {
      text: mergedText,
      status: 'streaming',
      timestamp,
    });
  }

  /**
   * Processes a stream_end message
   * Finalizes the stream and cleans up state
   * @private
   * @param {Object} raw - { type: 'stream_end', id: string }
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

    if (this.isTypingActive || this.isThinkingActive) {
      this._stopTyping();
    }

    const streamData = this.streams.get(messageId);
    const finalText = streamData?.text || '';

    this.emit(SERVICE_EVENTS.MESSAGE_UPDATED, messageId, {
      text: finalText,
      status: 'delivered',
      timestamp: Date.now(),
    });

    this._cleanupStream(messageId);
    this._rememberIncomingText(finalText);
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

      this.emit(SERVICE_EVENTS.MESSAGE_PROCESSED, message);

      // Delay between messages
      if (this.queue.length > 0) {
        await this._delay(this.config.messageDelay);
      }
    }

    this.isProcessing = false;
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

    // Do not display typing indicator if streaming has already received deltas
    if (this.activeStreamId && this.nextExpectedSeq > STREAM_INITIAL_SEQUENCE) {
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
