import EventEmitter from 'eventemitter3'

import { DEFAULTS, AUDIO_MIME_TYPES, SERVICE_EVENTS } from '../utils/constants'

/**
 * AudioRecorder
 * 
 * Handles audio recording:
 * - Records audio using MediaRecorder API
 * - Converts to MP3 format
 * - Recording timer
 * - Manages microphone permissions
 */
export default class AudioRecorder extends EventEmitter {
  constructor(config = {}) {
    super()
    
    this.config = {
      maxDuration: config.maxDuration || DEFAULTS.MAX_RECORDING_DURATION,
      mimeType: config.mimeType || AUDIO_MIME_TYPES[0],
      audioBitsPerSecond: config.audioBitsPerSecond || DEFAULTS.AUDIO_BITS_PER_SECOND,
      ...config
    }
    
    this.mediaRecorder = null
    this.audioStream = null
    this.audioChunks = []
    this.startTime = null
    this.timerInterval = null
    this.isRecording = false
  }

  /**
   * Starts audio recording
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRecording) {
      throw new Error('Recording already in progress')
    }

    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: true 
      })

      const mimeType = this._getSupportedMimeType()

      this.mediaRecorder = new MediaRecorder(this.audioStream, {
        mimeType,
        audioBitsPerSecond: this.config.audioBitsPerSecond
      })

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data)
        }
      }

      this.mediaRecorder.onstop = () => {
        this._handleRecordingStop()
      }

      this.mediaRecorder.onerror = (error) => {
        this.emit(SERVICE_EVENTS.ERROR, error)
      }

      // Start recording
      this.audioChunks = []
      this.startTime = Date.now()
      this.isRecording = true
      
      this.mediaRecorder.start()
      this._startTimer()
      
      this.emit(SERVICE_EVENTS.RECORDING_STARTED)

      setTimeout(() => {
        if (this.isRecording) {
          this.stop()
        }
      }, this.config.maxDuration)

    } catch (error) {
      this.isRecording = false
      this.emit(SERVICE_EVENTS.ERROR, error)
      throw error
    }
  }

  /**
   * Stops audio recording
   * @returns {Promise<Object>}
   */
  async stop() {
    if (!this.isRecording) {
      throw new Error('No recording in progress')
    }

    return new Promise((resolve) => {
      this._stopCompleteCallback = resolve
      
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop()
      }
      
      this._stopTimer()
      this._stopAudioStream()
    })
  }

  /**
   * Cancels recording without saving
   */
  cancel() {
    if (!this.isRecording) {
      return
    }

    this.isRecording = false
    this.audioChunks = []
    
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop()
    }

    this._stopTimer()
    this._stopAudioStream()
    
    this.emit(SERVICE_EVENTS.RECORDING_CANCELLED)
  }

  /**
   * Gets current recording duration in milliseconds
   * @returns {number}
   */
  getDuration() {
    if (!this.startTime) {
      return 0
    }
    
    return Date.now() - this.startTime
  }

  /**
   * Checks if browser supports audio recording
   * @returns {boolean}
   */
  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  }

  /**
   * Handles recording stop
   * @private
   */
  async _handleRecordingStop() {
    this.isRecording = false
    
    try {
      const blob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType })
      const duration = this.getDuration()

      const base64 = await this._blobToBase64(blob)

      const result = {
        type: 'audio',
        base64,
        duration,
        mimeType: this.mediaRecorder.mimeType,
        size: blob.size
      }

      this.emit(SERVICE_EVENTS.RECORDING_STOPPED, result)
      
      if (this._stopCompleteCallback) {
        this._stopCompleteCallback(result)
        this._stopCompleteCallback = null
      }

    } catch (error) {
      this.emit(SERVICE_EVENTS.ERROR, error)
    }
  }

  /**
   * Starts recording timer
   * @private
   */
  _startTimer() {
    this._stopTimer()
    
    this.timerInterval = setInterval(() => {
      const duration = this.getDuration()
      this.emit(SERVICE_EVENTS.RECORDING_TICK, duration)
    }, 100)
  }

  /**
   * Stops recording timer
   * @private
   */
  _stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval)
      this.timerInterval = null
    }
  }

  /**
   * Stops audio stream
   * @private
   */
  _stopAudioStream() {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop())
      this.audioStream = null
    }
  }

  /**
   * Converts blob to base64
   * @private
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      
      reader.onloadend = () => {
        resolve(reader.result)
      }
      
      reader.onerror = reject
      
      reader.readAsDataURL(blob)
    })
  }

  /**
   * Gets supported mime type
   * @private
   * @returns {string}
   */
  _getSupportedMimeType() {
    const types = AUDIO_MIME_TYPES

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type
      }
    }

    return this.config.mimeType
  }
}


