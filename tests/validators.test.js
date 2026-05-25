import {
  validateConfig,
  validateMessage,
  validateUrl,
  validateWebSocketUrl,
  validateUUID,
  validateEmail,
  validatePhone,
  sanitizeText,
  validateFileType,
  validateFileSize,
} from '../src/utils/validators';

describe('validators', () => {
  // -------------------------------------------------------------------------
  // validateConfig — public entry point used by WeniWebchatService constructor.
  // The throwing branches are the contract; cover every guard plus the "happy"
  // path (no throw) for the optional fields.
  // -------------------------------------------------------------------------
  describe('validateConfig', () => {
    const validBase = {
      socketUrl: 'wss://example.com',
      channelUuid: 'abc-123',
    };

    describe('config object', () => {
      it.each([
        [null, 'null'],
        [undefined, 'undefined'],
        [false, 'false'],
        [0, 'zero'],
        ['', 'empty string'],
      ])('throws when config is %p (%s)', (badConfig) => {
        expect(() => validateConfig(badConfig)).toThrow(
          'Configuration is required',
        );
      });
    });

    describe('socketUrl', () => {
      it('throws when missing', () => {
        expect(() => validateConfig({ channelUuid: 'abc' })).toThrow(
          'socketUrl is required and must be a string',
        );
      });

      it('throws when empty string', () => {
        expect(() =>
          validateConfig({ socketUrl: '', channelUuid: 'abc' }),
        ).toThrow('socketUrl is required and must be a string');
      });

      it('throws when not a string', () => {
        expect(() =>
          validateConfig({ socketUrl: 123, channelUuid: 'abc' }),
        ).toThrow('socketUrl is required and must be a string');
        expect(() =>
          validateConfig({ socketUrl: {}, channelUuid: 'abc' }),
        ).toThrow('socketUrl is required and must be a string');
      });
    });

    describe('channelUuid', () => {
      it('throws when missing', () => {
        expect(() => validateConfig({ socketUrl: 'wss://x' })).toThrow(
          'channelUuid is required and must be a string',
        );
      });

      it('throws when empty string', () => {
        expect(() =>
          validateConfig({ socketUrl: 'wss://x', channelUuid: '' }),
        ).toThrow('channelUuid is required and must be a string');
      });

      it('throws when not a string', () => {
        expect(() =>
          validateConfig({ socketUrl: 'wss://x', channelUuid: 42 }),
        ).toThrow('channelUuid is required and must be a string');
      });
    });

    describe('connectOn', () => {
      it.each(['mount', 'manual', 'demand'])(
        'accepts the documented value %p',
        (value) => {
          expect(() =>
            validateConfig({ ...validBase, connectOn: value }),
          ).not.toThrow();
        },
      );

      it('throws on any other string', () => {
        expect(() =>
          validateConfig({ ...validBase, connectOn: 'auto' }),
        ).toThrow('connectOn must be "mount", "manual" or "demand"');
      });

      it('skips the check when connectOn is omitted', () => {
        expect(() => validateConfig(validBase)).not.toThrow();
      });
    });

    describe('storage', () => {
      it.each(['local', 'session'])('accepts %p', (value) => {
        expect(() =>
          validateConfig({ ...validBase, storage: value }),
        ).not.toThrow();
      });

      it('throws on any other string', () => {
        expect(() =>
          validateConfig({ ...validBase, storage: 'memory' }),
        ).toThrow('storage must be "local" or "session"');
      });

      it('skips the check when storage is omitted', () => {
        expect(() => validateConfig(validBase)).not.toThrow();
      });
    });

    describe('maxReconnectAttempts', () => {
      it('accepts a number', () => {
        expect(() =>
          validateConfig({ ...validBase, maxReconnectAttempts: 5 }),
        ).not.toThrow();
      });

      it('throws on a truthy non-number', () => {
        expect(() =>
          validateConfig({ ...validBase, maxReconnectAttempts: '5' }),
        ).toThrow('maxReconnectAttempts must be a number');
      });

      it('skips the check when value is falsy (0 / undefined)', () => {
        expect(() =>
          validateConfig({ ...validBase, maxReconnectAttempts: 0 }),
        ).not.toThrow();
        expect(() =>
          validateConfig({ ...validBase, maxReconnectAttempts: undefined }),
        ).not.toThrow();
      });
    });

    describe('pingInterval', () => {
      it('accepts a number', () => {
        expect(() =>
          validateConfig({ ...validBase, pingInterval: 30000 }),
        ).not.toThrow();
      });

      it('throws on a truthy non-number', () => {
        expect(() =>
          validateConfig({ ...validBase, pingInterval: '30s' }),
        ).toThrow('pingInterval must be a number');
      });

      it('skips the check when value is falsy', () => {
        expect(() =>
          validateConfig({ ...validBase, pingInterval: 0 }),
        ).not.toThrow();
      });
    });

    it('returns undefined for a fully valid config (no return contract)', () => {
      expect(
        validateConfig({
          socketUrl: 'wss://example.com',
          channelUuid: 'abc-123',
          connectOn: 'mount',
          storage: 'local',
          maxReconnectAttempts: 10,
          pingInterval: 50000,
        }),
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // validateMessage — exported for consumers that want a parity check before
  // calling sendMessage. Returns boolean, never throws.
  // -------------------------------------------------------------------------
  describe('validateMessage', () => {
    it.each([null, undefined, 0, '', false])(
      'returns false for falsy value %p',
      (value) => {
        expect(validateMessage(value)).toBe(false);
      },
    );

    it.each([
      ['string', 'hello'],
      ['number', 1],
      ['boolean', true],
    ])('returns false for non-object %s', (_label, value) => {
      expect(validateMessage(value)).toBe(false);
    });

    it('returns false when type is missing', () => {
      expect(validateMessage({})).toBe(false);
    });

    it('returns false when type is not a string', () => {
      expect(validateMessage({ type: 1 })).toBe(false);
      expect(validateMessage({ type: null })).toBe(false);
      expect(validateMessage({ type: {} })).toBe(false);
    });

    it('returns false when type is an empty string', () => {
      expect(validateMessage({ type: '' })).toBe(false);
    });

    it('returns true for the minimum valid shape', () => {
      expect(validateMessage({ type: 'text' })).toBe(true);
    });

    it('returns true regardless of extra fields', () => {
      expect(
        validateMessage({ type: 'image', media: 'x', extra: { a: 1 } }),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // validateUrl — wraps the URL constructor; returns boolean.
  // -------------------------------------------------------------------------
  describe('validateUrl', () => {
    it.each([
      'https://example.com',
      'http://example.com',
      'ws://example.com',
      'wss://example.com/path?x=1',
      'file:///tmp/foo',
    ])('returns true for the valid URL %p', (url) => {
      expect(validateUrl(url)).toBe(true);
    });

    it.each(['not a url', '', 'http://', '://no-scheme'])(
      'returns false for the invalid URL %p',
      (url) => {
        expect(validateUrl(url)).toBe(false);
      },
    );

    it('returns false for non-string inputs', () => {
      expect(validateUrl(undefined)).toBe(false);
      expect(validateUrl(null)).toBe(false);
      expect(validateUrl(123)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // validateWebSocketUrl — only ws:// or wss:// schemes are accepted.
  // -------------------------------------------------------------------------
  describe('validateWebSocketUrl', () => {
    it.each(['ws://localhost:8080', 'wss://example.com/socket'])(
      'returns true for %p',
      (url) => {
        expect(validateWebSocketUrl(url)).toBe(true);
      },
    );

    it.each([
      'http://example.com',
      'https://example.com',
      'WS://example.com', // case-sensitive prefix check
      'ftp://example.com',
    ])('returns false for non-ws scheme %p', (url) => {
      expect(validateWebSocketUrl(url)).toBe(false);
    });

    it.each([null, undefined, '', 0, false, 42, {}])(
      'returns false for non-string-or-empty input %p',
      (value) => {
        expect(validateWebSocketUrl(value)).toBe(false);
      },
    );
  });

  // -------------------------------------------------------------------------
  // validateUUID — strict v4 only.
  // -------------------------------------------------------------------------
  describe('validateUUID', () => {
    it.each([
      '550e8400-e29b-41d4-a716-446655440000',
      'F47AC10B-58CC-4372-A567-0E02B2C3D479', // uppercase, valid v4
      '123e4567-e89b-42d3-a456-426614174000',
    ])('returns true for valid v4 UUID %p', (uuid) => {
      expect(validateUUID(uuid)).toBe(true);
    });

    it.each([
      'not-a-uuid',
      '550e8400-e29b-31d4-a716-446655440000', // version 3 — must fail (regex requires "4xxx")
      '550e8400-e29b-41d4-c716-446655440000', // bad variant nibble (must be 8/9/a/b)
      '550e8400e29b41d4a716446655440000', // missing dashes
      '',
    ])('returns false for invalid UUID %p', (uuid) => {
      expect(validateUUID(uuid)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // validateEmail — basic shape only.
  // -------------------------------------------------------------------------
  describe('validateEmail', () => {
    it.each(['user@example.com', 'first.last+tag@sub.example.co.uk'])(
      'returns true for %p',
      (email) => {
        expect(validateEmail(email)).toBe(true);
      },
    );

    it.each([
      'no-at-sign',
      'two@@example.com',
      'spaces in@example.com',
      'user@example',
      '@example.com',
      'user@.com',
      '',
    ])('returns false for %p', (email) => {
      expect(validateEmail(email)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // validatePhone — accepts digits, spaces, dashes, parentheses, leading '+'.
  // -------------------------------------------------------------------------
  describe('validatePhone', () => {
    it.each([
      '+55 11 91234-5678',
      '(11) 91234 5678',
      '5511912345678',
      '+1-202-555-0182',
    ])('returns true for %p', (phone) => {
      expect(validatePhone(phone)).toBe(true);
    });

    it.each(['', 'abc', '12a34', '+ +', 'phone: 1234'])(
      'returns false for %p',
      (phone) => {
        expect(validatePhone(phone)).toBe(false);
      },
    );
  });

  // -------------------------------------------------------------------------
  // sanitizeText — non-string -> '', otherwise trim, strip < and >, cap at 5000.
  // -------------------------------------------------------------------------
  describe('sanitizeText', () => {
    it.each([null, undefined, 123, {}, []])(
      'returns empty string for non-string input %p',
      (value) => {
        expect(sanitizeText(value)).toBe('');
      },
    );

    it('trims whitespace', () => {
      expect(sanitizeText('   hello   ')).toBe('hello');
    });

    it('strips < and > characters', () => {
      expect(sanitizeText('hello <script>alert(1)</script>')).toBe(
        'hello scriptalert(1)/script',
      );
    });

    it('truncates inputs longer than 5000 characters', () => {
      const long = 'a'.repeat(6000);
      const out = sanitizeText(long);
      expect(out).toHaveLength(5000);
      expect(out).toBe('a'.repeat(5000));
    });

    it('returns the same string when already clean and short', () => {
      expect(sanitizeText('clean text')).toBe('clean text');
    });

    it('returns an empty string for an empty input', () => {
      expect(sanitizeText('')).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // validateFileType — list-membership check with defensive guards.
  // -------------------------------------------------------------------------
  describe('validateFileType', () => {
    const allowed = ['image/png', 'image/jpeg'];

    it('returns true when mimeType is in the list', () => {
      expect(validateFileType('image/png', allowed)).toBe(true);
    });

    it('returns false when mimeType is not in the list', () => {
      expect(validateFileType('application/zip', allowed)).toBe(false);
    });

    it('returns false when mimeType is falsy', () => {
      expect(validateFileType('', allowed)).toBe(false);
      expect(validateFileType(null, allowed)).toBe(false);
      expect(validateFileType(undefined, allowed)).toBe(false);
    });

    it('returns false when allowedTypes is not an array', () => {
      expect(validateFileType('image/png', null)).toBe(false);
      expect(validateFileType('image/png', undefined)).toBe(false);
      expect(validateFileType('image/png', 'image/png')).toBe(false);
      expect(validateFileType('image/png', { 'image/png': true })).toBe(false);
    });

    it('returns false on an empty allowed list', () => {
      expect(validateFileType('image/png', [])).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // validateFileSize — size in (0, maxSize] with strict numeric guards.
  // -------------------------------------------------------------------------
  describe('validateFileSize', () => {
    it('returns true when size is within bounds', () => {
      expect(validateFileSize(100, 1024)).toBe(true);
    });

    it('returns true at exactly the maxSize boundary', () => {
      expect(validateFileSize(1024, 1024)).toBe(true);
    });

    it('returns false when size exceeds maxSize', () => {
      expect(validateFileSize(2048, 1024)).toBe(false);
    });

    it('returns false when size is zero or negative', () => {
      expect(validateFileSize(0, 1024)).toBe(false);
      expect(validateFileSize(-1, 1024)).toBe(false);
    });

    it.each([
      ['size as string', '100', 1024],
      ['size as null', null, 1024],
      ['size as undefined', undefined, 1024],
      ['maxSize as string', 100, '1024'],
      ['maxSize as null', 100, null],
      ['maxSize as undefined', 100, undefined],
    ])('returns false when %s', (_label, size, max) => {
      expect(validateFileSize(size, max)).toBe(false);
    });
  });
});
