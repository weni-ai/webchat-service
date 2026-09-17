import {
  VoiceErrorCode,
  VoiceError,
  createVoiceError,
  getMediaErrorCode,
  getWebSocketErrorCode,
  getSTTMessageErrorCode,
  getTTSErrorCode,
} from "../../src/modules/voice/errors";

describe("voice/errors", () => {
  describe("VoiceErrorCode", () => {
    it("contains all expected codes as string values", () => {
      const expectedCodes = [
        "MICROPHONE_PERMISSION_DENIED",
        "MICROPHONE_NOT_FOUND",
        "BROWSER_NOT_SUPPORTED",
        "STT_CONNECTION_FAILED",
        "STT_AUTH_FAILED",
        "STT_TRANSCRIPTION_FAILED",
        "TTS_CONNECTION_FAILED",
        "TTS_AUTH_FAILED",
        "TTS_GENERATION_FAILED",
        "NETWORK_ERROR",
        "TOKEN_EXPIRED",
        "RATE_LIMITED",
        "SESSION_TIMEOUT",
        "SESSION_IDLE_TIMEOUT",
        "UNKNOWN_ERROR",
      ];

      expectedCodes.forEach((code) => {
        expect(VoiceErrorCode[code]).toBe(code);
      });

      expect(Object.keys(VoiceErrorCode)).toHaveLength(expectedCodes.length);
    });
  });

  describe("VoiceError", () => {
    it("sets code, message, suggestion, recoverable, and originalError", () => {
      const orig = new Error("original");
      const err = new VoiceError(
        VoiceErrorCode.NETWORK_ERROR,
        "custom msg",
        orig,
      );

      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("VoiceError");
      expect(err.code).toBe("NETWORK_ERROR");
      expect(err.message).toBe("custom msg");
      expect(err.suggestion).toBe(
        "Please check your internet connection",
      );
      expect(err.recoverable).toBe(true);
      expect(err.originalError).toBe(orig);
    });

    it("uses default metadata message when no custom message provided", () => {
      const err = new VoiceError(VoiceErrorCode.MICROPHONE_NOT_FOUND);
      expect(err.message).toBe("No microphone was found");
      expect(err.recoverable).toBe(false);
      expect(err.originalError).toBeNull();
    });

    it("falls back to UNKNOWN_ERROR metadata for unrecognized code", () => {
      const err = new VoiceError("DOES_NOT_EXIST");
      expect(err.suggestion).toBe("Please try again");
      expect(err.recoverable).toBe(true);
    });

    it("toJSON returns serializable object", () => {
      const err = new VoiceError(VoiceErrorCode.TOKEN_EXPIRED, "expired");
      const json = err.toJSON();

      expect(json).toEqual({
        code: "TOKEN_EXPIRED",
        message: "expired",
        suggestion: "Reconnecting...",
        recoverable: true,
      });
    });
  });

  describe("createVoiceError", () => {
    it("creates VoiceError from an Error object", () => {
      const original = new Error("something broke");
      const err = createVoiceError(
        VoiceErrorCode.STT_TRANSCRIPTION_FAILED,
        original,
      );

      expect(err).toBeInstanceOf(VoiceError);
      expect(err.code).toBe("STT_TRANSCRIPTION_FAILED");
      expect(err.message).toBe("something broke");
      expect(err.originalError).toBe(original);
    });

    it("creates VoiceError from a string message", () => {
      const err = createVoiceError(
        VoiceErrorCode.TTS_GENERATION_FAILED,
        "manual msg",
      );

      expect(err).toBeInstanceOf(VoiceError);
      expect(err.code).toBe("TTS_GENERATION_FAILED");
      expect(err.message).toBe("manual msg");
      expect(err.originalError).toBeNull();
    });

    it("creates VoiceError with no second argument", () => {
      const err = createVoiceError(VoiceErrorCode.UNKNOWN_ERROR);
      expect(err.message).toBe("An unexpected error occurred");
    });
  });

  describe("getMediaErrorCode", () => {
    it("maps NotAllowedError → MICROPHONE_PERMISSION_DENIED", () => {
      expect(getMediaErrorCode({ name: "NotAllowedError" })).toBe(
        VoiceErrorCode.MICROPHONE_PERMISSION_DENIED,
      );
    });

    it("maps PermissionDeniedError → MICROPHONE_PERMISSION_DENIED", () => {
      expect(getMediaErrorCode({ name: "PermissionDeniedError" })).toBe(
        VoiceErrorCode.MICROPHONE_PERMISSION_DENIED,
      );
    });

    it("maps NotFoundError → MICROPHONE_NOT_FOUND", () => {
      expect(getMediaErrorCode({ name: "NotFoundError" })).toBe(
        VoiceErrorCode.MICROPHONE_NOT_FOUND,
      );
    });

    it("maps DevicesNotFoundError → MICROPHONE_NOT_FOUND", () => {
      expect(getMediaErrorCode({ name: "DevicesNotFoundError" })).toBe(
        VoiceErrorCode.MICROPHONE_NOT_FOUND,
      );
    });

    it("maps NotSupportedError → BROWSER_NOT_SUPPORTED", () => {
      expect(getMediaErrorCode({ name: "NotSupportedError" })).toBe(
        VoiceErrorCode.BROWSER_NOT_SUPPORTED,
      );
    });

    it("maps unknown error → UNKNOWN_ERROR", () => {
      expect(getMediaErrorCode({ name: "SomethingElse" })).toBe(
        VoiceErrorCode.UNKNOWN_ERROR,
      );
      expect(getMediaErrorCode(null)).toBe(VoiceErrorCode.UNKNOWN_ERROR);
    });
  });

  describe("getWebSocketErrorCode", () => {
    it('maps message containing "401" → TOKEN_EXPIRED', () => {
      expect(getWebSocketErrorCode({ message: "HTTP 401 Unauthorized" })).toBe(
        VoiceErrorCode.TOKEN_EXPIRED,
      );
    });

    it('maps message containing "unauthorized" → TOKEN_EXPIRED', () => {
      expect(getWebSocketErrorCode({ message: "unauthorized access" })).toBe(
        VoiceErrorCode.TOKEN_EXPIRED,
      );
    });

    it('maps message containing "token" → TOKEN_EXPIRED', () => {
      expect(getWebSocketErrorCode({ message: "invalid token" })).toBe(
        VoiceErrorCode.TOKEN_EXPIRED,
      );
    });

    it('maps message containing "429" → RATE_LIMITED', () => {
      expect(getWebSocketErrorCode({ message: "Error 429 too many" })).toBe(
        VoiceErrorCode.RATE_LIMITED,
      );
    });

    it('maps message containing "rate limit" → RATE_LIMITED', () => {
      expect(getWebSocketErrorCode({ message: "rate limit exceeded" })).toBe(
        VoiceErrorCode.RATE_LIMITED,
      );
    });

    it('maps message containing "network" → NETWORK_ERROR', () => {
      expect(getWebSocketErrorCode({ message: "network failure" })).toBe(
        VoiceErrorCode.NETWORK_ERROR,
      );
    });

    it('maps message containing "connection" → NETWORK_ERROR', () => {
      expect(getWebSocketErrorCode({ message: "connection refused" })).toBe(
        VoiceErrorCode.NETWORK_ERROR,
      );
    });

    it("maps unknown message → STT_CONNECTION_FAILED", () => {
      expect(getWebSocketErrorCode({ message: "something unknown" })).toBe(
        VoiceErrorCode.STT_CONNECTION_FAILED,
      );
      expect(getWebSocketErrorCode(null)).toBe(
        VoiceErrorCode.STT_CONNECTION_FAILED,
      );
    });
  });

  describe("getSTTMessageErrorCode", () => {
    const transcriptionFailedTypes = [
      "error",
      "input_error",
      "chunk_size_exceeded",
      "transcriber_error",
    ];

    transcriptionFailedTypes.forEach((type) => {
      it(`maps "${type}" → STT_TRANSCRIPTION_FAILED`, () => {
        expect(getSTTMessageErrorCode(type)).toBe(
          VoiceErrorCode.STT_TRANSCRIPTION_FAILED,
        );
      });
    });

    it('maps "auth_error" → TOKEN_EXPIRED', () => {
      expect(getSTTMessageErrorCode("auth_error")).toBe(
        VoiceErrorCode.TOKEN_EXPIRED,
      );
    });

    const rateLimitedTypes = [
      "rate_limited",
      "quota_exceeded",
      "commit_throttled",
      "queue_overflow",
    ];

    rateLimitedTypes.forEach((type) => {
      it(`maps "${type}" → RATE_LIMITED`, () => {
        expect(getSTTMessageErrorCode(type)).toBe(VoiceErrorCode.RATE_LIMITED);
      });
    });

    const connectionFailedTypes = [
      "resource_exhausted",
      "session_time_limit_exceeded",
    ];

    connectionFailedTypes.forEach((type) => {
      it(`maps "${type}" → STT_CONNECTION_FAILED`, () => {
        expect(getSTTMessageErrorCode(type)).toBe(
          VoiceErrorCode.STT_CONNECTION_FAILED,
        );
      });
    });

    it('maps "unaccepted_terms" → UNKNOWN_ERROR', () => {
      expect(getSTTMessageErrorCode("unaccepted_terms")).toBe(
        VoiceErrorCode.UNKNOWN_ERROR,
      );
    });

    it("maps unknown message_type → UNKNOWN_ERROR", () => {
      expect(getSTTMessageErrorCode("something_else")).toBe(
        VoiceErrorCode.UNKNOWN_ERROR,
      );
    });
  });

  describe("getTTSErrorCode", () => {
    it("maps WebSocket close code 1008 → TTS_AUTH_FAILED", () => {
      expect(getTTSErrorCode({ code: 1008 })).toBe(
        VoiceErrorCode.TTS_AUTH_FAILED,
      );
    });

    it("maps code 401 → TTS_AUTH_FAILED", () => {
      expect(getTTSErrorCode({ code: 401 })).toBe(
        VoiceErrorCode.TTS_AUTH_FAILED,
      );
    });

    it("maps code 429 → RATE_LIMITED", () => {
      expect(getTTSErrorCode({ code: 429 })).toBe(
        VoiceErrorCode.RATE_LIMITED,
      );
    });

    it('maps error with "network" in message → NETWORK_ERROR', () => {
      expect(getTTSErrorCode({ message: "network error" })).toBe(
        VoiceErrorCode.NETWORK_ERROR,
      );
    });

    it('maps error with "connection" in message → NETWORK_ERROR', () => {
      expect(getTTSErrorCode({ message: "connection refused" })).toBe(
        VoiceErrorCode.NETWORK_ERROR,
      );
    });

    it("maps unknown error → TTS_GENERATION_FAILED", () => {
      expect(getTTSErrorCode({ message: "something else" })).toBe(
        VoiceErrorCode.TTS_GENERATION_FAILED,
      );
      expect(getTTSErrorCode({})).toBe(VoiceErrorCode.TTS_GENERATION_FAILED);
    });
  });
});
