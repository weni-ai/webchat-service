import StorageManager from '../src/core/StorageManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a DOMException-like QuotaExceededError so that the catch branch in
 * `set()` matches by `error.name`.
 */
function createQuotaError() {
  const err = new Error('Quota exceeded');
  err.name = 'QuotaExceededError';
  return err;
}

function createManager(type = 'local') {
  return new StorageManager(type);
}

/**
 * Replaces `manager.storage` with a facade that delegates to the real
 * underlying storage but lets the test override any method. This is the
 * recommended workaround for `jest.spyOn`'s limitations on jsdom's
 * `Storage.prototype` methods (which are defined via property accessors and
 * are not wrappable by `spyOn`).
 */
function installStorageFacade(manager, overrides = {}) {
  const real = manager.storage;
  manager.storage = {
    get length() {
      return real.length;
    },
    key: (i) => real.key(i),
    getItem: (k) => real.getItem(k),
    setItem: (k, v) => real.setItem(k, v),
    removeItem: (k) => real.removeItem(k),
    clear: () => real.clear(),
    ...overrides,
  };
  return manager.storage;
}

/**
 * Plants a raw envelope directly into `localStorage` so the test can control
 * `_timestamp` ordering for `_handleQuotaExceeded` scenarios.
 */
function plantEnvelope(key, timestamp, data = key) {
  localStorage.setItem(
    `weni:webchat:${key}`,
    JSON.stringify({
      _version: '1.0.0',
      _timestamp: timestamp,
      _data: data,
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StorageManager', () => {
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  // -------------------------------------------------------------------------
  // A. constructor
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('defaults to localStorage with the canonical prefix and version', () => {
      const manager = createManager();

      expect(manager.type).toBe('local');
      expect(manager.storage).toBe(localStorage);
      expect(manager.prefix).toBe('weni:webchat:');
      expect(manager.version).toBe('1.0.0');
    });

    it('applies the "local" default when constructed with no arguments', () => {
      // Exercises the default-parameter branch (`constructor(type = 'local')`).
      // Calling through `createManager()` would pass 'local' explicitly via
      // its own default and miss this branch.
      const manager = new StorageManager();

      expect(manager.type).toBe('local');
      expect(manager.storage).toBe(localStorage);
    });

    it('uses sessionStorage when type is "session"', () => {
      const manager = createManager('session');

      expect(manager.type).toBe('session');
      expect(manager.storage).toBe(sessionStorage);
    });
  });

  // -------------------------------------------------------------------------
  // B. get()
  // -------------------------------------------------------------------------
  describe('get()', () => {
    it('returns null when the key is absent', () => {
      const manager = createManager();

      expect(manager.get('missing')).toBeNull();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('round-trips a value set through set() and returns the inner _data', () => {
      const manager = createManager();
      const value = { hello: 'world', n: 42 };

      manager.set('payload', value);

      expect(manager.get('payload')).toEqual(value);
    });

    it('returns the parsed object as-is for legacy values without an envelope', () => {
      // Plant a value that was written without our `_version`/`_data` wrapper.
      localStorage.setItem(
        'weni:webchat:legacy',
        JSON.stringify({ legacy: true, n: 1 }),
      );
      const manager = createManager();

      expect(manager.get('legacy')).toEqual({ legacy: true, n: 1 });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('routes through _migrate when _version differs and returns _data', () => {
      localStorage.setItem(
        'weni:webchat:legacy',
        JSON.stringify({
          _version: '0.9.0',
          _timestamp: 123,
          _data: 'migrated-value',
        }),
      );
      const manager = createManager();

      expect(manager.get('legacy')).toBe('migrated-value');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('returns null and logs when stored JSON is malformed', () => {
      localStorage.setItem('weni:webchat:broken', 'not-json{');
      const manager = createManager();

      expect(manager.get('broken')).toBeNull();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('returns null and logs when storage.getItem throws', () => {
      const manager = createManager();
      installStorageFacade(manager, {
        getItem: () => {
          throw new Error('boom');
        },
      });

      expect(manager.get('anything')).toBeNull();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // C. set()
  // -------------------------------------------------------------------------
  describe('set()', () => {
    it('persists the value inside a versioned envelope with a timestamp', () => {
      const before = Date.now();
      const manager = createManager();

      manager.set('foo', { hello: 'world' });

      const raw = localStorage.getItem('weni:webchat:foo');
      expect(raw).not.toBeNull();
      const envelope = JSON.parse(raw);
      expect(envelope).toEqual({
        _version: '1.0.0',
        _timestamp: expect.any(Number),
        _data: { hello: 'world' },
      });
      expect(envelope._timestamp).toBeGreaterThanOrEqual(before);
    });

    it('invokes _handleQuotaExceeded on QuotaExceededError and does not throw', () => {
      const manager = createManager();
      installStorageFacade(manager, {
        setItem: () => {
          throw createQuotaError();
        },
      });
      const handleSpy = jest
        .spyOn(manager, '_handleQuotaExceeded')
        .mockImplementation(() => {});

      expect(() => manager.set('foo', 'bar')).not.toThrow();

      expect(handleSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('logs and does NOT call _handleQuotaExceeded for non-quota errors', () => {
      const manager = createManager();
      installStorageFacade(manager, {
        setItem: () => {
          throw new Error('boom');
        },
      });
      const handleSpy = jest
        .spyOn(manager, '_handleQuotaExceeded')
        .mockImplementation(() => {});

      expect(() => manager.set('foo', 'bar')).not.toThrow();

      expect(handleSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // D. remove()
  // -------------------------------------------------------------------------
  describe('remove()', () => {
    it('removes the prefixed key and leaves foreign keys intact', () => {
      const manager = createManager();
      manager.set('foo', 'value');
      localStorage.setItem('other:key', 'foreign');

      manager.remove('foo');

      expect(localStorage.getItem('weni:webchat:foo')).toBeNull();
      expect(localStorage.getItem('other:key')).toBe('foreign');
    });

    it('swallows errors when storage.removeItem throws', () => {
      const manager = createManager();
      installStorageFacade(manager, {
        removeItem: () => {
          throw new Error('boom');
        },
      });

      expect(() => manager.remove('foo')).not.toThrow();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // E. clear()
  // -------------------------------------------------------------------------
  describe('clear()', () => {
    it('removes only prefixed keys and leaves foreign keys intact', () => {
      const manager = createManager();
      manager.set('a', 1);
      manager.set('b', 2);
      localStorage.setItem('other:key', 'foreign-1');
      localStorage.setItem('something_else', 'foreign-2');

      manager.clear();

      expect(localStorage.getItem('weni:webchat:a')).toBeNull();
      expect(localStorage.getItem('weni:webchat:b')).toBeNull();
      expect(localStorage.getItem('other:key')).toBe('foreign-1');
      expect(localStorage.getItem('something_else')).toBe('foreign-2');
    });

    it('swallows errors when storage.removeItem throws', () => {
      const manager = createManager();
      manager.set('a', 1);
      installStorageFacade(manager, {
        removeItem: () => {
          throw new Error('boom');
        },
      });

      expect(() => manager.clear()).not.toThrow();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // F. has()
  // -------------------------------------------------------------------------
  describe('has()', () => {
    it('returns true for a present key', () => {
      const manager = createManager();
      manager.set('foo', 'bar');

      expect(manager.has('foo')).toBe(true);
    });

    it('returns false for an absent key', () => {
      const manager = createManager();

      expect(manager.has('nope')).toBe(false);
    });

    it('returns false after the key is removed', () => {
      const manager = createManager();
      manager.set('foo', 'bar');
      manager.remove('foo');

      expect(manager.has('foo')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // G. keys()
  // -------------------------------------------------------------------------
  describe('keys()', () => {
    it('returns [] when there are no prefixed keys', () => {
      const manager = createManager();

      expect(manager.keys()).toEqual([]);
    });

    it('strips the prefix from each returned key', () => {
      const manager = createManager();
      manager.set('foo', 1);
      manager.set('bar', 2);

      expect(manager.keys().sort()).toEqual(['bar', 'foo']);
    });

    it('excludes foreign (un-prefixed) keys', () => {
      const manager = createManager();
      manager.set('foo', 1);
      localStorage.setItem('other:key', 'foreign');
      localStorage.setItem('plain', 'foreign');

      expect(manager.keys()).toEqual(['foo']);
    });
  });

  // -------------------------------------------------------------------------
  // H. getSize()
  // -------------------------------------------------------------------------
  describe('getSize()', () => {
    it('returns 0 when there are no prefixed keys', () => {
      expect(createManager().getSize()).toBe(0);
    });

    it('sums key.length + item.length for every prefixed key', () => {
      const manager = createManager();
      manager.set('foo', 'a');

      const fullKey = 'weni:webchat:foo';
      const item = localStorage.getItem(fullKey);
      expect(manager.getSize()).toBe(fullKey.length + item.length);
    });

    it('ignores foreign (un-prefixed) keys', () => {
      const manager = createManager();
      manager.set('foo', 'a');
      const fullKey = 'weni:webchat:foo';
      const prefixed = localStorage.getItem(fullKey);

      localStorage.setItem(
        'other:key',
        'this-is-a-foreign-value-that-should-not-count',
      );

      expect(manager.getSize()).toBe(fullKey.length + prefixed.length);
    });

    it('tolerates storage.getItem returning null mid-iteration', () => {
      const manager = createManager();
      manager.set('foo', 'value');

      // Force getItem to lie about the prefixed key so the `if (item)` guard
      // on line 123 of StorageManager.js skips it without throwing.
      installStorageFacade(manager, { getItem: () => null });

      expect(manager.getSize()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // I. _getFullKey() (also exercised through public methods)
  // -------------------------------------------------------------------------
  describe('_getFullKey()', () => {
    it('prepends the prefix when missing', () => {
      const manager = createManager();

      expect(manager._getFullKey('foo')).toBe('weni:webchat:foo');
    });

    it('is idempotent for already-prefixed keys (no double-prefixing)', () => {
      const manager = createManager();

      expect(manager._getFullKey('weni:webchat:foo')).toBe('weni:webchat:foo');

      manager.set('foo', 'value');
      expect(manager.get('weni:webchat:foo')).toBe('value');
      expect(manager.has('weni:webchat:foo')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // J. _getAllKeys() (also exercised through keys())
  // -------------------------------------------------------------------------
  describe('_getAllKeys()', () => {
    it('tolerates a null storage.key(i) in the middle of the iteration', () => {
      const manager = createManager();

      // Swap manager.storage with a fake whose .key() yields a null in the
      // middle of the prefixed keys. This is the defensive guard in
      // _getAllKeys() (`if (key && key.startsWith(this.prefix))`).
      manager.storage = {
        length: 3,
        key: jest.fn((i) => {
          if (i === 0) return 'weni:webchat:foo';
          if (i === 1) return null;
          if (i === 2) return 'weni:webchat:bar';
          return null;
        }),
        getItem: jest.fn(() => null),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      };

      expect(manager.keys().sort()).toEqual(['bar', 'foo']);
    });

    it('excludes keys that do not start with the prefix', () => {
      const manager = createManager();
      manager.set('foo', 1);
      localStorage.setItem('not-prefixed', 'x');
      localStorage.setItem('weni:other:bar', 'x');

      expect(manager._getAllKeys()).toEqual(['weni:webchat:foo']);
    });
  });

  // -------------------------------------------------------------------------
  // K. _migrate() (covered through get())
  // -------------------------------------------------------------------------
  describe('_migrate()', () => {
    it('returns _data when defined and warns about the migration', () => {
      localStorage.setItem(
        'weni:webchat:legacy',
        JSON.stringify({
          _version: '0.9.0',
          _data: { migrated: true },
        }),
      );
      const manager = createManager();

      expect(manager.get('legacy')).toEqual({ migrated: true });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('Data migration needed');
    });

    it('returns the whole parsed object when _data is undefined', () => {
      const legacy = { _version: '0.5.0', foo: 'bar' };
      localStorage.setItem('weni:webchat:legacy', JSON.stringify(legacy));
      const manager = createManager();

      expect(manager.get('legacy')).toEqual(legacy);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // L. _handleQuotaExceeded() (triggered through set())
  // -------------------------------------------------------------------------
  describe('_handleQuotaExceeded()', () => {
    /**
     * The facade delegates length/key/getItem/removeItem to the real storage,
     * but `setItem` throws a QuotaExceededError. This lets the eviction logic
     * inside `_handleQuotaExceeded` read and remove the planted items
     * through the real storage while the original `set()` call still trips
     * the quota branch.
     */
    function makeQuotaFacade(manager) {
      installStorageFacade(manager, {
        setItem: () => {
          throw createQuotaError();
        },
      });
    }

    it('removes the oldest 25% (Math.ceil) when 4 items are present', () => {
      plantEnvelope('a', 100);
      plantEnvelope('b', 200);
      plantEnvelope('c', 300);
      plantEnvelope('d', 400);

      const manager = createManager();
      makeQuotaFacade(manager);

      manager.set('overflow', 'value');

      // Math.ceil(4 * 0.25) === 1 → only the oldest ('a') is evicted.
      expect(localStorage.getItem('weni:webchat:a')).toBeNull();
      expect(localStorage.getItem('weni:webchat:b')).not.toBeNull();
      expect(localStorage.getItem('weni:webchat:c')).not.toBeNull();
      expect(localStorage.getItem('weni:webchat:d')).not.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Quota exceeded'),
      );
    });

    it('removes the oldest 25% (rounded up) when 5 items are present', () => {
      plantEnvelope('a', 100);
      plantEnvelope('b', 200);
      plantEnvelope('c', 300);
      plantEnvelope('d', 400);
      plantEnvelope('e', 500);

      const manager = createManager();
      makeQuotaFacade(manager);

      manager.set('overflow', 'value');

      // Math.ceil(5 * 0.25) === 2 → 'a' and 'b' are evicted.
      expect(localStorage.getItem('weni:webchat:a')).toBeNull();
      expect(localStorage.getItem('weni:webchat:b')).toBeNull();
      expect(localStorage.getItem('weni:webchat:c')).not.toBeNull();
      expect(localStorage.getItem('weni:webchat:d')).not.toBeNull();
      expect(localStorage.getItem('weni:webchat:e')).not.toBeNull();
    });

    it('treats missing _timestamp as 0 so older entries still go first', () => {
      // The `(a.data._timestamp || 0)` and `(b.data._timestamp || 0)` branches
      // in the comparator: entries without a timestamp are sorted as oldest.
      // Two no-timestamp items guarantee that the comparator runs with the
      // falsy side in both `a` and `b` positions at least once.
      localStorage.setItem(
        'weni:webchat:no-ts-a',
        JSON.stringify({ _version: '1.0.0', _data: 'oldest-a' }),
      );
      localStorage.setItem(
        'weni:webchat:no-ts-b',
        JSON.stringify({ _version: '1.0.0', _data: 'oldest-b' }),
      );
      plantEnvelope('mid', 250);
      plantEnvelope('newer', 500);
      plantEnvelope('newest', 999);

      const manager = createManager();
      makeQuotaFacade(manager);

      manager.set('overflow', 'value');

      // Math.ceil(5 * 0.25) === 2 → both timestamp-less entries should win
      // the sort and be removed first.
      expect(localStorage.getItem('weni:webchat:no-ts-a')).toBeNull();
      expect(localStorage.getItem('weni:webchat:no-ts-b')).toBeNull();
      expect(localStorage.getItem('weni:webchat:mid')).not.toBeNull();
      expect(localStorage.getItem('weni:webchat:newer')).not.toBeNull();
      expect(localStorage.getItem('weni:webchat:newest')).not.toBeNull();
    });

    it('falls back to {} when getItem returns null mid-eviction', () => {
      // Forces the `|| "{}"` fallback inside the `.map` callback (line 188):
      // `JSON.parse(this.storage.getItem(key) || '{}')`.
      plantEnvelope('a', 100);
      plantEnvelope('b', 200);

      const manager = createManager();
      installStorageFacade(manager, {
        setItem: () => {
          throw createQuotaError();
        },
        // Every read returns null so the fallback fires for every key.
        getItem: () => null,
      });

      expect(() => manager.set('overflow', 'value')).not.toThrow();
      // Math.ceil(2 * 0.25) === 1 → one item is removed through the real
      // underlying storage (the facade delegates removeItem).
      const remaining = [
        localStorage.getItem('weni:webchat:a'),
        localStorage.getItem('weni:webchat:b'),
      ].filter(Boolean);
      expect(remaining).toHaveLength(1);
    });

    it('swallows JSON.parse errors inside _handleQuotaExceeded and stays safe', () => {
      localStorage.setItem('weni:webchat:bad', 'not-json{');

      const manager = createManager();
      makeQuotaFacade(manager);

      expect(() => manager.set('overflow', 'value')).not.toThrow();

      // Two console.errors: one from set()'s catch, one from
      // _handleQuotaExceeded()'s inner catch.
      expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      // The bad item is untouched because parsing failed before any removal.
      expect(localStorage.getItem('weni:webchat:bad')).toBe('not-json{');
    });
  });

  // -------------------------------------------------------------------------
  // M. local vs session storage isolation
  // -------------------------------------------------------------------------
  describe('local vs session storage isolation', () => {
    it('a "session" manager writes only to sessionStorage', () => {
      const manager = createManager('session');

      manager.set('only-here', 'value');

      expect(sessionStorage.getItem('weni:webchat:only-here')).not.toBeNull();
      expect(localStorage.getItem('weni:webchat:only-here')).toBeNull();
    });

    it('a "local" manager writes only to localStorage', () => {
      const manager = createManager('local');

      manager.set('only-here', 'value');

      expect(localStorage.getItem('weni:webchat:only-here')).not.toBeNull();
      expect(sessionStorage.getItem('weni:webchat:only-here')).toBeNull();
    });

    it('a "session" manager does not read from localStorage', () => {
      localStorage.setItem(
        'weni:webchat:foo',
        JSON.stringify({ _version: '1.0.0', _data: 'local-only' }),
      );
      const sessionManager = createManager('session');

      expect(sessionManager.get('foo')).toBeNull();
    });
  });
});
