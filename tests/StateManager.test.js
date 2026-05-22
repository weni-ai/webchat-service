import StateManager from '../src/core/StateManager';
import { SERVICE_EVENTS } from '../src/utils/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createManager() {
  return new StateManager();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StateManager', () => {
  let manager;

  afterEach(() => {
    if (manager) {
      manager.removeAllListeners();
      manager = null;
    }
  });

  // -------------------------------------------------------------------------
  // A. constructor / initial state
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('extends EventEmitter so consumers can on()/emit() against it', () => {
      manager = createManager();
      const handler = jest.fn();

      manager.on('custom:event', handler);
      manager.emit('custom:event', 'payload');

      expect(handler).toHaveBeenCalledWith('payload');
    });

    it('initializes state to the documented defaults', () => {
      manager = createManager();

      expect(manager.getState()).toEqual({
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
        error: null,
      });
    });
  });

  // -------------------------------------------------------------------------
  // B. setState()
  // -------------------------------------------------------------------------
  describe('setState()', () => {
    beforeEach(() => {
      manager = createManager();
    });

    it('shallow-merges updates into the current state', () => {
      manager.setState({ context: 'page-1', isTyping: true });

      const state = manager.getState();
      expect(state.context).toBe('page-1');
      expect(state.isTyping).toBe(true);
      expect(state.messages).toEqual([]);
      expect(state.connection.status).toBe('disconnected');
    });

    it('emits STATE_CHANGED with (newState, oldState)', () => {
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.STATE_CHANGED, handler);

      manager.setState({ context: 'page-2' });

      expect(handler).toHaveBeenCalledTimes(1);
      const [newState, oldState] = handler.mock.calls[0];
      expect(newState.context).toBe('page-2');
      expect(oldState.context).toBe('');
    });

    it('oldState reflects the snapshot taken before the update', () => {
      manager.setState({ isThinking: true });
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.STATE_CHANGED, handler);

      manager.setState({ isThinking: false });
      const [newState, oldState] = handler.mock.calls[0];

      expect(oldState.isThinking).toBe(true);
      expect(newState.isThinking).toBe(false);
    });

    it('emits a per-key `state:${key}:changed` event for each changed key', () => {
      const ctxHandler = jest.fn();
      const typingHandler = jest.fn();
      manager.on('state:context:changed', ctxHandler);
      manager.on('state:isTyping:changed', typingHandler);

      manager.setState({ context: 'about', isTyping: true });

      expect(ctxHandler).toHaveBeenCalledWith('about', '');
      expect(typingHandler).toHaveBeenCalledWith(true, false);
    });

    it('skips the per-key event when the value is strictly equal to the old one', () => {
      manager.setState({ context: 'same' });

      const ctxHandler = jest.fn();
      manager.on('state:context:changed', ctxHandler);

      manager.setState({ context: 'same' });

      expect(ctxHandler).not.toHaveBeenCalled();
    });

    it('fires the per-key event even when the new value is a different reference with equal content', () => {
      const oldMessages = manager.get('messages');
      const handler = jest.fn();
      manager.on('state:messages:changed', handler);

      manager.setState({ messages: [] });

      expect(handler).toHaveBeenCalledTimes(1);
      const [newValue, oldValue] = handler.mock.calls[0];
      expect(oldValue).toBe(oldMessages);
      expect(newValue).not.toBe(oldMessages);
    });

    it('still emits STATE_CHANGED for an empty update', () => {
      const stateHandler = jest.fn();
      const ctxHandler = jest.fn();
      manager.on(SERVICE_EVENTS.STATE_CHANGED, stateHandler);
      manager.on('state:context:changed', ctxHandler);

      manager.setState({});

      expect(stateHandler).toHaveBeenCalledTimes(1);
      expect(ctxHandler).not.toHaveBeenCalled();
    });

    it('does not deep-merge nested objects', () => {
      manager.setState({
        connection: { status: 'connected' },
      });

      expect(manager.get('connection')).toEqual({ status: 'connected' });
      expect(manager.get('connection').reconnectAttempts).toBeUndefined();
    });

    it('replaces the top-level state object reference', () => {
      const before = manager.getState();
      manager.setState({ context: 'next' });
      const after = manager.getState();

      expect(after).not.toBe(before);
    });

    it('allows new keys to be added to state (open shape)', () => {
      manager.setState({ custom: 'whatever' });

      expect(manager.get('custom')).toBe('whatever');
    });
  });

  // -------------------------------------------------------------------------
  // C. getState() / get()
  // -------------------------------------------------------------------------
  describe('getState() / get()', () => {
    beforeEach(() => {
      manager = createManager();
    });

    it('getState returns a fresh shallow copy of state', () => {
      const snapshot = manager.getState();
      snapshot.context = 'mutated';

      expect(manager.get('context')).toBe('');
    });

    it('get returns the live value for the requested key', () => {
      manager.setState({ messages: [{ id: 'm1' }] });

      expect(manager.get('messages')).toEqual([{ id: 'm1' }]);
    });

    it('get returns undefined for unknown keys', () => {
      expect(manager.get('does-not-exist')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // D. addMessage()
  // -------------------------------------------------------------------------
  describe('addMessage()', () => {
    beforeEach(() => {
      manager = createManager();
    });

    it('appends the message to state.messages', () => {
      manager.addMessage({ id: 'm1', text: 'hi' });
      manager.addMessage({ id: 'm2', text: 'bye' });

      expect(manager.getMessages()).toEqual([
        { id: 'm1', text: 'hi' },
        { id: 'm2', text: 'bye' },
      ]);
    });

    it('replaces the messages array (does not mutate the original)', () => {
      const before = manager.get('messages');

      manager.addMessage({ id: 'm1' });

      expect(manager.get('messages')).not.toBe(before);
      expect(before).toEqual([]);
    });

    it('emits MESSAGE_ADDED with the appended message', () => {
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.MESSAGE_ADDED, handler);

      const message = { id: 'm1' };
      manager.addMessage(message);

      expect(handler).toHaveBeenCalledWith(message);
    });

    it('emits state:messages:changed alongside MESSAGE_ADDED', () => {
      const stateHandler = jest.fn();
      const addedHandler = jest.fn();
      manager.on('state:messages:changed', stateHandler);
      manager.on(SERVICE_EVENTS.MESSAGE_ADDED, addedHandler);

      manager.addMessage({ id: 'm1' });

      expect(stateHandler).toHaveBeenCalledTimes(1);
      expect(addedHandler).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // E. updateMessage()
  // -------------------------------------------------------------------------
  describe('updateMessage()', () => {
    beforeEach(() => {
      manager = createManager();
      manager.addMessage({ id: 'm1', text: 'hi' });
      manager.addMessage({ id: 'm2', text: 'bye' });
    });

    it('merges updates into the message that matches the id', () => {
      manager.updateMessage('m1', { text: 'hello', status: 'sent' });

      expect(manager.getMessages()).toEqual([
        { id: 'm1', text: 'hello', status: 'sent' },
        { id: 'm2', text: 'bye' },
      ]);
    });

    it('leaves other messages untouched', () => {
      const original = manager.getMessage('m2');

      manager.updateMessage('m1', { status: 'sent' });

      expect(manager.getMessage('m2')).toEqual(original);
    });

    it('produces a new object for the updated message (immutability)', () => {
      const before = manager.getMessage('m1');

      manager.updateMessage('m1', { status: 'sent' });

      expect(manager.getMessage('m1')).not.toBe(before);
    });

    it('emits MESSAGE_UPDATED with (id, updates)', () => {
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.MESSAGE_UPDATED, handler);

      manager.updateMessage('m1', { status: 'sent' });

      expect(handler).toHaveBeenCalledWith('m1', { status: 'sent' });
    });

    it('does not throw and does not change the contents when the id is unknown', () => {
      const before = manager.getMessages();

      expect(() => manager.updateMessage('missing', { text: 'x' })).not.toThrow();

      expect(manager.getMessages()).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // F. removeMessage()
  // -------------------------------------------------------------------------
  describe('removeMessage()', () => {
    beforeEach(() => {
      manager = createManager();
      manager.addMessage({ id: 'm1' });
      manager.addMessage({ id: 'm2' });
    });

    it('removes the matching message from state', () => {
      manager.removeMessage('m1');

      expect(manager.getMessages()).toEqual([{ id: 'm2' }]);
    });

    it('emits MESSAGE_REMOVED with the removed id', () => {
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.MESSAGE_REMOVED, handler);

      manager.removeMessage('m2');

      expect(handler).toHaveBeenCalledWith('m2');
    });

    it('does not throw and keeps the contents when the id is unknown', () => {
      const before = manager.getMessages();

      expect(() => manager.removeMessage('missing')).not.toThrow();
      expect(manager.getMessages()).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // G. clearMessages()
  // -------------------------------------------------------------------------
  describe('clearMessages()', () => {
    beforeEach(() => {
      manager = createManager();
      manager.addMessage({ id: 'm1' });
      manager.addMessage({ id: 'm2' });
    });

    it('empties the messages array', () => {
      manager.clearMessages();

      expect(manager.getMessages()).toEqual([]);
    });

    it('emits MESSAGES_CLEARED', () => {
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.MESSAGES_CLEARED, handler);

      manager.clearMessages();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('also triggers STATE_CHANGED via the underlying setState', () => {
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.STATE_CHANGED, handler);

      manager.clearMessages();

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // H. setConnectionStatus()
  // -------------------------------------------------------------------------
  describe('setConnectionStatus()', () => {
    beforeEach(() => {
      manager = createManager();
    });

    it('updates the status while preserving the other connection fields', () => {
      manager.setConnectionStatus('connected');

      expect(manager.get('connection')).toEqual({
        status: 'connected',
        reconnectAttempts: 0,
        lastError: null,
      });
    });

    it('merges details into the connection state', () => {
      manager.setConnectionStatus('reconnecting', {
        reconnectAttempts: 3,
        lastError: 'timeout',
      });

      expect(manager.get('connection')).toEqual({
        status: 'reconnecting',
        reconnectAttempts: 3,
        lastError: 'timeout',
      });
    });

    it('lets `details` override the explicit status argument', () => {
      manager.setConnectionStatus('connected', { status: 'reconnecting' });

      expect(manager.get('connection').status).toBe('reconnecting');
    });

    it('always replaces the connection object reference', () => {
      const before = manager.get('connection');

      manager.setConnectionStatus('connected');

      expect(manager.get('connection')).not.toBe(before);
    });

    it('emits state:connection:changed', () => {
      const handler = jest.fn();
      manager.on('state:connection:changed', handler);

      manager.setConnectionStatus('connected');

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // I. setSession()
  // -------------------------------------------------------------------------
  describe('setSession()', () => {
    beforeEach(() => {
      manager = createManager();
    });

    it('writes the session and replaces messages from session.conversation', () => {
      const conversation = [{ id: 'm1' }, { id: 'm2' }];
      const session = { id: 'sess-1', conversation };

      manager.setSession(session);

      expect(manager.get('session')).toBe(session);
      expect(manager.get('messages')).toBe(conversation);
    });

    it('accepts an empty conversation array', () => {
      const session = { id: 'sess', conversation: [] };

      manager.setSession(session);

      expect(manager.get('session')).toBe(session);
      expect(manager.getMessages()).toEqual([]);
    });

    it('emits state:session:changed and state:messages:changed', () => {
      const sessionHandler = jest.fn();
      const messagesHandler = jest.fn();
      manager.on('state:session:changed', sessionHandler);
      manager.on('state:messages:changed', messagesHandler);

      manager.setSession({
        id: 'sess',
        conversation: [{ id: 'm1' }],
      });

      expect(sessionHandler).toHaveBeenCalledTimes(1);
      expect(messagesHandler).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // J. setContext() / getContext()
  // -------------------------------------------------------------------------
  describe('setContext() / getContext()', () => {
    beforeEach(() => {
      manager = createManager();
    });

    it('round-trips a string context value', () => {
      manager.setContext('home');

      expect(manager.getContext()).toBe('home');
      expect(manager.get('context')).toBe('home');
    });

    it('emits state:context:changed when the value differs', () => {
      const handler = jest.fn();
      manager.on('state:context:changed', handler);

      manager.setContext('page-x');

      expect(handler).toHaveBeenCalledWith('page-x', '');
    });

    it('getContext reflects the current value after multiple updates', () => {
      manager.setContext('first');
      manager.setContext('second');

      expect(manager.getContext()).toBe('second');
    });
  });

  // -------------------------------------------------------------------------
  // K. setTyping() / setThinking()
  // -------------------------------------------------------------------------
  describe('setTyping() / setThinking()', () => {
    beforeEach(() => {
      manager = createManager();
    });

    it('setTyping flips the flag and emits state:isTyping:changed', () => {
      const handler = jest.fn();
      manager.on('state:isTyping:changed', handler);

      manager.setTyping(true);

      expect(manager.get('isTyping')).toBe(true);
      expect(handler).toHaveBeenCalledWith(true, false);
    });

    it('setThinking flips the flag and emits state:isThinking:changed', () => {
      const handler = jest.fn();
      manager.on('state:isThinking:changed', handler);

      manager.setThinking(true);

      expect(manager.get('isThinking')).toBe(true);
      expect(handler).toHaveBeenCalledWith(true, false);
    });

    it('setting the same typing value twice skips the second per-key event', () => {
      manager.setTyping(true);
      const handler = jest.fn();
      manager.on('state:isTyping:changed', handler);

      manager.setTyping(true);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // L. setError() / clearError()
  // -------------------------------------------------------------------------
  describe('setError() / clearError()', () => {
    beforeEach(() => {
      manager = createManager();
    });

    it('keeps an Error instance as-is', () => {
      const err = new Error('boom');

      manager.setError(err);

      expect(manager.get('error')).toBe(err);
    });

    it('keeps subclasses of Error (e.g. TypeError) as-is', () => {
      const err = new TypeError('bad type');

      manager.setError(err);

      expect(manager.get('error')).toBe(err);
    });

    it('wraps non-empty strings in a new Error', () => {
      manager.setError('something failed');

      const stored = manager.get('error');
      expect(stored).toBeInstanceOf(Error);
      expect(stored.message).toBe('something failed');
    });

    it('stores null when the argument is explicitly null', () => {
      manager.setError(new Error('first'));

      manager.setError(null);

      expect(manager.get('error')).toBeNull();
    });

    it('stores null for any other falsy value (undefined, 0, "", false)', () => {
      manager.setError(undefined);
      expect(manager.get('error')).toBeNull();

      manager.setError(0);
      expect(manager.get('error')).toBeNull();

      manager.setError('');
      expect(manager.get('error')).toBeNull();

      manager.setError(false);
      expect(manager.get('error')).toBeNull();
    });

    it('emits state:error:changed only when the stored value changes reference', () => {
      const handler = jest.fn();
      manager.on('state:error:changed', handler);

      manager.setError('first');
      manager.setError('second');

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('clearError resets the error to null', () => {
      manager.setError('boom');
      expect(manager.get('error')).toBeInstanceOf(Error);

      manager.clearError();

      expect(manager.get('error')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // M. reset()
  // -------------------------------------------------------------------------
  describe('reset()', () => {
    beforeEach(() => {
      manager = createManager();
      manager.addMessage({ id: 'm1' });
      manager.setContext('about');
      manager.setTyping(true);
      manager.setThinking(true);
      manager.setError('boom');
      manager.setConnectionStatus('connected', { reconnectAttempts: 4 });
    });

    it('restores state to the documented defaults', () => {
      manager.reset();

      expect(manager.getState()).toEqual({
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
        error: null,
      });
    });

    it('emits STATE_RESET', () => {
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.STATE_RESET, handler);

      manager.reset();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does NOT emit STATE_CHANGED or per-key change events (reset bypasses setState)', () => {
      const stateChanged = jest.fn();
      const messagesChanged = jest.fn();
      manager.on(SERVICE_EVENTS.STATE_CHANGED, stateChanged);
      manager.on('state:messages:changed', messagesChanged);

      manager.reset();

      expect(stateChanged).not.toHaveBeenCalled();
      expect(messagesChanged).not.toHaveBeenCalled();
    });

    it('produces a brand-new state object reference after reset', () => {
      const before = manager.getState();
      manager.reset();

      expect(manager.getState()).not.toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // N. getMessages() / getMessage()
  // -------------------------------------------------------------------------
  describe('getMessages() / getMessage()', () => {
    beforeEach(() => {
      manager = createManager();
      manager.addMessage({ id: 'm1', text: 'one' });
      manager.addMessage({ id: 'm2', text: 'two' });
    });

    it('getMessages returns a copy of the messages array', () => {
      const messages = manager.getMessages();
      messages.push({ id: 'forced' });

      expect(manager.getMessages()).toHaveLength(2);
    });

    it('getMessages returns the messages in insertion order', () => {
      expect(manager.getMessages()).toEqual([
        { id: 'm1', text: 'one' },
        { id: 'm2', text: 'two' },
      ]);
    });

    it('getMessage returns the message with the given id', () => {
      expect(manager.getMessage('m1')).toEqual({ id: 'm1', text: 'one' });
    });

    it('getMessage returns undefined for unknown ids', () => {
      expect(manager.getMessage('missing')).toBeUndefined();
    });
  });
});
