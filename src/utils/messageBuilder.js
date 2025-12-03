/**
 * Message builder utility functions
 */

import { generateMessageId } from './helpers'

export function buildMessagePayload(sessionId, message, options = {}) {
  const from = sessionId;
  const context = options.context || '';

  if (message.type === 'text') {
    return buildWebSocketMessage('message',
      { type: 'text', text: message.text },
      {
        context,
        from,
      }
    )
  } else if (['image','video','audio','file'].includes(message.type)) {
    return buildWebSocketMessage('message',
      { type: message.type, media: message.media },
      {
        context,
        from,
      }
    )
  } else if (message.type === 'set_custom_field') {
    return {
      type: message.type,
      data: message.data,
    };
  }

  throw new Error('Invalid message type')
}

/**
 * Builds a text message
 * @param {string} text
 * @param {Object} options
 * @returns {Object}
 */
export function buildTextMessage(text, options = {}) {
  return {
    id: options.id || generateMessageId(),
    type: 'text',
    text,
    timestamp: options.timestamp || Date.now(),
    direction: options.direction || 'outgoing',
    status: options.status || 'pending',
    metadata: options.metadata || {},
    hidden: options.hidden || false,
  }
}

/**
 * Builds a custom field message
 * @param {string} field
 * @param {string} value
 * @param {Object} options
 * @returns {Object}
 */
export function buildCustomFieldMessage(field, value) {
  return {
    type: 'set_custom_field',
    data: {
      key: field,
      value,
    },
    status: 'pending',
  }
}

/**
 * Builds a media message (image, video, audio)
 * @param {string} type
 * @param {string} media
 * @param {Object} options
 * @returns {Object}
 */
export function buildMediaMessage(type, media, options = {}) {
  return {
    id: options.id || generateMessageId(),
    type,
    media,
    text: options.caption || '',
    timestamp: options.timestamp || Date.now(),
    direction: options.direction || 'outgoing',
    status: options.status || 'pending',
    metadata: options.metadata || {}
  }
}

/**
 * Builds a file message
 * @param {string} media
 * @param {Object} options
 * @returns {Object}
 */
export function buildFileMessage(media, options = {}) {
  return {
    id: options.id || generateMessageId(),
    type: 'file',
    media,
    text: options.filename || 'file',
    timestamp: options.timestamp || Date.now(),
    direction: options.direction || 'outgoing',
    status: options.status || 'pending',
    metadata: {
      filename: options.filename,
      size: options.size,
      mimeType: options.mimeType,
      ...options.metadata
    }
  }
}

/**
 * Builds a location message
 * @param {number} latitude
 * @param {number} longitude
 * @param {Object} options
 * @returns {Object}
 */
export function buildLocationMessage(latitude, longitude, options = {}) {
  return {
    id: options.id || generateMessageId(),
    type: 'location',
    timestamp: options.timestamp || Date.now(),
    direction: options.direction || 'outgoing',
    status: options.status || 'pending',
    metadata: {
      latitude,
      longitude,
      address: options.address,
      ...options.metadata
    }
  }
}

/**
 * Builds a quick reply message
 * @param {string} text
 * @param {Array} quickReplies
 * @param {Object} options
 * @returns {Object}
 */
export function buildQuickReplyMessage(text, quickReplies, options = {}) {
  return {
    id: options.id || generateMessageId(),
    type: 'text',
    text,
    quick_replies: quickReplies,
    timestamp: options.timestamp || Date.now(),
    direction: options.direction || 'incoming',
    status: options.status || 'delivered',
    metadata: options.metadata || {}
  }
}

/**
 * Builds a WebSocket message payload
 * @param {string} type
 * @param {Object} message
 * @param {Object} options
 * @returns {Object}
 */
export function buildWebSocketMessage(type, message, options = {}) {
  return {
    type,
    message,
    context: options.context || '',
    from: options.from,
    session_type: options.session_type,
    callback: options.callback,
    token: options.token,
    trigger: options.trigger,
  }
}

/**
 * Builds a registration message
 * @param {string} sessionId
 * @param {Object} options
 * @returns {Object}
 */
export function buildRegistrationMessage(sessionId, options = {}) {
  return {
    type: 'register',
    from: sessionId,
    callback: options.callback || '',
    session_type: options.session_type || 'local',
    token: options.token
  }
}

/**
 * Builds a history request message
 * @param {Object} options
 * @returns {Object}
 */
export function buildHistoryRequest(options = {}) {
  return {
    type: 'get_history',
    limit: options.limit || 20,
    page: options.page || 1,
    before: options.before,
    after: options.after
  }
}

/**
 * Builds a typing indicator message
 * @param {boolean} isTyping
 * @returns {Object}
 */
export function buildTypingMessage(isTyping) {
  return {
    type: 'typing',
    isTyping
  }
}
