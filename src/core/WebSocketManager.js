import EventEmitter from 'eventemitter3'

import { DEFAULTS, SERVICE_EVENTS } from '../utils/constants'
/**
 * WebSocketManager
 * 
 * Manages WebSocket connection lifecycle, including:
 * - Connection establishment
 * - Automatic reconnection (configurable attempts)
 * - Ping/Pong keepalive mechanism
 * - Message sending and receiving
 * - Connection state management
 * 
 * States: connecting, connected, disconnected, error, reconnecting
 */
export default class WebSocketManager extends EventEmitter {
  constructor(config = {}) {
    super()
    
    this.config = {
      socketUrl: config.socketUrl || '',
      channelUuid: config.channelUuid || '',
      host: config.host || '',
      sessionToken: config.sessionToken || null,
      autoReconnect: config.autoReconnect !== false || DEFAULTS.AUTO_RECONNECT,
      maxReconnectAttempts: config.maxReconnectAttempts || DEFAULTS.MAX_RECONNECT_ATTEMPTS,
      reconnectInterval: config.reconnectInterval || DEFAULTS.RECONNECT_INTERVAL,
      pingInterval: config.pingInterval || DEFAULTS.PING_INTERVAL,
      retryStrategy: config.retryStrategy || null,
      ...config
    }

    this.socket = null
    this.status = 'disconnected'
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.pingTimer = null
    this.isRegistered = false
    this.registrationData = null
    this.retryStrategy = this.config.retryStrategy
  }

  /**
   * Establishes WebSocket connection
   * @returns {Promise<void>}
   */
  async connect(registrationData) {
    if (this.status === 'connected' || this.status === 'connecting') {
      return Promise.resolve()
    }

    if (this.socket) {
      this.socket.close()
      this.socket = null
    }

    return new Promise((resolve, reject) => {
      try {
        this.status = 'connecting'
        this.emit(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, this.status)

        const socketHost = this.config.socketUrl.replace(/^(https?:|)\/\//, '')
        const url = `wss://${socketHost}/ws`

        this.socket = new WebSocket(url)

        this.socket.onopen = () => {
          this.register(registrationData);
          this.once(SERVICE_EVENTS.CONNECTED, resolve);
        }

        this.socket.onmessage = (event) => {
          this._handleMessage(event)
        }

        this.socket.onerror = (error) => {
          this.emit(SERVICE_EVENTS.ERROR, error)
        }

        this.socket.onclose = (event) => {
          this._handleDisconnect(event)
        }

      } catch (error) {
        this.status = 'error'
        this.emit(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, this.status)
        this.emit(SERVICE_EVENTS.ERROR, error)
        reject(error)
      }
    })
  }

  /**
   * Registers session with the server
   * Only registers once per connection, stores data for reconnection
   * @param {Object} data Registration data
   * @returns {Promise<void>}
   */
  async register(data = {}) {
    if (this.isRegistered && this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }

    const host = this.config.host || data.host || 'https://flows.weni.ai'

    const message = buildRegistrationMessage(data.from, {
      callback: data.callback || `${host}/c/wwc/${this.config.channelUuid}/receive`,
      session_type: data.session_type || 'local',
      token: data.token || this.config.sessionToken || undefined
    })

    this.registrationData = data

    return this.send(message).then(() => {
      this.isRegistered = true
      this.emit(SERVICE_EVENTS.WS_REGISTERED)
    }).catch((error) => {
      this.emit(SERVICE_EVENTS.ERROR, new Error('Registration failed: ' + error.message))
      throw error
    })
  }

  async _handleReadyForMessage() {
    this.status = 'connected';

    this.reconnectAttempts = 0

    if (this.retryStrategy) {
      this.retryStrategy.reset()
    }
    
    this.emit(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, this.status)
    this.emit(SERVICE_EVENTS.CONNECTED)
    this._startPingInterval()
  }

  _getHistory() {
    return this.history;
  }

  /**
   * Sends a message through WebSocket
   * Waits for connection if socket is connecting
   * @param {Object} message Message object
   * @returns {Promise<void>}
   */
  send(message) {
    return new Promise((resolve, reject) => {
      // If socket is ready, send immediately
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify(message))
          this.emit(SERVICE_EVENTS.MESSAGE_SENT, message)
          resolve()
        } catch (error) {
          this.emit(SERVICE_EVENTS.ERROR, error)
          reject(error)
        }
        return
      }

      // If socket is connecting, wait for it to open
      if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
        const onOpen = () => {
          try {
            this.socket.send(JSON.stringify(message))
            this.emit(SERVICE_EVENTS.MESSAGE_SENT, message)
            cleanup()
            resolve()
          } catch (error) {
            cleanup()
            this.emit(SERVICE_EVENTS.ERROR, error)
            reject(error)
          }
        }

        const onError = (error) => {
          cleanup()
          this.emit(SERVICE_EVENTS.ERROR, error)
          reject(error)
        }

        const onClose = () => {
          cleanup()
          reject(new Error('WebSocket closed before message could be sent'))
        }

        const cleanup = () => {
          this.socket?.removeEventListener('open', onOpen)
          this.socket?.removeEventListener('error', onError)
          this.socket?.removeEventListener('close', onClose)
        }

        this.socket.addEventListener('open', onOpen)
        this.socket.addEventListener('error', onError)
        this.socket.addEventListener('close', onClose)
        return
      }

      // Socket is closed or doesn't exist
      reject(new Error('WebSocket not connected'))
    })
  }

  /**
   * Disconnects WebSocket
   * @param {boolean} permanent If true, prevents reconnection
   */
  disconnect(permanent = true) {
    if (permanent) {
      this.config.autoReconnect = false
    }
    
    this._stopPingInterval()
    this._stopReconnectTimer()

    if (this.socket) {
      this.socket.close()
      this.socket = null
    }

    this.status = 'disconnected'
    this.isRegistered = false
    this.emit(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, this.status)
    
    if (permanent) {
      this.emit(SERVICE_EVENTS.DISCONNECTED)
    }
  }

  /**
   * Gets current connection status
   * @returns {string}
   */
  getStatus() {
    return this.status
  }

  /**
   * Handles incoming WebSocket messages
   * @private
   */
  _handleMessage(event) {
    try {
      const data = JSON.parse(event.data)

      if (data.type === 'pong') {
        return
      }

      if (data.type === 'ready_for_message') {
        this._handleReadyForMessage();
        return;
      }

      if (data.type === 'error') {
        const errorMsg = data.error || 'Unknown server error'
        this.emit(SERVICE_EVENTS.ERROR, new Error(errorMsg))
        
        if (errorMsg.includes('unable to register') || errorMsg.includes('already exists')) {
          this.isRegistered = false
        }
        return
      }

      this.emit(SERVICE_EVENTS.MESSAGE, data)
    } catch (error) {
      this.emit(SERVICE_EVENTS.ERROR, new Error('Failed to parse message: ' + error.message))
    }
  }

  /**
   * Handles WebSocket disconnection
   * @private
   */
  _handleDisconnect(event) {
    const wasConnected = this.status === 'connected'
    
    this.status = 'disconnected'
    this.isRegistered = false
    this._stopPingInterval()
    this.emit(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, this.status)
    this.emit(SERVICE_EVENTS.DISCONNECTED)

    // Only attempt reconnection if we were connected and autoReconnect is enabled
    if (wasConnected && this.config.autoReconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this._scheduleReconnect()
    }
  }

  /**
   * Schedules reconnection attempt
   * Uses RetryStrategy if available for exponential backoff with jitter
   * @private
   */
  _scheduleReconnect() {
    this.status = 'reconnecting'
    this.emit(SERVICE_EVENTS.CONNECTION_STATUS_CHANGED, this.status)
    
    // Calculate delay using retry strategy or fallback to fixed interval
    const delay = this.retryStrategy 
      ? this.retryStrategy.next()
      : this.config.reconnectInterval
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++
      this.emit(SERVICE_EVENTS.RECONNECTING, this.reconnectAttempts)
      
      try {
        await this.connect(this.registrationData)
      } catch (error) {
        // Error handled in connect()
      }
    }, delay)
  }

  /**
   * Starts ping interval to keep connection alive
   * @private
   */
  _startPingInterval() {
    this._stopPingInterval()
    
    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping' }))
      }
    }, this.config.pingInterval)
  }

  /**
   * Stops ping interval
   * @private
   */
  _stopPingInterval() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  /**
   * Stops reconnect timer
   * @private
   */
  _stopReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}


