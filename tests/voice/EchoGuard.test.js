import { EchoGuard } from "../../src/modules/voice/EchoGuard";

describe("EchoGuard", () => {
  let guard;

  beforeEach(() => {
    jest.useFakeTimers();
    guard = new EchoGuard();
  });

  afterEach(() => {
    guard.destroy();
    jest.useRealTimers();
  });

  describe("initial state", () => {
    it("isGated is false", () => {
      expect(guard.isGated).toBe(false);
    });

    it("isTTSPlaying is false", () => {
      expect(guard.isTTSPlaying).toBe(false);
    });

    it("bargeInThreshold is normal (0.02)", () => {
      expect(guard.bargeInThreshold).toBe(0.02);
    });
  });

  describe("onTTSStarted", () => {
    it("sets isGated to true", () => {
      guard.onTTSStarted();
      expect(guard.isGated).toBe(true);
    });

    it("sets isTTSPlaying to true", () => {
      guard.onTTSStarted();
      expect(guard.isTTSPlaying).toBe(true);
    });

    it("elevates bargeInThreshold to 0.08", () => {
      guard.onTTSStarted();
      expect(guard.bargeInThreshold).toBe(0.08);
    });
  });

  describe("shouldForwardAudio", () => {
    it("returns true when not gated", () => {
      expect(guard.shouldForwardAudio()).toBe(true);
    });

    it("returns false when gated", () => {
      guard.onTTSStarted();
      expect(guard.shouldForwardAudio()).toBe(false);
    });
  });

  describe("onTTSStopped", () => {
    it("sets isTTSPlaying to false immediately", () => {
      guard.onTTSStarted();
      guard.onTTSStopped();
      expect(guard.isTTSPlaying).toBe(false);
    });

    it("keeps isGated true during cooldown", () => {
      guard.onTTSStarted();
      guard.onTTSStopped();
      expect(guard.isGated).toBe(true);
    });

    it("sets isGated to false after cooldown expires", () => {
      guard.onTTSStarted();
      guard.onTTSStopped();
      jest.advanceTimersByTime(250);
      expect(guard.isGated).toBe(false);
    });

    it("restores bargeInThreshold to normal after cooldown", () => {
      guard.onTTSStarted();
      guard.onTTSStopped();
      jest.advanceTimersByTime(250);
      expect(guard.bargeInThreshold).toBe(0.02);
    });

    it("isGated remains true before cooldown expires", () => {
      guard.onTTSStarted();
      guard.onTTSStopped();
      jest.advanceTimersByTime(200);
      expect(guard.isGated).toBe(true);
    });
  });

  describe("onBargeInDetected", () => {
    it("immediately sets isGated to false", () => {
      guard.onTTSStarted();
      guard.onBargeInDetected();
      expect(guard.isGated).toBe(false);
    });

    it("sets isTTSPlaying to false", () => {
      guard.onTTSStarted();
      guard.onBargeInDetected();
      expect(guard.isTTSPlaying).toBe(false);
    });

    it("restores bargeInThreshold to normal", () => {
      guard.onTTSStarted();
      guard.onBargeInDetected();
      expect(guard.bargeInThreshold).toBe(0.02);
    });

    it("bypasses cooldown timer", () => {
      guard.onTTSStarted();
      guard.onTTSStopped();
      guard.onBargeInDetected();
      expect(guard.isGated).toBe(false);
      jest.advanceTimersByTime(500);
      expect(guard.isGated).toBe(false);
    });
  });

  describe("shouldTriggerBargeIn", () => {
    it("returns false when TTS is not playing", () => {
      expect(guard.shouldTriggerBargeIn(true)).toBe(false);
    });

    it("requires consecutive frames to trigger", () => {
      guard.onTTSStarted();
      expect(guard.shouldTriggerBargeIn(true)).toBe(false);
      expect(guard.shouldTriggerBargeIn(true)).toBe(false);
      expect(guard.shouldTriggerBargeIn(true)).toBe(true);
    });

    it("resets counter on no-voice frame", () => {
      guard.onTTSStarted();
      guard.shouldTriggerBargeIn(true);
      guard.shouldTriggerBargeIn(true);
      guard.shouldTriggerBargeIn(false);
      expect(guard.shouldTriggerBargeIn(true)).toBe(false);
    });

    it("does not trigger with fewer than required frames", () => {
      guard.onTTSStarted();
      guard.shouldTriggerBargeIn(true);
      guard.shouldTriggerBargeIn(true);
      guard.shouldTriggerBargeIn(false);
      guard.shouldTriggerBargeIn(true);
      expect(guard.shouldTriggerBargeIn(true)).toBe(false);
    });
  });

  describe("reset", () => {
    it("clears all state to initial values", () => {
      guard.onTTSStarted();
      guard.reset();

      expect(guard.isGated).toBe(false);
      expect(guard.isTTSPlaying).toBe(false);
      expect(guard.bargeInThreshold).toBe(0.02);
    });

    it("cancels pending cooldown timer", () => {
      guard.onTTSStarted();
      guard.onTTSStopped();
      guard.reset();
      expect(guard.isGated).toBe(false);
      jest.advanceTimersByTime(500);
      expect(guard.isGated).toBe(false);
    });
  });

  describe("destroy", () => {
    it("clears state (alias for reset)", () => {
      guard.onTTSStarted();
      guard.destroy();

      expect(guard.isGated).toBe(false);
      expect(guard.isTTSPlaying).toBe(false);
      expect(guard.bargeInThreshold).toBe(0.02);
    });

    it("clears pending timeouts", () => {
      guard.onTTSStarted();
      guard.onTTSStopped();
      guard.destroy();
      jest.advanceTimersByTime(500);
      expect(guard.isGated).toBe(false);
    });
  });

  describe("custom options", () => {
    it("respects custom cooldownMs", () => {
      const custom = new EchoGuard({ cooldownMs: 500 });
      custom.onTTSStarted();
      custom.onTTSStopped();

      jest.advanceTimersByTime(250);
      expect(custom.isGated).toBe(true);

      jest.advanceTimersByTime(250);
      expect(custom.isGated).toBe(false);

      custom.destroy();
    });

    it("respects custom consecutiveFramesRequired", () => {
      const custom = new EchoGuard({ consecutiveFramesRequired: 2 });
      custom.onTTSStarted();
      expect(custom.shouldTriggerBargeIn(true)).toBe(false);
      expect(custom.shouldTriggerBargeIn(true)).toBe(true);

      custom.destroy();
    });

    it("respects custom thresholds", () => {
      const custom = new EchoGuard({
        normalThreshold: 0.05,
        elevatedThreshold: 0.15,
      });

      expect(custom.bargeInThreshold).toBe(0.05);
      custom.onTTSStarted();
      expect(custom.bargeInThreshold).toBe(0.15);

      custom.destroy();
    });
  });
});
