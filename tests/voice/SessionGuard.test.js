import { SessionGuard } from '../../src/modules/voice/SessionGuard';

describe('SessionGuard', () => {
  let guard;
  let callbacks;

  beforeEach(() => {
    jest.useFakeTimers();
    callbacks = {
      onTimeout: jest.fn(),
      onIdle: jest.fn(),
      onHidden: jest.fn(),
      onVisible: jest.fn(),
      onHiddenExpired: jest.fn(),
    };
    guard = null;
  });

  afterEach(() => {
    guard?.destroy();
    jest.useRealTimers();
  });

  // -- Constructor defaults --------------------------------------------------

  describe('constructor', () => {
    it('accepts custom durations', () => {
      guard = new SessionGuard({
        maxSessionDurationMs: 5000,
        idleTimeoutMs: 2000,
        hiddenGracePeriodMs: 1000,
      });
      guard.start(callbacks);

      jest.advanceTimersByTime(5000);
      expect(callbacks.onTimeout).toHaveBeenCalledTimes(1);
    });

    it('uses default durations when no options provided', () => {
      guard = new SessionGuard();
      guard.start(callbacks);

      jest.advanceTimersByTime(4 * 60 * 1000);
      expect(callbacks.onIdle).toHaveBeenCalledTimes(1);
    });
  });

  // -- Max session duration --------------------------------------------------

  describe('max session duration', () => {
    it('fires onTimeout after maxSessionDurationMs', () => {
      guard = new SessionGuard({ maxSessionDurationMs: 10000 });
      guard.start(callbacks);

      jest.advanceTimersByTime(9999);
      expect(callbacks.onTimeout).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(callbacks.onTimeout).toHaveBeenCalledTimes(1);
    });

    it('does not fire onTimeout if stopped before expiry', () => {
      guard = new SessionGuard({ maxSessionDurationMs: 10000 });
      guard.start(callbacks);

      jest.advanceTimersByTime(5000);
      guard.stop();

      jest.advanceTimersByTime(10000);
      expect(callbacks.onTimeout).not.toHaveBeenCalled();
    });
  });

  // -- Idle timeout ----------------------------------------------------------

  describe('idle timeout', () => {
    it('fires onIdle after idleTimeoutMs of inactivity', () => {
      guard = new SessionGuard({ idleTimeoutMs: 3000 });
      guard.start(callbacks);

      jest.advanceTimersByTime(3000);
      expect(callbacks.onIdle).toHaveBeenCalledTimes(1);
    });

    it('resets idle timer on recordActivity', () => {
      guard = new SessionGuard({ idleTimeoutMs: 3000 });
      guard.start(callbacks);

      jest.advanceTimersByTime(2000);
      guard.recordActivity();

      jest.advanceTimersByTime(2000);
      expect(callbacks.onIdle).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);
      expect(callbacks.onIdle).toHaveBeenCalledTimes(1);
    });

    it('ignores recordActivity when not active', () => {
      guard = new SessionGuard({ idleTimeoutMs: 3000 });
      guard.start(callbacks);
      guard.stop();

      guard.recordActivity();

      jest.advanceTimersByTime(10000);
      expect(callbacks.onIdle).not.toHaveBeenCalled();
    });
  });

  // -- Visibility change -----------------------------------------------------

  describe('visibility change', () => {
    it('fires onHidden when tab becomes hidden', () => {
      guard = new SessionGuard({ hiddenGracePeriodMs: 5000 });
      guard.start(callbacks);

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(callbacks.onHidden).toHaveBeenCalledTimes(1);
    });

    it('fires onVisible when tab becomes visible again', () => {
      guard = new SessionGuard({ hiddenGracePeriodMs: 5000 });
      guard.start(callbacks);

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(callbacks.onVisible).toHaveBeenCalledTimes(1);
    });

    it('fires onHiddenExpired after grace period', () => {
      guard = new SessionGuard({ hiddenGracePeriodMs: 5000 });
      guard.start(callbacks);

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      jest.advanceTimersByTime(5000);
      expect(callbacks.onHiddenExpired).toHaveBeenCalledTimes(1);
    });

    it('cancels grace timer if tab becomes visible', () => {
      guard = new SessionGuard({ hiddenGracePeriodMs: 5000 });
      guard.start(callbacks);

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      jest.advanceTimersByTime(3000);

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      jest.advanceTimersByTime(5000);
      expect(callbacks.onHiddenExpired).not.toHaveBeenCalled();
    });

    it('does not fire duplicate onHidden for repeated hidden events', () => {
      guard = new SessionGuard({ hiddenGracePeriodMs: 5000 });
      guard.start(callbacks);

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));

      expect(callbacks.onHidden).toHaveBeenCalledTimes(1);
    });

    it('does not respond to visibility after stop', () => {
      guard = new SessionGuard({ hiddenGracePeriodMs: 5000 });
      guard.start(callbacks);
      guard.stop();

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(callbacks.onHidden).not.toHaveBeenCalled();
    });
  });

  // -- stop & destroy --------------------------------------------------------

  describe('stop()', () => {
    it('clears all pending timers', () => {
      guard = new SessionGuard({
        maxSessionDurationMs: 10000,
        idleTimeoutMs: 5000,
      });
      guard.start(callbacks);
      guard.stop();

      jest.advanceTimersByTime(20000);

      expect(callbacks.onTimeout).not.toHaveBeenCalled();
      expect(callbacks.onIdle).not.toHaveBeenCalled();
    });
  });

  describe('destroy()', () => {
    it('calls stop and nullifies callbacks', () => {
      guard = new SessionGuard({
        maxSessionDurationMs: 10000,
      });
      guard.start(callbacks);
      guard.destroy();

      jest.advanceTimersByTime(20000);
      expect(callbacks.onTimeout).not.toHaveBeenCalled();
    });
  });
});
