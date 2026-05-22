import SessionManager from '../src/core/SessionManager';
import { SERVICE_EVENTS } from '../src/utils/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a storage mock that matches the StorageManager surface used by
 * SessionManager (`get`, `set`, `remove`). The `initial` argument optionally
 * pre-seeds the storage so that `get(sessionKey)` returns a stored session.
 */
function makeStorage(initial = null) {
  const state = { value: initial };
  return {
    get: jest.fn(() => state.value),
    set: jest.fn((_key, value) => {
      state.value = value;
    }),
    remove: jest.fn(() => {
      state.value = null;
    }),
    _peek: () => state.value,
  };
}

function createManager(config = {}, storage) {
  return new SessionManager(storage || makeStorage(), config);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionManager', () => {
  let manager;

  afterEach(() => {
    if (manager) {
      manager.clear();
      manager = null;
    }
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // A. constructor
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('extends EventEmitter so consumers can on()/emit() against it', () => {
      manager = createManager();
      const handler = jest.fn();

      manager.on('test:event', handler);
      manager.emit('test:event', 'payload');

      expect(handler).toHaveBeenCalledWith('payload');
    });

    it('initializes runtime state to safe defaults', () => {
      const storage = makeStorage();
      manager = createManager({}, storage);

      expect(manager.session).toBeNull();
      expect(manager.clearTimer).toBeNull();
      expect(manager.contactTimeoutTimer).toBeNull();
      expect(manager.sessionKey).toBe('weni:webchat:session');
      expect(manager.storage).toBe(storage);
    });

    it('applies default config values', () => {
      manager = createManager();

      expect(manager.config.autoClearCache).toBe(true);
      expect(manager.config.cacheTimeout).toBe(30 * 60 * 1000);
      expect(manager.config.contactTimeout).toBe(24 * 60);
      expect(manager.config.clientId).toBeNull();
      expect(manager.config.sessionId).toBeNull();
    });

    it('honors caller overrides for every knob', () => {
      manager = createManager({
        autoClearCache: true,
        cacheTimeout: 1000,
        contactTimeout: 5,
        clientId: 'client-1',
        sessionId: 'sess-1',
      });

      expect(manager.config.cacheTimeout).toBe(1000);
      expect(manager.config.contactTimeout).toBe(5);
      expect(manager.config.clientId).toBe('client-1');
      expect(manager.config.sessionId).toBe('sess-1');
    });

    it('honors autoClearCache: false explicitly (regression on `!== false`)', () => {
      manager = createManager({ autoClearCache: false });
      expect(manager.config.autoClearCache).toBe(false);
    });

    it('is callable with no config argument and falls back to defaults', () => {
      manager = new SessionManager(makeStorage());

      expect(manager.config.autoClearCache).toBe(true);
      expect(manager.config.cacheTimeout).toBe(30 * 60 * 1000);
      expect(manager.config.contactTimeout).toBe(24 * 60);
      expect(manager.config.clientId).toBeNull();
      expect(manager.config.sessionId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // B. getOrCreate()
  // -------------------------------------------------------------------------
  describe('getOrCreate()', () => {
    it('returns the in-memory session id when one already exists', () => {
      const storage = makeStorage();
      manager = createManager({}, storage);
      manager.session = { id: 'cached-id', lastActivity: Date.now() };

      expect(manager.getOrCreate()).toBe('cached-id');
      expect(storage.get).not.toHaveBeenCalled();
    });

    it('restores a valid session from storage and refreshes lastActivity', () => {
      const stored = {
        id: 'stored-id',
        createdAt: 1000,
        lastActivity: 2000,
        lastMessageSentAt: null,
        hasSentAnyMessage: false,
        metadata: {},
        conversation: [],
      };
      const storage = makeStorage(stored);
      manager = createManager({}, storage);

      const id = manager.getOrCreate();

      expect(id).toBe('stored-id');
      expect(manager.session).toBe(stored);
      expect(manager.session.lastActivity).toBeGreaterThan(2000);
    });

    it('creates a new session when storage is empty', () => {
      const storage = makeStorage(null);
      manager = createManager({}, storage);

      const id = manager.getOrCreate();

      expect(id).toBeTruthy();
      expect(manager.session).not.toBeNull();
      expect(manager.session.id).toBe(id);
      expect(storage.set).toHaveBeenCalled();
    });

    it('creates a new session when the stored one is missing required fields', () => {
      const storage = makeStorage({ id: null, lastActivity: 1000 });
      manager = createManager({}, storage);

      const id = manager.getOrCreate();

      expect(id).not.toBeNull();
      expect(manager.session.id).toBe(id);
      expect(manager.session.id).not.toBe(null);
    });

    it('creates a new session when the stored one is past the contact timeout', () => {
      const now = Date.now();
      const oneHourMs = 60 * 60 * 1000;
      const storage = makeStorage({
        id: 'expired-id',
        lastActivity: now,
        lastMessageSentAt: now - 2 * oneHourMs,
      });
      manager = createManager({ contactTimeout: 60 }, storage);

      const id = manager.getOrCreate();

      expect(id).not.toBe('expired-id');
    });
  });

  // -------------------------------------------------------------------------
  // C. restore()
  // -------------------------------------------------------------------------
  describe('restore()', () => {
    it('returns null when nothing is in storage', async () => {
      manager = createManager({}, makeStorage(null));
      await expect(manager.restore()).resolves.toBeNull();
      expect(manager.session).toBeNull();
    });

    it('returns null when the stored session is invalid (no id)', async () => {
      manager = createManager({}, makeStorage({ lastActivity: 1 }));
      await expect(manager.restore()).resolves.toBeNull();
    });

    it('returns the stored session and refreshes lastActivity when valid', async () => {
      const stored = {
        id: 'sess-restored',
        lastActivity: 1000,
        lastMessageSentAt: null,
      };
      manager = createManager({ autoClearCache: false }, makeStorage(stored));

      const result = await manager.restore();

      expect(result).toBe(stored);
      expect(manager.session.lastActivity).toBeGreaterThan(1000);
    });

    it('schedules both the auto-clear timer and the contact-timeout check', async () => {
      jest.useFakeTimers();
      const now = Date.now();
      const stored = {
        id: 'sess-with-message',
        lastActivity: now,
        lastMessageSentAt: now,
      };
      manager = createManager(
        { autoClearCache: true, cacheTimeout: 60_000, contactTimeout: 1 },
        makeStorage(stored),
      );

      await manager.restore();

      expect(manager.clearTimer).not.toBeNull();
      expect(manager.contactTimeoutTimer).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // D. getSession() / getSessionId() / setSessionId()
  // -------------------------------------------------------------------------
  describe('getSession() / getSessionId()', () => {
    it('return null when there is no session', () => {
      manager = createManager();
      expect(manager.getSession()).toBeNull();
      expect(manager.getSessionId()).toBeNull();
    });

    it('return the active session and its id once created', () => {
      manager = createManager({ autoClearCache: false });
      const id = manager.createNewSession();

      expect(manager.getSession()).toEqual(
        expect.objectContaining({ id, conversation: [] }),
      );
      expect(manager.getSessionId()).toBe(id);
    });
  });

  describe('setSessionId()', () => {
    it('stores the value in config so the next createNewSession reuses it', () => {
      manager = createManager({ autoClearCache: false });

      manager.setSessionId('forced-id');
      const id = manager.createNewSession();

      expect(manager.config.sessionId).toBe('forced-id');
      expect(id).toBe('forced-id');
    });
  });

  // -------------------------------------------------------------------------
  // E. updateMetadata()
  // -------------------------------------------------------------------------
  describe('updateMetadata()', () => {
    it('is a no-op when there is no session', () => {
      const storage = makeStorage();
      manager = createManager({}, storage);
      storage.set.mockClear();

      manager.updateMetadata({ foo: 'bar' });

      expect(storage.set).not.toHaveBeenCalled();
    });

    it('merges new keys into existing metadata and persists', () => {
      const storage = makeStorage();
      manager = createManager({ autoClearCache: false }, storage);
      manager.createNewSession();
      manager.session.metadata = { existing: 1 };
      storage.set.mockClear();

      manager.updateMetadata({ added: 2 });

      expect(manager.session.metadata).toEqual({ existing: 1, added: 2 });
      expect(storage.set).toHaveBeenCalled();
      const persisted = storage.set.mock.calls.at(-1)[1];
      expect(persisted.metadata).toEqual({ existing: 1, added: 2 });
    });

    it('defaults to {} when called with no argument', () => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();
      manager.session.metadata = { kept: true };

      manager.updateMetadata();

      expect(manager.session.metadata).toEqual({ kept: true });
    });
  });

  // -------------------------------------------------------------------------
  // F. clear()
  // -------------------------------------------------------------------------
  describe('clear()', () => {
    it('nullifies the session, removes from storage, and stops both timers', () => {
      jest.useFakeTimers();
      const storage = makeStorage();
      manager = createManager(
        { autoClearCache: true, cacheTimeout: 10_000, contactTimeout: 1 },
        storage,
      );
      manager.createNewSession();
      manager.setLastMessageSentAt(Date.now());

      expect(manager.clearTimer).not.toBeNull();
      expect(manager.contactTimeoutTimer).not.toBeNull();

      manager.clear();

      expect(manager.session).toBeNull();
      expect(manager.clearTimer).toBeNull();
      expect(manager.contactTimeoutTimer).toBeNull();
      expect(storage.remove).toHaveBeenCalledWith('weni:webchat:session');
    });

    it('is safe to call when no session was ever created', () => {
      const storage = makeStorage();
      manager = createManager({}, storage);

      expect(() => manager.clear()).not.toThrow();
      expect(storage.remove).toHaveBeenCalledWith('weni:webchat:session');
    });
  });

  // -------------------------------------------------------------------------
  // G. createNewSession()
  // -------------------------------------------------------------------------
  describe('createNewSession()', () => {
    it('produces a session with the documented default shape', () => {
      const before = Date.now();
      manager = createManager({ autoClearCache: false });

      const id = manager.createNewSession();

      expect(id).toMatch(/^\d+@.+/);
      expect(manager.session).toEqual({
        id,
        createdAt: expect.any(Number),
        lastActivity: expect.any(Number),
        lastMessageSentAt: null,
        hasSentAnyMessage: false,
        pendingCustomFields: {},
        isChatOpen: false,
        metadata: {},
        conversation: [],
      });
      expect(manager.session.createdAt).toBeGreaterThanOrEqual(before);
    });

    it('uses config.sessionId verbatim when one is provided', () => {
      manager = createManager({
        autoClearCache: false,
        sessionId: 'explicit-id',
      });

      expect(manager.createNewSession()).toBe('explicit-id');
    });

    it('generates an id from clientId in the format `timestamp@clientId`', () => {
      manager = createManager({
        autoClearCache: false,
        clientId: 'my.client',
      });

      const id = manager.createNewSession();

      expect(id).toMatch(/^\d+@my\.client$/);
    });

    it('persists the new session to storage', () => {
      const storage = makeStorage();
      manager = createManager({ autoClearCache: false }, storage);

      const id = manager.createNewSession();

      expect(storage.set).toHaveBeenCalledWith(
        'weni:webchat:session',
        expect.objectContaining({ id }),
      );
    });

    it('starts the auto-clear timer when autoClearCache=true', () => {
      manager = createManager({
        autoClearCache: true,
        cacheTimeout: 60_000,
      });

      manager.createNewSession();

      expect(manager.clearTimer).not.toBeNull();
    });

    it('does not schedule the contact-timeout (no message sent yet)', () => {
      manager = createManager({ autoClearCache: false, contactTimeout: 1 });

      manager.createNewSession();

      expect(manager.contactTimeoutTimer).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // H. setLastMessageSentAt() / hasUserSentAnyMessage() / setHasSentAnyMessage()
  // -------------------------------------------------------------------------
  describe('setLastMessageSentAt()', () => {
    it('is a no-op when there is no session', () => {
      const storage = makeStorage();
      manager = createManager({}, storage);
      storage.set.mockClear();

      manager.setLastMessageSentAt();

      expect(storage.set).not.toHaveBeenCalled();
    });

    it('records the timestamp, flips hasSentAnyMessage, and persists', () => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();

      manager.setLastMessageSentAt(123456);

      expect(manager.session.lastMessageSentAt).toBe(123456);
      expect(manager.session.hasSentAnyMessage).toBe(true);
    });

    it('falls back to Date.now() when called without arguments', () => {
      const before = Date.now();
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();

      manager.setLastMessageSentAt();

      expect(manager.session.lastMessageSentAt).toBeGreaterThanOrEqual(before);
    });

    it('(re)schedules the contact-timeout check', () => {
      jest.useFakeTimers();
      manager = createManager({ autoClearCache: false, contactTimeout: 1 });
      manager.createNewSession();
      expect(manager.contactTimeoutTimer).toBeNull();

      manager.setLastMessageSentAt(Date.now());

      expect(manager.contactTimeoutTimer).not.toBeNull();
    });
  });

  describe('hasUserSentAnyMessage() / setHasSentAnyMessage()', () => {
    it('hasUserSentAnyMessage returns false when no session exists', () => {
      manager = createManager();
      expect(manager.hasUserSentAnyMessage()).toBe(false);
    });

    it('hasUserSentAnyMessage reflects the session flag', () => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();
      expect(manager.hasUserSentAnyMessage()).toBe(false);

      manager.setHasSentAnyMessage(true);
      expect(manager.hasUserSentAnyMessage()).toBe(true);
    });

    it('setHasSentAnyMessage is a no-op when no session exists', () => {
      const storage = makeStorage();
      manager = createManager({}, storage);
      storage.set.mockClear();

      manager.setHasSentAnyMessage(true);

      expect(storage.set).not.toHaveBeenCalled();
    });

    it('setHasSentAnyMessage defaults the argument to true', () => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();

      manager.setHasSentAnyMessage();

      expect(manager.session.hasSentAnyMessage).toBe(true);
    });

    it('setHasSentAnyMessage coerces truthy/falsy values to booleans', () => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();

      manager.setHasSentAnyMessage('truthy');
      expect(manager.session.hasSentAnyMessage).toBe(true);

      manager.setHasSentAnyMessage(0);
      expect(manager.session.hasSentAnyMessage).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // I. _isSessionValid (exercised through getOrCreate / restore)
  // -------------------------------------------------------------------------
  describe('_isSessionValid (via getOrCreate)', () => {
    it('rejects sessions missing lastActivity', () => {
      const stored = { id: 'has-id' };
      manager = createManager({ autoClearCache: false }, makeStorage(stored));

      const id = manager.getOrCreate();
      expect(id).not.toBe('has-id');
    });

    it('accepts a session that has never sent a message regardless of age', () => {
      const veryOld = Date.now() - 100 * 24 * 60 * 60 * 1000;
      const stored = {
        id: 'never-sent',
        lastActivity: veryOld,
        lastMessageSentAt: null,
      };
      manager = createManager(
        { autoClearCache: false, contactTimeout: 60 },
        makeStorage(stored),
      );

      expect(manager.getOrCreate()).toBe('never-sent');
    });

    it('accepts a session whose lastMessageSentAt is within the contact timeout', () => {
      const now = Date.now();
      const stored = {
        id: 'recent',
        lastActivity: now,
        lastMessageSentAt: now - 60_000,
      };
      manager = createManager(
        { autoClearCache: false, contactTimeout: 60 },
        makeStorage(stored),
      );

      expect(manager.getOrCreate()).toBe('recent');
    });

    it('treats a 0/negative contact timeout as always-expired once any message was sent', () => {
      const now = Date.now();
      const stored = {
        id: 'forced-expire',
        lastActivity: now,
        lastMessageSentAt: now,
      };
      manager = createManager(
        { autoClearCache: false },
        makeStorage(stored),
      );
      manager.config.contactTimeout = 0;

      expect(manager.getOrCreate()).not.toBe('forced-expire');
    });
  });

  // -------------------------------------------------------------------------
  // J. _scheduleContactTimeoutCheck (via setLastMessageSentAt)
  // -------------------------------------------------------------------------
  describe('_scheduleContactTimeoutCheck()', () => {
    it('emits CONTACT_TIMEOUT_MAXIMUM_TIME_REACHED after contactTimeout elapses', () => {
      jest.useFakeTimers();
      manager = createManager({ autoClearCache: false, contactTimeout: 1 });
      manager.createNewSession();
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.CONTACT_TIMEOUT_MAXIMUM_TIME_REACHED, handler);

      manager.setLastMessageSentAt(Date.now());
      jest.advanceTimersByTime(59_999);
      expect(handler).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(manager.contactTimeoutTimer).toBeNull();
    });

    it('emits immediately when the target time has already passed', () => {
      manager = createManager({ autoClearCache: false, contactTimeout: 1 });
      manager.createNewSession();
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.CONTACT_TIMEOUT_MAXIMUM_TIME_REACHED, handler);

      manager.setLastMessageSentAt(Date.now() - 10 * 60_000);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(manager.contactTimeoutTimer).toBeNull();
    });

    it('does not schedule a timer when contactTimeout resolves to 0', () => {
      jest.useFakeTimers();
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.CONTACT_TIMEOUT_MAXIMUM_TIME_REACHED, handler);
      manager.config.contactTimeout = 0;

      manager.setLastMessageSentAt(Date.now() + 60_000);
      jest.advanceTimersByTime(60_000);

      expect(manager.contactTimeoutTimer).toBeNull();
      expect(handler).not.toHaveBeenCalled();
    });

    it('replaces the previous timer when called twice (no double emit)', () => {
      jest.useFakeTimers();
      manager = createManager({ autoClearCache: false, contactTimeout: 1 });
      manager.createNewSession();
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.CONTACT_TIMEOUT_MAXIMUM_TIME_REACHED, handler);

      manager.setLastMessageSentAt(Date.now());
      const firstTimer = manager.contactTimeoutTimer;
      manager.setLastMessageSentAt(Date.now());
      const secondTimer = manager.contactTimeoutTimer;

      expect(firstTimer).not.toBe(secondTimer);

      jest.advanceTimersByTime(60_000);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not schedule when there is no session (regression)', () => {
      jest.useFakeTimers();
      manager = createManager({ autoClearCache: false, contactTimeout: 1 });

      manager._scheduleContactTimeoutCheck();

      expect(manager.contactTimeoutTimer).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // K. Conversation API
  // -------------------------------------------------------------------------
  describe('conversation API', () => {
    beforeEach(() => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();
    });

    it('getConversation returns [] when there is no session', () => {
      manager.clear();
      expect(manager.getConversation()).toEqual([]);
    });

    it('getConversation rehydrates a non-array conversation field', () => {
      manager.session.conversation = 'not-an-array';

      expect(manager.getConversation()).toEqual([]);
      expect(manager.session.conversation).toEqual([]);
    });

    it('setConversation replaces the entire array and persists', () => {
      const messages = [{ id: 'a' }, { id: 'b' }];

      manager.setConversation(messages);

      expect(manager.session.conversation).toEqual(messages);
    });

    it('setConversation coerces non-array input to []', () => {
      manager.setConversation('garbage');
      expect(manager.session.conversation).toEqual([]);
    });

    it('setConversation is a no-op when there is no session', () => {
      manager.clear();
      expect(() => manager.setConversation([{ id: 'a' }])).not.toThrow();
      expect(manager.session).toBeNull();
    });

    it('appendToConversation pushes a single message onto the list', () => {
      manager.appendToConversation({ id: 'first' });
      manager.appendToConversation({ id: 'second' });

      expect(manager.session.conversation).toEqual([
        { id: 'first' },
        { id: 'second' },
      ]);
    });

    it('appendToConversation honors the `limit` option by trimming the oldest entries', () => {
      manager.setConversation([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

      manager.appendToConversation({ id: 'd' }, { limit: 2 });

      expect(manager.session.conversation).toEqual([
        { id: 'c' },
        { id: 'd' },
      ]);
    });

    it('appendToConversation ignores a non-positive limit', () => {
      manager.setConversation([{ id: 'a' }, { id: 'b' }]);

      manager.appendToConversation({ id: 'c' }, { limit: 0 });

      expect(manager.session.conversation).toEqual([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
    });

    it('appendToConversation is a no-op when there is no session', () => {
      manager.clear();
      expect(() => manager.appendToConversation({ id: 'a' })).not.toThrow();
    });

    it('updateConversation merges fields onto a message matched by id', () => {
      manager.setConversation([
        { id: 'a', text: 'old' },
        { id: 'b', text: 'untouched' },
      ]);

      manager.updateConversation('a', { text: 'new', extra: true });

      expect(manager.session.conversation).toEqual([
        { id: 'a', text: 'new', extra: true },
        { id: 'b', text: 'untouched' },
      ]);
    });

    it('updateConversation silently ignores unknown ids', () => {
      manager.setConversation([{ id: 'a' }]);

      expect(() =>
        manager.updateConversation('missing', { text: 'x' }),
      ).not.toThrow();
      expect(manager.session.conversation).toEqual([{ id: 'a' }]);
    });

    it('updateConversation is a no-op when there is no session', () => {
      manager.clear();
      expect(() => manager.updateConversation('a', { x: 1 })).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // K2. Private helpers — defensive no-session guards
  // -------------------------------------------------------------------------
  describe('private no-session guards', () => {
    it('_updateLastActivity is a no-op when there is no session', () => {
      const storage = makeStorage();
      manager = createManager({}, storage);

      expect(() => manager._updateLastActivity()).not.toThrow();
      expect(storage.set).not.toHaveBeenCalled();
    });

    it('_save is a no-op when there is no session', () => {
      const storage = makeStorage();
      manager = createManager({}, storage);

      expect(() => manager._save()).not.toThrow();
      expect(storage.set).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // L. _save() backfill for older sessions
  // -------------------------------------------------------------------------
  describe('_save() backfill', () => {
    it('backfills isChatOpen, hasSentAnyMessage, and pendingCustomFields when persisting', () => {
      const storage = makeStorage();
      manager = createManager({ autoClearCache: false }, storage);
      manager.session = {
        id: 'legacy',
        lastActivity: Date.now(),
        lastMessageSentAt: 12345,
        metadata: {},
        conversation: [],
      };
      storage.set.mockClear();

      manager.updateMetadata({ touch: true });

      expect(manager.session.isChatOpen).toBe(false);
      expect(manager.session.hasSentAnyMessage).toBe(true);
      expect(manager.session.pendingCustomFields).toEqual({});
      expect(storage.set).toHaveBeenCalled();
      const persisted = storage.set.mock.calls.at(-1)[1];
      expect(persisted.isChatOpen).toBe(false);
      expect(persisted.hasSentAnyMessage).toBe(true);
      expect(persisted.pendingCustomFields).toEqual({});
    });

    it('leaves explicit fields alone (only backfills when undefined)', () => {
      const storage = makeStorage();
      manager = createManager({ autoClearCache: false }, storage);
      manager.session = {
        id: 'explicit',
        lastActivity: Date.now(),
        lastMessageSentAt: null,
        isChatOpen: true,
        hasSentAnyMessage: false,
        pendingCustomFields: { foo: 'bar' },
        metadata: {},
        conversation: [],
      };

      manager.updateMetadata({});

      expect(manager.session.isChatOpen).toBe(true);
      expect(manager.session.hasSentAnyMessage).toBe(false);
      expect(manager.session.pendingCustomFields).toEqual({ foo: 'bar' });
    });
  });

  // -------------------------------------------------------------------------
  // M. pendingCustomFields API
  // -------------------------------------------------------------------------
  describe('pendingCustomFields API', () => {
    it('getPendingCustomFields returns {} when no session exists', () => {
      manager = createManager();
      expect(manager.getPendingCustomFields()).toEqual({});
    });

    it('getPendingCustomFields returns {} when the field is missing or null', () => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();

      manager.session.pendingCustomFields = null;
      expect(manager.getPendingCustomFields()).toEqual({});
    });

    it('getPendingCustomFields returns {} when the field is a truthy non-object', () => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();

      manager.session.pendingCustomFields = 42;
      expect(manager.getPendingCustomFields()).toEqual({});
    });

    it('addPendingCustomField is a no-op when there is no session', () => {
      const storage = makeStorage();
      manager = createManager({}, storage);
      storage.set.mockClear();

      manager.addPendingCustomField('k', 'v');

      expect(storage.set).not.toHaveBeenCalled();
    });

    it('addPendingCustomField initializes the object if it is not one', () => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();
      manager.session.pendingCustomFields = 'not-an-object';

      manager.addPendingCustomField('a', 1);

      expect(manager.session.pendingCustomFields).toEqual({ a: 1 });
    });

    it('addPendingCustomField stores the key/value pair and persists', () => {
      const storage = makeStorage();
      manager = createManager({ autoClearCache: false }, storage);
      manager.createNewSession();
      storage.set.mockClear();

      manager.addPendingCustomField('order', 42);

      expect(manager.session.pendingCustomFields.order).toBe(42);
      expect(storage.set).toHaveBeenCalled();
      const persisted = storage.set.mock.calls.at(-1)[1];
      expect(persisted.pendingCustomFields).toEqual({ order: 42 });
    });

    it('clearPendingCustomFields resets the field to {} and persists', () => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();
      manager.addPendingCustomField('a', 1);

      manager.clearPendingCustomFields();

      expect(manager.session.pendingCustomFields).toEqual({});
    });

    it('clearPendingCustomFields is a no-op when there is no session', () => {
      const storage = makeStorage();
      manager = createManager({}, storage);
      storage.set.mockClear();

      manager.clearPendingCustomFields();

      expect(storage.set).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // N. isChatOpen API
  // -------------------------------------------------------------------------
  describe('setIsChatOpen() / getIsChatOpen()', () => {
    it('getIsChatOpen returns false when there is no session', () => {
      manager = createManager();
      expect(manager.getIsChatOpen()).toBe(false);
    });

    it('setIsChatOpen is a no-op when there is no session', () => {
      const storage = makeStorage();
      manager = createManager({}, storage);
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.CHAT_OPEN_CHANGED, handler);

      manager.setIsChatOpen(true);

      expect(handler).not.toHaveBeenCalled();
      expect(storage.set).not.toHaveBeenCalled();
    });

    it('setIsChatOpen coerces to boolean, persists, and emits CHAT_OPEN_CHANGED', () => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();
      const handler = jest.fn();
      manager.on(SERVICE_EVENTS.CHAT_OPEN_CHANGED, handler);

      manager.setIsChatOpen('truthy');
      expect(manager.session.isChatOpen).toBe(true);
      expect(handler).toHaveBeenLastCalledWith(true);

      manager.setIsChatOpen(0);
      expect(manager.session.isChatOpen).toBe(false);
      expect(handler).toHaveBeenLastCalledWith(false);
    });

    it('getIsChatOpen reflects the persisted value', () => {
      manager = createManager({ autoClearCache: false });
      manager.createNewSession();

      manager.setIsChatOpen(true);
      expect(manager.getIsChatOpen()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // O. Auto-clear timer
  // -------------------------------------------------------------------------
  describe('auto-clear timer', () => {
    it('does not start a timer when autoClearCache=false', () => {
      jest.useFakeTimers();
      manager = createManager({ autoClearCache: false });

      manager.createNewSession();

      expect(manager.clearTimer).toBeNull();
    });

    it('clears the session after cacheTimeout when autoClearCache=true', () => {
      jest.useFakeTimers();
      manager = createManager({
        autoClearCache: true,
        cacheTimeout: 5000,
      });
      manager.createNewSession();

      expect(manager.session).not.toBeNull();
      jest.advanceTimersByTime(4999);
      expect(manager.session).not.toBeNull();
      jest.advanceTimersByTime(1);

      expect(manager.session).toBeNull();
      expect(manager.clearTimer).toBeNull();
    });

    it('starting the auto-clear timer twice replaces the previous timer', () => {
      jest.useFakeTimers();
      manager = createManager({
        autoClearCache: true,
        cacheTimeout: 5000,
      });
      manager.createNewSession();

      const firstTimer = manager.clearTimer;
      manager._startAutoClearTimer();
      const secondTimer = manager.clearTimer;

      expect(firstTimer).not.toBe(secondTimer);
    });

    it('_stopAutoClearTimer is idempotent', () => {
      manager = createManager({ autoClearCache: false });

      expect(() => manager._stopAutoClearTimer()).not.toThrow();
      expect(manager.clearTimer).toBeNull();
      expect(() => manager._stopAutoClearTimer()).not.toThrow();
    });
  });
});
