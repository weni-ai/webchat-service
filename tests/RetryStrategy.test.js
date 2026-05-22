import RetryStrategy from '../src/network/RetryStrategy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStrategy(config = {}) {
  return new RetryStrategy(config);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RetryStrategy', () => {
  let randomSpy;

  beforeEach(() => {
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // A. constructor
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('applies the documented defaults when no config is provided', () => {
      const strategy = createStrategy();

      expect(strategy.config).toEqual({
        baseDelay: 1000,
        maxDelay: 30000,
        factor: 2,
        jitter: true,
        maxJitter: 1000,
      });
    });

    it('also accepts being instantiated with zero arguments', () => {
      const strategy = new RetryStrategy();

      expect(strategy.config.baseDelay).toBe(1000);
      expect(strategy.attempts).toBe(0);
    });

    it('honors per-knob overrides for baseDelay, maxDelay, factor and maxJitter', () => {
      const strategy = createStrategy({
        baseDelay: 250,
        maxDelay: 5000,
        factor: 3,
        maxJitter: 500,
      });

      expect(strategy.config.baseDelay).toBe(250);
      expect(strategy.config.maxDelay).toBe(5000);
      expect(strategy.config.factor).toBe(3);
      expect(strategy.config.maxJitter).toBe(500);
    });

    it('defaults jitter to true when the option is omitted', () => {
      expect(createStrategy().config.jitter).toBe(true);
    });

    it('keeps jitter true when explicitly set to true', () => {
      expect(createStrategy({ jitter: true }).config.jitter).toBe(true);
    });

    it('disables jitter when explicitly set to false', () => {
      expect(createStrategy({ jitter: false }).config.jitter).toBe(false);
    });

    it('lets the trailing ...config spread re-apply caller-provided falsy values (baseDelay=0 stays 0)', () => {
      // Documents the gotcha exploited at src/index.js:105, where the caller
      // adds an `|| DEFAULTS.RECONNECT_INTERVAL` guard at the call site
      // because the constructor will NOT clamp an explicit 0 back to 1000.
      const strategy = createStrategy({ baseDelay: 0 });

      expect(strategy.config.baseDelay).toBe(0);
    });

    it('lets the trailing ...config spread re-apply caller-provided null values', () => {
      const strategy = createStrategy({ maxDelay: null });

      expect(strategy.config.maxDelay).toBeNull();
    });

    it('initializes the attempt counter to 0', () => {
      expect(createStrategy().attempts).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // B. getDelay()
  // -------------------------------------------------------------------------
  describe('getDelay()', () => {
    it('returns baseDelay for attempt 0 when jitter contribution is zeroed out', () => {
      const strategy = createStrategy({ baseDelay: 1000 });

      expect(strategy.getDelay()).toBe(1000);
    });

    it('grows exponentially as baseDelay * factor^attempt', () => {
      const strategy = createStrategy({
        baseDelay: 1000,
        factor: 2,
        maxDelay: 60000,
      });

      expect(strategy.getDelay(0)).toBe(1000);
      expect(strategy.getDelay(1)).toBe(2000);
      expect(strategy.getDelay(2)).toBe(4000);
      expect(strategy.getDelay(3)).toBe(8000);
      expect(strategy.getDelay(4)).toBe(16000);
      expect(strategy.getDelay(5)).toBe(32000);
    });

    it('caps the delay at maxDelay once the exponential value would exceed it', () => {
      const strategy = createStrategy({
        baseDelay: 1000,
        factor: 2,
        maxDelay: 30000,
      });

      expect(strategy.getDelay(4)).toBe(16000);
      expect(strategy.getDelay(5)).toBe(30000);
      expect(strategy.getDelay(10)).toBe(30000);
    });

    it('uses the explicit attempt argument independently of the internal counter', () => {
      const strategy = createStrategy({ baseDelay: 1000 });
      strategy.attempts = 7;

      expect(strategy.getDelay(0)).toBe(1000);
      expect(strategy.attempts).toBe(7);
    });

    it('falls back to the internal counter when attempt is null', () => {
      const strategy = createStrategy({ baseDelay: 1000 });
      strategy.attempts = 2;

      expect(strategy.getDelay(null)).toBe(4000);
    });

    it('falls back to the internal counter when attempt is omitted', () => {
      const strategy = createStrategy({ baseDelay: 1000 });
      strategy.attempts = 3;

      expect(strategy.getDelay()).toBe(8000);
    });

    it('returns an integer (Math.floor) even when jitter produces a fractional value', () => {
      randomSpy.mockReturnValue(0.1234);
      const strategy = createStrategy({ baseDelay: 1000 });

      const delay = strategy.getDelay(0);

      expect(Number.isInteger(delay)).toBe(true);
      expect(delay).toBe(1123);
    });

    it('returns the raw capped delay with no randomness when jitter is disabled', () => {
      randomSpy.mockReturnValue(0.5);
      const strategy = createStrategy({
        baseDelay: 1000,
        factor: 2,
        maxDelay: 30000,
        jitter: false,
      });

      expect(strategy.getDelay(0)).toBe(1000);
      expect(strategy.getDelay(3)).toBe(8000);
      expect(strategy.getDelay(10)).toBe(30000);
      expect(randomSpy).not.toHaveBeenCalled();
    });

    it('caps the jitter contribution at maxJitter when delay exceeds maxJitter', () => {
      randomSpy.mockReturnValue(0.5);
      const strategy = createStrategy({
        baseDelay: 2000,
        maxJitter: 1000,
      });

      // delay = 2000, min(2000, 1000) = 1000, jitter = 0.5 * 1000 = 500
      expect(strategy.getDelay(0)).toBe(2500);
    });

    it('scales the jitter contribution by delay when delay is smaller than maxJitter', () => {
      randomSpy.mockReturnValue(0.5);
      const strategy = createStrategy({
        baseDelay: 100,
        maxJitter: 1000,
      });

      // delay = 100, min(100, 1000) = 100, jitter = 0.5 * 100 = 50
      expect(strategy.getDelay(0)).toBe(150);
    });
  });

  // -------------------------------------------------------------------------
  // C. next()
  // -------------------------------------------------------------------------
  describe('next()', () => {
    it('returns the same value getDelay() would return for the current attempt', () => {
      const strategy = createStrategy({ baseDelay: 1000 });

      const preview = strategy.getDelay();
      const actual = strategy.next();

      expect(actual).toBe(preview);
    });

    it('increments the attempt counter by one per call', () => {
      const strategy = createStrategy();

      strategy.next();
      strategy.next();
      strategy.next();

      expect(strategy.getAttempts()).toBe(3);
    });

    it('produces an exponentially growing sequence across successive calls', () => {
      const strategy = createStrategy({
        baseDelay: 1000,
        factor: 2,
        maxDelay: 60000,
      });

      expect(strategy.next()).toBe(1000);
      expect(strategy.next()).toBe(2000);
      expect(strategy.next()).toBe(4000);
      expect(strategy.next()).toBe(8000);
    });
  });

  // -------------------------------------------------------------------------
  // D. reset()
  // -------------------------------------------------------------------------
  describe('reset()', () => {
    it('sets the attempt counter back to 0', () => {
      const strategy = createStrategy();
      strategy.next();
      strategy.next();

      strategy.reset();

      expect(strategy.getAttempts()).toBe(0);
    });

    it('returns baseDelay again from next() after a reset', () => {
      const strategy = createStrategy({ baseDelay: 1000 });
      strategy.next();
      strategy.next();
      strategy.next();

      strategy.reset();

      expect(strategy.next()).toBe(1000);
    });

    it('is a no-op when called on a fresh instance', () => {
      const strategy = createStrategy();

      expect(() => strategy.reset()).not.toThrow();
      expect(strategy.getAttempts()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // E. getAttempts()
  // -------------------------------------------------------------------------
  describe('getAttempts()', () => {
    it('returns 0 on a fresh instance', () => {
      expect(createStrategy().getAttempts()).toBe(0);
    });

    it('reflects the increments from next()', () => {
      const strategy = createStrategy();

      strategy.next();
      strategy.next();

      expect(strategy.getAttempts()).toBe(2);
    });

    it('reflects reset()', () => {
      const strategy = createStrategy();
      strategy.next();
      strategy.next();
      strategy.reset();

      expect(strategy.getAttempts()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // F. shouldRetry()
  // -------------------------------------------------------------------------
  describe('shouldRetry()', () => {
    it('returns true while attempts are below maxAttempts', () => {
      const strategy = createStrategy();

      expect(strategy.shouldRetry(3)).toBe(true);

      strategy.next();
      expect(strategy.shouldRetry(3)).toBe(true);

      strategy.next();
      expect(strategy.shouldRetry(3)).toBe(true);
    });

    it('returns false at the exact boundary attempts === maxAttempts', () => {
      const strategy = createStrategy();
      strategy.next();
      strategy.next();
      strategy.next();

      expect(strategy.shouldRetry(3)).toBe(false);
    });

    it('returns false once attempts has exceeded maxAttempts', () => {
      const strategy = createStrategy();
      strategy.next();
      strategy.next();
      strategy.next();
      strategy.next();

      expect(strategy.shouldRetry(3)).toBe(false);
    });

    it('returns false immediately when maxAttempts is 0', () => {
      expect(createStrategy().shouldRetry(0)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // G. getDelaySequence()
  // -------------------------------------------------------------------------
  describe('getDelaySequence()', () => {
    it('returns an empty array for maxAttempts = 0', () => {
      expect(createStrategy().getDelaySequence(0)).toEqual([]);
    });

    it('returns an array of length maxAttempts', () => {
      expect(createStrategy().getDelaySequence(5)).toHaveLength(5);
    });

    it('matches getDelay(i) for i = 0..maxAttempts-1', () => {
      const strategy = createStrategy({
        baseDelay: 1000,
        factor: 2,
        maxDelay: 30000,
      });

      expect(strategy.getDelaySequence(6)).toEqual([
        1000, 2000, 4000, 8000, 16000, 30000,
      ]);
    });

    it('does not mutate the internal attempt counter', () => {
      const strategy = createStrategy();

      strategy.getDelaySequence(10);

      expect(strategy.getAttempts()).toBe(0);
    });
  });
});
