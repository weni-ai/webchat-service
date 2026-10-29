/**
 * Message builder utility functions
 */

import { generateMessageId } from './helpers';

export function isOfficialHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Oldest outgoing message still showing a blob preview for this ack type.
 * `document` matches a local `file` message. Other types match exactly.
 * @param {Array} messages
 * @param {string} type
 * @returns {Object|null}
 */
export function findPendingMediaPreview(messages, type) {
  const wanted = type === 'document' ? 'file' : type;
  if (!Array.isArray(messages) || !wanted) {
    return null;
  }

  return (
    messages.find(
      (message) =>
        message &&
        message.direction === 'outgoing' &&
        message.type === wanted &&
        typeof message.media === 'string' &&
        message.media.startsWith('blob:'),
    ) || null
  );
}

/**
 * Builds a Blob from a data URL or a raw string so the preview can be an
 * object URL. The data URL itself is not kept on the chat message.
 * @param {string} value
 * @returns {Blob}
 */
export function blobFromEncodedMedia(value) {
  if (typeof value !== 'string') {
    return new Blob([]);
  }

  const comma = value.indexOf(',');
  if (!value.startsWith('data:') || comma === -1) {
    return new Blob([value]);
  }

  const meta = value.slice('data:'.length, comma);
  const body = value.slice(comma + 1);
  const mime = meta.split(';')[0] || 'application/octet-stream';

  if (!meta.includes('base64') || typeof atob !== 'function') {
    return new Blob([body], { type: mime });
  }

  try {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return new Blob([value], { type: mime });
  }
}

export function buildMessagePayload(sessionId, message, options = {}) {
  const outbound =
    typeof options.uploadMedia === 'string'
      ? { ...message, media: options.uploadMedia }
      : message;
  const from = sessionId;
  const context = options.context || '';

  const hasCustomFields =
    outbound &&
    typeof outbound.__customFields === 'object' &&
    outbound.__customFields !== null &&
    Object.keys(outbound.__customFields).length > 0;

  const messageType = hasCustomFields ? 'message_with_fields' : 'message';
  const messageData = hasCustomFields ? outbound.__customFields : undefined;

  if (outbound.type === 'text') {
    const textPayload = { type: 'text', text: outbound.text };
    if (outbound.fromConversationStarter) {
      textPayload.from_conversation_starter = true;
    }

    return buildWebSocketMessage(messageType, textPayload, {
      context,
      from,
      data: messageData,
    });
  } else if (['image', 'video', 'audio', 'file'].includes(outbound.type)) {
    return buildWebSocketMessage(
      messageType,
      { type: outbound.type, media: outbound.media },
      {
        context,
        from,
        data: messageData,
      },
    );
  } else if (outbound.type === 'order') {
    return buildWebSocketMessage(
      messageType,
      { type: 'order', timestamp: outbound.timestamp, order: outbound.order },
      {
        context,
        from,
        data: messageData,
      },
    );
  } else if (outbound.type === 'set_custom_field') {
    return {
      type: outbound.type,
      data: outbound.data,
    };
  }

  throw new Error('Invalid message type');
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
    fromConversationStarter: Boolean(options.fromConversationStarter),
  };
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
  };
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
    metadata: options.metadata || {},
  };
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
      ...options.metadata,
    },
  };
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
      ...options.metadata,
    },
  };
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
    metadata: options.metadata || {},
  };
}

/**
 * Builds an order message
 * @param {Array} productItems Array of product items with product_retailer_id, name, price, etc.
 * @param {Object} options
 * @returns {Object}
 */
export function buildOrderMessage(productItems, options = {}) {
  return {
    id: options.id || generateMessageId(),
    type: 'order',
    timestamp: (options.timestamp || Date.now()).toString(),
    direction: options.direction || 'outgoing',
    status: options.status || 'pending',
    order: {
      product_items: productItems,
    },
  };
}

/**
 * Builds a local-only conversation status row (not sent over WebSocket).
 * Host UIs should render using message.type and statusType (e.g. success, info).
 * Sets persisted so the row survives history merge after WebSocket connect.
 *
 * @param {string} text
 * @param {string} statusType Semantic category defined by the host (success, info, …)
 * @param {Object} [options]
 * @returns {Object}
 */
export function buildConversationStatusMessage(text, statusType, options = {}) {
  return {
    id: options.id || generateMessageId(),
    type: 'conversation_status',
    text,
    statusType,
    timestamp: options.timestamp || Date.now(),
    direction: options.direction || 'incoming',
    persisted: true,
    metadata: options.metadata || {},
  };
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
    data: options.data,
  };
}

/**
 * Builds a get_pdp_starters request payload.
 * @param {string} sessionId
 * @param {Object} productData - Must contain account, linkText. May contain productName, description, brand, attributes.
 * @returns {Object}
 */
export function buildStartersRequest(sessionId, productData) {
  const data = {
    account: productData.account,
    linkText: productData.linkText,
  };

  if (productData.productPath) data.productPath = productData.productPath;
  if (productData.productName) data.productName = productData.productName;
  if (productData.description) data.description = productData.description;
  if (productData.brand) data.brand = productData.brand;
  if (productData.attributes) data.attributes = productData.attributes;

  return {
    type: 'get_pdp_starters',
    from: sessionId,
    data,
  };
}

/**
 * Builds a registration message
 * @param {string} sessionId
 * @param {Object} options
 * @returns {Object}
 */
export function buildRegistrationMessage(sessionId, options = {}) {
  const message = {
    type: 'register',
    from: sessionId,
    callback: options.callback || '',
    session_type: options.session_type || 'local',
    token: options.token,
  };

  if (options.data) {
    message.data = options.data;
  }

  return message;
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
    after: options.after,
  };
}

/**
 * Builds a typing indicator message
 * @param {boolean} isTyping
 * @returns {Object}
 */
export function buildTypingMessage(isTyping) {
  return {
    type: 'typing',
    isTyping,
  };
}
