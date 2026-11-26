import EventEmitter from 'eventemitter3';

import { SERVICE_EVENTS } from '../utils/constants';
import { mergeMessageUpdates } from '../utils/helpers';
import { insertMessage, repositionMessage } from '../utils/messageOrdering';

function createInitialState() {
  return {
    messages: [],
    session: {},
    connection: {
      status: 'disconnected',
      reconnectAttempts: 0,
      lastError: null,
    },
    context: '',
    isTyping: false,
    isThinking: false,
    thinkingText: null,
    error: null,
    features: { humanSupportStatus: false },
    humanSupport: { active: false },
    typingAuthor: null,
  };
}

/**
 * StateManager
 *
 * Manages global application state:
 * - Messages array
 * - Session data
 * - Connection state
 * - Context string
 * - UI state (typing, etc.)
 * - Human support state (feature gate, active support, typing author)
 *
 * Uses EventEmitter to notify subscribers of state changes
 */
export default class StateManager extends EventEmitter {
  constructor() {
    super();

    this.state = createInitialState();
  }

  /**
   * Updates state and emits change event
   * @param {Object} updates Partial state updates
   */
  setState(updates) {
    const oldState = { ...this.state };
    this.state = { ...this.state, ...updates };

    this.emit(SERVICE_EVENTS.STATE_CHANGED, this.state, oldState);

    // Emit specific change events
    Object.keys(updates).forEach((key) => {
      if (oldState[key] !== this.state[key]) {
        this.emit(`state:${key}:changed`, this.state[key], oldState[key]);
      }
    });
  }

  /**
   * Gets current state
   * @returns {Object}
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Gets specific state property
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Adds a message to state at its server position (`orderKey`), or at the
   * end when it has none
   * @param {Object} message
   */
  addMessage(message) {
    const messages = insertMessage(this.state.messages, message);
    this.setState({ messages });
    this.emit(SERVICE_EVENTS.MESSAGE_ADDED, message);
  }

  /**
   * Updates a message in state. A clearable field (see mergeMessageUpdates)
   * set to `undefined` is removed; a new `orderKey` repositions the message.
   * @param {string} messageId
   * @param {Object} updates
   */
  updateMessage(messageId, updates) {
    this.updateMessages([[messageId, updates]]);
  }

  /**
   * Updates several messages with a single state change
   * @param {Array<[string, Object]>} entries Message id and updates pairs
   * @returns {boolean} Whether the message order changed
   */
  updateMessages(entries) {
    const updatesById = new Map(entries);
    let messages = this.state.messages.map((msg) =>
      updatesById.has(msg.id)
        ? mergeMessageUpdates(msg, updatesById.get(msg.id))
        : msg,
    );

    const before = messages;
    entries.forEach(([messageId, updates]) => {
      if ('orderKey' in updates) {
        messages = repositionMessage(messages, messageId);
      }
    });

    this.setState({ messages });
    entries.forEach(([messageId, updates]) => {
      this.emit(SERVICE_EVENTS.MESSAGE_UPDATED, messageId, updates);
    });

    return messages !== before;
  }

  /**
   * Removes a message from state
   * @param {string} messageId
   */
  removeMessage(messageId) {
    const messages = this.state.messages.filter((msg) => msg.id !== messageId);
    this.setState({ messages });
    this.emit(SERVICE_EVENTS.MESSAGE_REMOVED, messageId);
  }

  /**
   * Clears all messages
   */
  clearMessages() {
    this.setState({ messages: [] });
    this.emit(SERVICE_EVENTS.MESSAGES_CLEARED);
  }

  /**
   * Sets connection status
   * @param {string} status
   * @param {Object} details
   */
  setConnectionStatus(status, details = {}) {
    const connection = {
      ...this.state.connection,
      status,
      ...details,
    };

    this.setState({ connection });
  }

  /**
   * Sets session data
   * @param {Object} session
   */
  setSession(session) {
    this.setState({
      session,
      messages: session.conversation,
    });
  }

  /**
   * Sets context
   * @param {string} context
   */
  setContext(context) {
    this.setState({ context });
  }

  /**
   * Gets context
   * @returns {string}
   */
  getContext() {
    return this.state.context;
  }

  /**
   * Sets typing indicator
   * @param {boolean} isTyping
   */
  setTyping(isTyping) {
    this.setState({ isTyping });
  }

  /**
   * Sets the feature gate the socket enabled for this connection
   * @param {{ humanSupportStatus: boolean }} features
   */
  setFeatures(features) {
    this.setState({ features: { ...this.state.features, ...features } });
  }

  /**
   * Sets the human support state of the conversation
   * @param {{ active: boolean }} humanSupport
   */
  setHumanSupport(humanSupport) {
    this.setState({ humanSupport });
  }

  /**
   * Sets the Live Desk agent shown in the typing indicator
   * @param {{ type: 'human_agent', name?: string }|null} typingAuthor
   */
  setTypingAuthor(typingAuthor) {
    this.setState({ typingAuthor });
  }

  /**
   * Sets thinking indicator.
   * Stopping thinking also clears the rationale text in the same update.
   * @param {boolean} isThinking
   */
  setThinking(isThinking) {
    if (isThinking) {
      this.setState({ isThinking: true });
      return;
    }

    this.setState({ isThinking: false, thinkingText: null });
  }

  /**
   * Sets the rationale text shown while thinking
   * @param {string|null} text
   */
  setThinkingText(text) {
    this.setState({ thinkingText: text });
  }

  /**
   * Sets error state
   * @param {Error|string|null} error
   */
  setError(error) {
    this.setState({
      error: error instanceof Error ? error : error ? new Error(error) : null,
    });
  }

  /**
   * Clears error state
   */
  clearError() {
    this.setState({ error: null });
  }

  /**
   * Resets state to initial values
   */
  reset() {
    this.state = createInitialState();

    this.emit(SERVICE_EVENTS.STATE_RESET);
  }

  /**
   * Gets messages
   * @returns {Array}
   */
  getMessages() {
    return [...this.state.messages];
  }

  /**
   * Gets message by ID
   * @param {string} messageId
   * @returns {Object|undefined}
   */
  getMessage(messageId) {
    return this.state.messages.find((msg) => msg.id === messageId);
  }
}
