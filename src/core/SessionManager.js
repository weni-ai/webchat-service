import { generateSessionId } from '../utils/helpers'

/**
 * SessionManager
 * 
 * Manages user sessions with features:
 * - Generate unique session IDs in format: timestamp@hostname
 * - Persist sessions in localStorage/sessionStorage
 * - Restore existing sessions
 * - Clear sessions
 * - Auto-clear cache after timeout
 * - Contact timeout management
 */
export default class SessionManager {
  constructor(storage, config = {}) {
    this.storage = storage
    this.config = {
      autoClearCache: config.autoClearCache !== false,
      cacheTimeout: config.cacheTimeout || 30 * 60 * 1000, // 30 minutes
      contactTimeout: config.contactTimeout || 24 * 60 * 60 * 1000, // 24 hours
      clientId: config.clientId || null,
      sessionId: config.sessionId || null,
    }
    
    this.sessionKey = 'weni:webchat:session'
    this.session = null
    this.clearTimer = null
  }

  /**
   * Gets existing session or creates a new one
   * @returns {string} Session ID
   */
  getOrCreate() {
    if (this.session && this.session.id) {
      return this.session.id
    }

    const stored = this.storage.get(this.sessionKey)
    
    if (stored && this._isSessionValid(stored)) {
      this.session = stored
      this._updateLastActivity()
      return this.session.id
    }

    return this._createNewSession()
  }

  /**
   * Restores session from storage
   * @returns {Promise<Object|null>}
   */
  async restore() {
    const stored = this.storage.get(this.sessionKey)

    if (stored && this._isSessionValid(stored)) {
      this.session = stored
      this._updateLastActivity()
      this._startAutoClearTimer()
      return this.session
    }

    return null
  }

  /**
   * Gets current session
   * @returns {Object|null}
   */
  getSession() {
    return this.session
  }

  /**
   * Gets session ID
   * @returns {string|null}
   */
  getSessionId() {
    return this.session ? this.session.id : null
  }

  /**
   * Updates session metadata
   * @param {Object} metadata
   */
  updateMetadata(metadata = {}) {
    if (!this.session) {
      return
    }

    this.session.metadata = {
      ...this.session.metadata,
      ...metadata
    }

    this._updateLastActivity()
    this._save()
  }

  /**
   * Clears current session
   */
  clear() {
    this.session = null
    this.storage.remove(this.sessionKey)
    this._stopAutoClearTimer()
  }

  /**
   * Creates a new session
   * @private
   * @returns {string} Session ID
   */
  _createNewSession() {
    const now = Date.now()

    const id = this.config.sessionId || generateSessionId(this.config.clientId);

    this.session = {
      id,
      createdAt: now,
      lastActivity: now,
      metadata: {},
      conversation: [],
    }

    this._save()
    this._startAutoClearTimer()
    
    return this.session.id
  }

  /**
   * Checks if session is still valid
   * @private
   * @param {Object} session
   * @returns {boolean}
   */
  _isSessionValid(session) {
    if (!session || !session.id || !session.lastActivity) {
      return false
    }

    if (!this._isValidSessionIdFormat(session.id)) {
      return false
    }

    const now = Date.now()
    const elapsed = now - session.lastActivity

    return elapsed < this.config.contactTimeout
  }

  /**
   * Checks if session ID has the correct format: timestamp@hostname
   * @private
   * @param {string} sessionId
   * @returns {boolean}
   */
  _isValidSessionIdFormat(sessionId) {
    // Valid format: {number}@{string}
    // Example: 1544648616824@localhost
    const pattern = /^\d+@.+$/
    return pattern.test(sessionId)
  }

  /**
   * Updates last activity timestamp
   * @private
   */
  _updateLastActivity() {
    if (!this.session) {
      return
    }

    this.session.lastActivity = Date.now()
    this._save()
  }

  /**
   * Returns the conversation array from session
   * @returns {Array}
   */
  getConversation() {
    if (!this.session) return []
    if (!Array.isArray(this.session.conversation)) {
      this.session.conversation = []
    }
    return this.session.conversation
  }

  /**
   * Sets the entire conversation array and persists
   * @param {Array} messages
   */
  setConversation(messages) {
    if (!this.session) return
    this.session.conversation = Array.isArray(messages) ? messages : []
    this._updateLastActivity()
    this._save()
  }

  /**
   * Appends one message to the conversation and persists
   * @param {any} message
   * @param {{ limit?: number }} [options]
   */
  appendToConversation(message, options = {}) {
    if (!this.session) return
    const limit = typeof options.limit === 'number' ? options.limit : undefined
    const list = this.getConversation()
    list.push(message)
    if (limit && limit > 0 && list.length > limit) {
      list.splice(0, list.length - limit)
    }
    this.session.conversation = list
    this._updateLastActivity()
    this._save()
  }

  /**
   * Saves session to storage
   * @private
   */
  _save() {
    if (!this.session) {
      return
    }

    this.storage.set(this.sessionKey, this.session)
  }

  /**
   * Starts auto-clear timer
   * @private
   */
  _startAutoClearTimer() {
    if (!this.config.autoClearCache) {
      return
    }

    this._stopAutoClearTimer()

    this.clearTimer = setTimeout(() => {
      this.clear()
    }, this.config.cacheTimeout)
  }

  /**
   * Stops auto-clear timer
   * @private
   */
  _stopAutoClearTimer() {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer)
      this.clearTimer = null
    }
  }
}


