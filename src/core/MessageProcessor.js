import EventEmitter from 'eventemitter3'

import { generateMessageId } from '../utils/helpers'
import { DEFAULTS, SERVICE_EVENTS } from '../utils/constants'

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
    super()
    
    this.config = {
      messageDelay: config.messageDelay || DEFAULTS.MESSAGE_DELAY,
      typingDelay: config.typingDelay || DEFAULTS.TYPING_DELAY,
      enableTypingIndicator: config.enableTypingIndicator !== false || DEFAULTS.ENABLE_TYPING_INDICATOR,
      ...config
    }

    this.queue = []
    this.isProcessing = false
    this.typingTimer = null
  }

  /**
   * Processes a received message
   * @param {Object} rawMessage
   */
  process(rawMessage) {
    try {
      const message = this._normalizeMessage(rawMessage)
      
      if (!this._validateMessage(message)) {
        this.emit(SERVICE_EVENTS.ERROR, new Error('Invalid message format'))
        return
      }

      if (message.type === 'typing') {
        this._handleTypingIndicator(message)
        return
      }

      this.queue.push(message)
      this._processQueue()

    } catch (error) {
      this.emit(SERVICE_EVENTS.ERROR, error)
    }
  }

  /**
   * Processes multiple messages (batch)
   * @param {Array} messages
   */
  processBatch(messages = []) {
    messages.forEach(msg => this.process(msg))
  }

  /**
   * Clears the message queue
   */
  clearQueue() {
    this.queue = []
    this.isProcessing = false
  }

  /**
   * Normalizes message to standard format
   * @private
   * @param {Object} raw Raw message
   * @returns {Object} Normalized message
   */
  _normalizeMessage(raw) {
    const message = {
      id: raw.id || generateMessageId(),
      type: this._getMessageType(raw),
      timestamp: raw.timestamp || Date.now(),
      direction: 'incoming',
      status: 'delivered'
    }

    if (raw.message && raw.message.text) {
      message.text = raw.message.text
    }

    if (raw.message && raw.message.media) {
      message.media = raw.message.media
    }

    if (raw.message && raw.message.quick_replies) {
      message.quick_replies = raw.message.quick_replies
    }

    if (raw.metadata) {
      message.metadata = raw.metadata
    }

    return message
  }

  /**
   * Gets message type from raw message
   * @private
   * @param {Object} raw
   * @returns {string}
   */
  _getMessageType(raw) {
    if (raw.type) {
      return raw.type
    }

    if (raw.message) {
      if (raw.message.type) {
        return raw.message.type
      }
      
      if (raw.message.text) {
        return 'text'
      }
      
      if (raw.message.media) {
        return 'media'
      }
    }

    return 'text'
  }

  /**
   * Validates message structure
   * @private
   * @param {Object} message
   * @returns {boolean}
   */
  _validateMessage(message) {
    if (!message || typeof message !== 'object') {
      return false
    }

    if (!message.type) {
      return false
    }

    return true
  }

  /**
   * Processes message queue with delays
   * @private
   */
  async _processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return
    }

    this.isProcessing = true

    while (this.queue.length > 0) {
      const message = this.queue.shift()

      // Show typing indicator if enabled
      if (this.config.enableTypingIndicator && message.direction === 'incoming') {
        this.emit(SERVICE_EVENTS.TYPING_START)
        await this._delay(this.config.typingDelay)
        this.emit(SERVICE_EVENTS.TYPING_STOP)
      }

      this.emit(SERVICE_EVENTS.MESSAGE_PROCESSED, message)

      // Delay between messages
      if (this.queue.length > 0) {
        await this._delay(this.config.messageDelay)
      }
    }

    this.isProcessing = false
  }

  /**
   * Handles typing indicator
   * @private
   * @param {Object} message
   */
  _handleTypingIndicator(message) {
    if (this.typingTimer) {
      clearTimeout(this.typingTimer)
    }

    if (message.isTyping) {
      this.emit(SERVICE_EVENTS.TYPING_START)

      this.typingTimer = setTimeout(() => {
        this.emit(SERVICE_EVENTS.TYPING_STOP)
      }, this.config.typingDelay)
    } else {
      this.emit(SERVICE_EVENTS.TYPING_STOP)
    }
  }

  /**
   * Helper delay function
   * @private
   * @param {number} ms
   * @returns {Promise}
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}


