import EventEmitter from 'eventemitter3';

import { generateMessageId } from '../utils/helpers';
import { DEFAULTS, SERVICE_EVENTS } from '../utils/constants';

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
        case 'delta':
          this._processStreamingDelta(rawMessage);
          break;
        case 'completed':
          this._processStreamingCompleted(rawMessage);
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
   * Processes a streaming delta chunk
   * @private
   * @param {Object} raw
   */
  _processStreamingDelta(raw) {
    const messageId = 'msg_' + this._getMessageIdFromRaw(raw);
    if (!messageId) {
      this.emit(
        SERVICE_EVENTS.ERROR,
        new Error('Delta received without messageId'),
      );
      return;
    }

    const chunkText = raw?.message?.text || '';
    const timestamp = Date.now();

    if (this.isTypingActive || this.isThinkingActive) {
      this._stopTyping();
    }

    if (!this.streams.has(messageId)) {
      const message = {
        id: messageId,
        type: 'text',
        text: chunkText || '',
        timestamp,
        direction: 'incoming',
        status: 'streaming',
        persisted: raw.persisted || undefined,
        metadata: {
          from: raw.from,
          to: raw.to,
          channelUuid: raw.channelUuid,
        },
      };

      this.streams.set(messageId, { text: message.text, timestamp });
      this.queue.push(message);
      this._processQueue();
      return;
    }

    const current = this.streams.get(messageId) || { text: '' };
    const mergedText = this._mergeText(current.text, chunkText);
    this.streams.set(messageId, { text: mergedText, timestamp });

    this.emit(SERVICE_EVENTS.MESSAGE_UPDATED, messageId, {
      text: mergedText,
      status: 'streaming',
      timestamp,
    });
  }

  /**
   * Processes a streaming completed event
   * @private
   * @param {Object} raw
   */
  _processStreamingCompleted(raw) {
    const messageId = 'msg_' + this._getMessageIdFromRaw(raw);
    if (!messageId) {
      this.emit(
        SERVICE_EVENTS.ERROR,
        new Error('Completed received without messageId'),
      );
      return;
    }

    const finalText = raw?.message?.text || '';
    const timestamp = Date.now();

    if (this.isTypingActive || this.isThinkingActive) {
      this._stopTyping();
    }

    if (!this.streams.has(messageId)) {
      const message = {
        id: messageId,
        type: 'text',
        text: finalText,
        timestamp,
        direction: 'incoming',
        status: 'delivered',
        persisted: raw.persisted || undefined,
        metadata: {
          from: raw.from,
          to: raw.to,
          channelUuid: raw.channelUuid,
        },
      };

      this.queue.push(message);
      this._processQueue();
      this._rememberIncomingText(finalText);
      return;
    }

    this.streams.delete(messageId);

    this.emit(SERVICE_EVENTS.MESSAGE_UPDATED, messageId, {
      text: finalText,
      status: 'delivered',
      timestamp,
    });
    this._rememberIncomingText(finalText);
  }

  /**
   * Extract messageId from various raw structures
   * @private
   * @param {Object} raw
   * @returns {string|undefined}
   */
  _getMessageIdFromRaw(raw) {
    return raw?.message?.messageId || raw?.id;
  }

  /**
   * Merge incremental text with best-effort overlap handling
   * @private
   * @param {string} previous
   * @param {string} incoming
   * @returns {string}
   */
  _mergeText(previous, incoming) {
    if (!previous) return incoming || '';
    if (!incoming) return previous;
    return previous + incoming;
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
   * @private
   * @param {Object} rawMessage
   */
  _handleTypingIndicator(rawMessage) {
    if (!this.config.enableTypingIndicator) {
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
