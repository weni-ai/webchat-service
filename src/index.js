import EventEmitter from 'eventemitter3'

import WebSocketManager from './core/WebSocketManager'
import SessionManager from './core/SessionManager'
import MessageProcessor from './core/MessageProcessor'
import StateManager from './core/StateManager'
import StorageManager from './core/StorageManager'

import HistoryManager from './modules/HistoryManager'
import FileHandler from './modules/FileHandler'
import CameraRecorder from './modules/CameraRecorder'
import AudioRecorder from './modules/AudioRecorder'

import RetryStrategy from './network/RetryStrategy'

import { validateConfig } from './utils/validators'
import { 
  DEFAULTS, 
  SERVICE_EVENTS,
  ALLOWED_FILE_TYPES,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_AUDIO_TYPES,
  ALLOWED_DOCUMENT_TYPES,
  MESSAGE_TYPES,
  MESSAGE_STATUS,
  MESSAGE_DIRECTIONS,
  CONNECTION_STATUS,
  STORAGE_TYPES,
  ERROR_TYPES,
  QUICK_REPLY_TYPES
} from './utils/constants'
import {
  buildTextMessage,
  buildMediaMessage,
  buildWebSocketMessage,
  buildRegistrationMessage
} from './utils/messageBuilder'

/**
 * WeniWebchatService
 * 
 * Main service class that provides a complete WebChat solution.
 * Framework-agnostic JavaScript library with event-based API.
 * 
 * Features:
 * - WebSocket connection management
 * - Session persistence
 * - Message queue and processing
 * - File and audio handling
 * - History management
 * - State management via EventEmitter
 * 
 * @example
 * const service = new WeniWebchatService({
 *   socketUrl: 'wss://websocket.weni.ai',
 *   channelUuid: 'your-uuid'
 * })
 * 
 * service.on('message:received', (message) => {
 *   console.log('New message:', message)
 * })
 * 
 * await service.init()
 * service.sendMessage('Hello!')
 */
export default class WeniWebchatService extends EventEmitter {
  constructor(config = {}) {
    super()

    validateConfig(config)

    this.config = {
      socketUrl: config.socketUrl,
      channelUuid: config.channelUuid,
      host: config.host || '',
      clientId: config.clientId || null,
      sessionToken: config.sessionToken || null,
      connectOn: config.connectOn || DEFAULTS.CONNECT_ON,
      storage: config.storage || DEFAULTS.STORAGE,
      callbackUrl: config.callbackUrl || '',
      autoReconnect: config.autoReconnect !== false,
      maxReconnectAttempts: config.maxReconnectAttempts || DEFAULTS.MAX_RECONNECT_ATTEMPTS,
      reconnectInterval: config.reconnectInterval || DEFAULTS.RECONNECT_INTERVAL,
      pingInterval: config.pingInterval || DEFAULTS.PING_INTERVAL,
      messageDelay: config.messageDelay || DEFAULTS.MESSAGE_DELAY,
      typingDelay: config.typingDelay || DEFAULTS.TYPING_DELAY,
      autoClearCache: config.autoClearCache !== false || DEFAULTS.AUTO_CLEAR_CACHE,
      cacheTimeout: config.cacheTimeout || DEFAULTS.CACHE_TIMEOUT,
      ...config
    }

    // Initialize retry strategy for WebSocket reconnection
    this.retryStrategy = new RetryStrategy({
      baseDelay: this.config.reconnectInterval || DEFAULTS.RECONNECT_INTERVAL,
      maxDelay: 30000, // 30 seconds max
      factor: 2,
      jitter: true,
      maxJitter: 1000
    })

    // Initialize core modules
    this.storage = new StorageManager(this.config.storage)
    this.state = new StateManager()
    this.session = new SessionManager(this.storage, this.config)
    this.websocket = new WebSocketManager({
      ...this.config,
      retryStrategy: this.retryStrategy
    })
    this.messageProcessor = new MessageProcessor(this.config)

    // Initialize feature modules
    this.history = new HistoryManager(this.websocket)
    this.fileHandler = new FileHandler(this.config)
    this.audioRecorder = new AudioRecorder(this.config)
    this.cameraRecorder = new CameraRecorder(this.config)

    this._setupEventListeners()

    this._initialized = false
    this._connected = false
  }

  /**
   * Initializes the service
   * Restores session and optionally auto-connects
   * 
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized) {
      return
    }

    try {
      // Restore session from storage
      const session = await this.session.restore()

      if (session) {
        this.state.setSession(session)
        this.emit(SERVICE_EVENTS.SESSION_RESTORED, session)
      }

      if (this.config.connectOn === 'mount') {
        await this.connect()
      }

      this._initialized = true
      this.emit(SERVICE_EVENTS.INITIALIZED)

    } catch (error) {
      this.state.setError(error)
      this.emit(SERVICE_EVENTS.ERROR, error)
      throw error
    }
  }

  /**
   * Connects to WebSocket server
   * 
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._connected || this._connecting) {
      return
    }

    this._connecting = true

    try {
      const sessionId = this.session.getOrCreate()
      this.state.setSession(this.session.getSession())

      await this.websocket.connect({
        from: sessionId,
        callback: this.config.callbackUrl,
        session_type: this.config.storage
      });

      const previousLocalMessagesIds = this.session
        .getConversation()
        .map(message => message.id)
        .filter(id => id.startsWith('msg_'));

      this.getHistory({
        page: 1,
        limit: 20,
      }).then(() => {
        if (previousLocalMessagesIds.length > 0) {
          const idsToRemove = new Set(previousLocalMessagesIds);
          const filtered = this.state.getMessages().filter(m => !idsToRemove.has(m?.id));
          this.state.setState({ messages: filtered });
          this.session.setConversation(filtered);
        }
      });

      this._connected = true
      this.emit(SERVICE_EVENTS.CONNECTED)
    } catch (error) {
      this.state.setError(error)
      this.emit(SERVICE_EVENTS.ERROR, error)
      throw error
    } finally {
      this._connecting = false
    }
  }

  /**
   * Disconnects from WebSocket server
   */
  disconnect() {
    this.websocket.disconnect()
    this._connected = false
  }

  /**
   * Sends a text message
   * 
   * @param {string} text Message text
   * @param {Object} options Additional options
   * @returns {Promise<void>}
   */
  async sendMessage(text, options = {}) {
    if (!text || typeof text !== 'string') {
      throw new Error('Message text is required')
    }

    const message = buildTextMessage(text, {
      ...options,
      direction: 'outgoing'
    })

    // Add to state
    this.state.addMessage(message)
    this.session.appendToConversation(message)

    // Build WebSocket payload
    const payload = buildWebSocketMessage('message',
      { type: 'text', text },
      {
        context: this.state.getContext(),
        from: this.session.getSessionId()
      }
    )

    try {
      await this.websocket.send(payload)

      this.messageProcessor.startTypingOnMessageSent()

      this.state.updateMessage(message.id, { status: 'sent' })
      this.emit(SERVICE_EVENTS.MESSAGE_SENT, message)

    } catch (error) {
      this.state.updateMessage(message.id, { status: 'error' })
      this.emit(SERVICE_EVENTS.ERROR, error)
      throw error
    }
  }

  /**
   * Simulates a message received
   * 
   * @param {Object} message Message object
   * @returns {void}
   */
  simulateMessageReceived(message) {
    this.messageProcessor.process(message);
  }

  /**
   * Sends a file attachment
   * 
   * @param {File} file File object
   * @returns {Promise<void>}
   */
  async sendAttachment(file) {
    if (!file) {
      throw new Error('File is required')
    }

    try {
      const fileData = await this.fileHandler.process(file)

      const message = buildMediaMessage(fileData.type, fileData.base64, {
        direction: 'outgoing',
        metadata: {
          filename: fileData.filename,
          size: fileData.size,
          mimeType: fileData.mimeType
        }
      })

      this.state.addMessage(message)
      this.session.appendToConversation(message)

      const payload = buildWebSocketMessage('message',
        { type: fileData.type, media: fileData.base64 },
        {
          context: this.state.getContext(),
          from: this.session.getSessionId()
        }
      )

      await this.websocket.send(payload)

      this.messageProcessor.startTypingOnMessageSent()

      this.state.updateMessage(message.id, { status: 'sent' })
      this.emit(SERVICE_EVENTS.MESSAGE_SENT, message)

    } catch (error) {
      this.emit(SERVICE_EVENTS.ERROR, error)
      throw error
    }
  }

  /**
   * Sends an audio recording
   * 
   * @param {Object} audioData Audio data from recorder
   * @returns {Promise<void>}
   */
  async sendAudio(audioData) {
    if (!audioData || !audioData.base64) {
      throw new Error('Audio data is required')
    }

    try {
      const message = buildMediaMessage('audio', audioData.base64, {
        direction: 'outgoing',
        metadata: {
          duration: audioData.duration,
          mimeType: audioData.mimeType
        }
      })

      this.state.addMessage(message)
      this.session.appendToConversation(message)

      const payload = buildWebSocketMessage('message',
        { type: 'audio', media: audioData.base64 },
        {
          context: this.state.getContext(),
          from: this.session.getSessionId()
        }
      )

      await this.websocket.send(payload)

      this.messageProcessor.startTypingOnMessageSent()

      this.state.updateMessage(message.id, { status: 'sent' })
      this.emit(SERVICE_EVENTS.MESSAGE_SENT, message)

    } catch (error) {
      this.emit(SERVICE_EVENTS.ERROR, error)
      throw error
    }
  }

  /**
   * Gets message history from server
   * 
   * @param {Object} options History options
   * @returns {Promise<Array>}
   */
  async getHistory(options = {}) {
    try {
      const messages = await this.history.request(options)

      const currentMessages = this.state.getMessages()
      const merged = this.history.merge(messages, currentMessages)

      this.state.setState({ messages: merged })
      this.session.setConversation(merged)

      return messages
    } catch (error) {
      this.emit(SERVICE_EVENTS.ERROR, error)
      throw error
    }
  }

  /**
   * Sets context for messages
   * 
   * @param {string} context Context string
   */
  setContext(context) {
    this.state.setContext(context)
    this.emit(SERVICE_EVENTS.CONTEXT_CHANGED, context)
  }

  /**
   * Gets current context
   * 
   * @returns {string}
   */
  getContext() {
    return this.state.getContext()
  }

  /**
   * Gets current state
   * 
   * @returns {Object}
   */
  getState() {
    return this.state.getState()
  }

  /**
   * Gets all messages
   * 
   * @returns {Array}
   */
  getMessages() {
    return this.state.getMessages()
  }

  /**
   * Gets session ID
   * 
   * @returns {string|null}
   */
  getSessionId() {
    return this.session.getSessionId()
  }

  /**
   * Clears session and messages
   */
  clearSession() {
    this.session.clear()
    this.state.reset()
    this.emit(SERVICE_EVENTS.SESSION_CLEARED)
  }

  /**
   * Starts camera recording
   * 
   * @returns {Promise<void>}
   */
  async startCameraRecording() {
    return this.cameraRecorder.start();
  }

  /**
   * Stops camera recording
   * 
   * @returns {Promise<void>}
   */
  async stopCameraRecording() {
    return this.cameraRecorder.stop();
  }

  /**
   * Checks if camera permission is already granted
   * @returns {Promise<boolean|undefined>}
   */
  async hasCameraPermission() {
    return await this.cameraRecorder.hasPermission()
  }

  /**
   * Requests camera permission and returns the permission state
   * @returns {Promise<boolean|undefined>}
   * @throws {Error} If permission is denied or not supported
   */
  async requestCameraPermission() {
    return await this.cameraRecorder.requestPermission()
  }

  /**
   * Switches to the next camera device
   * @returns {Promise<void>}
   */
  async switchToNextCameraDevice() {
    return await this.cameraRecorder.switchToNextDevice();
  }

  /**
   * Starts audio recording
   * 
   * @returns {Promise<void>}
   */
  async startRecording() {
    return this.audioRecorder.start()
  }

  /**
   * Stops audio recording and sends it
   * 
   * @returns {Promise<void>}
   */
  async stopRecording() {
    const audioData = await this.audioRecorder.stop();
    await this.sendAudio(audioData)
  }

  /**
   * Cancels audio recording
   */
  cancelRecording() {
    this.audioRecorder.cancel()
  }

  /**
   * Checks if microphone permission is already granted
   * @returns {Promise<boolean|undefined>}
   */
  async hasAudioPermission() {
    return await this.audioRecorder.hasPermission()
  }

  /**
   * Requests microphone permission and returns the permission state
   * @returns {Promise<boolean|undefined>}
   * @throws {Error} If permission is denied or not supported
   */
  async requestAudioPermission() {
    return await this.audioRecorder.requestPermission()
  }

  /**
   * Gets connection status
   * 
   * @returns {string}
   */
  getConnectionStatus() {
    return this.websocket.getStatus()
  }

  /**
   * Checks if service is connected
   * 
   * @returns {boolean}
   */
  isConnected() {
    return this._connected && this.websocket.getStatus() === 'connected'
  }

  /**
   * Gets retry strategy information
   * 
   * @returns {Object} Retry strategy stats
   */
  getRetryInfo() {
    return {
      attempts: this.retryStrategy.getAttempts(),
      nextDelay: this.retryStrategy.getDelay(),
      maxAttempts: this.config.maxReconnectAttempts
    }
  }

  /**
   * Gets allowed file types configuration
   * Useful for setting the accept attribute on file inputs
   * 
   * @returns {Array<string>} Array of allowed MIME types
   */
  getAllowedFileTypes() {
    return this.fileHandler.config.allowedTypes
  }

  /**
   * Gets file configuration including size limits
   * 
   * @returns {Object} File configuration
   */
  getFileConfig() {
    return {
      allowedTypes: this.getAllowedFileTypes(),
      maxFileSize: this.fileHandler.config.maxFileSize,
      acceptAttribute: this.getAllowedFileTypes().join(',')
    }
  }

  /**
   * Resets retry strategy counter
   * Useful for manual reconnection attempts
   */
  resetRetryStrategy() {
    this.retryStrategy.reset()
  }

  /**
   * Destroys service instance
   */
  destroy() {
    this.disconnect()
    this.removeAllListeners()
    this._initialized = false
    this._connected = false
  }

  /**
   * Sets up internal event listeners
   * @private
   */
  _setupEventListeners() {
    // WebSocket events
    this.websocket.on(SERVICE_EVENTS.CONNECTED, () => {
      this.state.setConnectionStatus('connected')
    })

    this.websocket.on(SERVICE_EVENTS.DISCONNECTED, () => {
      this.state.setConnectionStatus('disconnected')
      this._connected = false
      this.emit(SERVICE_EVENTS.DISCONNECTED)
    })

    this.websocket.on(SERVICE_EVENTS.RECONNECTING, (attempts) => {
      this.state.setConnectionStatus('reconnecting', { reconnectAttempts: attempts })
      this.emit(SERVICE_EVENTS.RECONNECTING, attempts)
    })

    this.websocket.on(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, (status) => {
      this.state.setConnectionStatus(status)
      this.emit(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, status)
    })

    this.websocket.on(SERVICE_EVENTS.MESSAGE, (msg) => {
      this.messageProcessor.process(msg)
    })

    this.websocket.on(SERVICE_EVENTS.ERROR, (error) => {
      this.state.setError(error)
      this.emit(SERVICE_EVENTS.ERROR, error)
    })

    // Message processor events
    this.messageProcessor.on(SERVICE_EVENTS.MESSAGE_PROCESSED, (msg) => {
      this.state.addMessage(msg)
      this.session.appendToConversation(msg)
      this.emit(SERVICE_EVENTS.MESSAGE_RECEIVED, msg)
    })

    this.messageProcessor.on(SERVICE_EVENTS.TYPING_START, () => {
      this.state.setTyping(true)
      this.emit(SERVICE_EVENTS.TYPING_START)
    })

    this.messageProcessor.on(SERVICE_EVENTS.TYPING_STOP, () => {
      this.state.setTyping(false)
      this.emit(SERVICE_EVENTS.TYPING_STOP)
    })

    this.messageProcessor.on(SERVICE_EVENTS.THINKING_START, () => {
      this.state.setThinking(true)
      this.emit(SERVICE_EVENTS.THINKING_START)
    })

    this.messageProcessor.on(SERVICE_EVENTS.THINKING_STOP, () => {
      this.state.setThinking(false)
      this.emit(SERVICE_EVENTS.THINKING_STOP)
    })

    this.messageProcessor.on(SERVICE_EVENTS.ERROR, (error) => {
      this.emit(SERVICE_EVENTS.ERROR, error)
    })

    this.messageProcessor.on(SERVICE_EVENTS.MESSAGE_UNKNOWN, (rawMessage) => {
      this.emit(SERVICE_EVENTS.MESSAGE_UNKNOWN, rawMessage)
    })

    // State manager events
    this.state.on(SERVICE_EVENTS.STATE_CHANGED, (newState, oldState) => {
      this.emit(SERVICE_EVENTS.STATE_CHANGED, newState, oldState)
    })

    // Camera recorder events
    this.cameraRecorder.on(SERVICE_EVENTS.CAMERA_STREAM_RECEIVED, (stream) => {
      this.emit(SERVICE_EVENTS.CAMERA_STREAM_RECEIVED, stream)
    })
    
    this.cameraRecorder.on(SERVICE_EVENTS.CAMERA_RECORDING_STARTED, () => {
      this.emit(SERVICE_EVENTS.CAMERA_RECORDING_STARTED)
    })

    this.cameraRecorder.on(SERVICE_EVENTS.CAMERA_RECORDING_STOPPED, () => {
      this.emit(SERVICE_EVENTS.CAMERA_RECORDING_STOPPED)
    })

    this.cameraRecorder.on(SERVICE_EVENTS.CAMERA_DEVICES_CHANGED, (devices) => {
      this.emit(SERVICE_EVENTS.CAMERA_DEVICES_CHANGED, devices)
    })

    // Audio recorder events
    this.audioRecorder.on(SERVICE_EVENTS.RECORDING_STARTED, () => {
      this.emit(SERVICE_EVENTS.RECORDING_STARTED)
    })

    this.audioRecorder.on(SERVICE_EVENTS.RECORDING_STOPPED, (result) => {
      this.emit(SERVICE_EVENTS.RECORDING_STOPPED, result)
    })

    this.audioRecorder.on(SERVICE_EVENTS.RECORDING_TICK, (duration) => {
      this.emit(SERVICE_EVENTS.RECORDING_TICK, duration)
    })

    this.audioRecorder.on(SERVICE_EVENTS.ERROR, (error) => {
      this.emit(SERVICE_EVENTS.ERROR, error)
    })

    // File handler events
    this.fileHandler.on(SERVICE_EVENTS.FILE_PROCESSED, (file) => {
      this.emit(SERVICE_EVENTS.FILE_PROCESSED, file)
    })

    this.fileHandler.on(SERVICE_EVENTS.ERROR, (error) => {
      this.emit(SERVICE_EVENTS.ERROR, error)
    })

    // History manager events
    this.history.on(SERVICE_EVENTS.HISTORY_LOADED, (messages) => {
      this.emit(SERVICE_EVENTS.HISTORY_LOADED, messages)
    })

    this.history.on(SERVICE_EVENTS.ERROR, (error) => {
      this.emit(SERVICE_EVENTS.ERROR, error)
    })
  }
}

// Static methods
WeniWebchatService.isAudioRecordingSupported = AudioRecorder.isSupported

// Static constants
WeniWebchatService.ALLOWED_FILE_TYPES = ALLOWED_FILE_TYPES
WeniWebchatService.ALLOWED_IMAGE_TYPES = ALLOWED_IMAGE_TYPES
WeniWebchatService.ALLOWED_VIDEO_TYPES = ALLOWED_VIDEO_TYPES
WeniWebchatService.ALLOWED_AUDIO_TYPES = ALLOWED_AUDIO_TYPES
WeniWebchatService.ALLOWED_DOCUMENT_TYPES = ALLOWED_DOCUMENT_TYPES
WeniWebchatService.MESSAGE_TYPES = MESSAGE_TYPES
WeniWebchatService.MESSAGE_STATUS = MESSAGE_STATUS
WeniWebchatService.MESSAGE_DIRECTIONS = MESSAGE_DIRECTIONS
WeniWebchatService.CONNECTION_STATUS = CONNECTION_STATUS
WeniWebchatService.STORAGE_TYPES = STORAGE_TYPES
WeniWebchatService.ERROR_TYPES = ERROR_TYPES
WeniWebchatService.QUICK_REPLY_TYPES = QUICK_REPLY_TYPES
WeniWebchatService.SERVICE_EVENTS = SERVICE_EVENTS
WeniWebchatService.DEFAULTS = DEFAULTS

export {
  ALLOWED_FILE_TYPES,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_AUDIO_TYPES,
  ALLOWED_DOCUMENT_TYPES,
  MESSAGE_TYPES,
  MESSAGE_STATUS,
  MESSAGE_DIRECTIONS,
  CONNECTION_STATUS,
  STORAGE_TYPES,
  ERROR_TYPES,
  QUICK_REPLY_TYPES,
  SERVICE_EVENTS,
  DEFAULTS
}
