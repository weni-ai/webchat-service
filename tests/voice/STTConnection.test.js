import STTConnection from "../../src/modules/voice/STTConnection";
import {
  VoiceError,
  VoiceErrorCode,
  getSTTMessageErrorCode,
} from "../../src/modules/voice/errors";

// ---------------------------------------------------------------------------
// Mock config helpers
// ---------------------------------------------------------------------------

jest.mock("../../src/modules/voice/config", () => ({
  buildSTTWebSocketURL: jest.fn(() => "wss://mock.elevenlabs.io/v1/stt"),
}));

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

let wsInstances = [];

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.sentMessages = [];
    wsInstances.push(this);
  }

  send(data) {
    this.sentMessages.push(JSON.parse(data));
  }

  close(code, reason) {
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ code: code || 1000, reason: reason || "" });
    }
  }

  simulateOpen() {
    this.readyState = 1;
    if (this.onopen) this.onopen();
  }

  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  simulateError(err) {
    if (this.onerror) {
      this.onerror({ error: err });
    }
  }

  simulateClose(code = 1000, reason = "") {
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockConfig = {
  sttModel: "scribe_v2_realtime",
  silenceThreshold: 1.5,
  sttVadThreshold: 0.4,
  minSpeechDuration: 100,
  minSilenceDuration: 100,
  languageCode: "en",
};
const mockToken = "test-token-123";

function getLatestWs() {
  return wsInstances[wsInstances.length - 1];
}

function connectWithSession(stt) {
  const promise = stt.connect();
  const ws = getLatestWs();
  ws.simulateOpen();
  ws.simulateMessage({ message_type: "session_started", session_id: "sess-1" });
  return promise;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("STTConnection", () => {
  let stt;

  beforeEach(() => {
    jest.useFakeTimers();
    wsInstances = [];
    global.WebSocket = MockWebSocket;
    stt = new STTConnection(mockConfig, mockToken);
  });

  afterEach(() => {
    stt.destroy();
    jest.useRealTimers();
    delete global.WebSocket;
  });

  // -- connect --------------------------------------------------------------

  describe("connect()", () => {
    it("creates a WebSocket and resolves on session_started", async () => {
      const promise = stt.connect();
      const ws = getLatestWs();

      ws.simulateOpen();
      ws.simulateMessage({
        message_type: "session_started",
        session_id: "sess-1",
      });

      await expect(promise).resolves.toBeUndefined();
      expect(stt.isConnected()).toBe(true);
    });

    it("resolves immediately if already connected", async () => {
      await connectWithSession(stt);
      await expect(stt.connect()).resolves.toBeUndefined();
    });

    it("rejects after 10s timeout", async () => {
      const promise = stt.connect();
      jest.advanceTimersByTime(10000);
      await expect(promise).rejects.toMatchObject({
        code: VoiceErrorCode.STT_CONNECTION_FAILED,
      });
    });

    it("rejects on error message before session_started", async () => {
      const promise = stt.connect();
      const ws = getLatestWs();
      ws.simulateOpen();
      ws.simulateMessage({ message_type: "auth_error", error: "bad token" });

      await expect(promise).rejects.toMatchObject({
        code: VoiceErrorCode.TOKEN_EXPIRED,
      });
    });

    it("rejects when WebSocket constructor throws", () => {
      global.WebSocket = function () {
        throw new Error("network error");
      };
      const stt2 = new STTConnection(mockConfig, mockToken);
      expect(stt2.connect()).rejects.toBeInstanceOf(VoiceError);
    });
  });

  // -- sendAudio ------------------------------------------------------------

  describe("sendAudio()", () => {
    it("sends JSON with message_type, audio_base_64, commit, sample_rate", async () => {
      await connectWithSession(stt);
      const ws = getLatestWs();

      stt.sendAudio("AQID", 16000, false);

      expect(ws.sentMessages).toContainEqual({
        message_type: "input_audio_chunk",
        audio_base_64: "AQID",
        commit: false,
        sample_rate: 16000,
      });
    });

    it("includes commit:true when requested", async () => {
      await connectWithSession(stt);
      const ws = getLatestWs();

      stt.sendAudio("data", 16000, true);

      expect(ws.sentMessages[0].commit).toBe(true);
    });

    it("is a no-op when not connected", () => {
      expect(() => stt.sendAudio("data", 16000)).not.toThrow();
    });
  });

  // -- commit ---------------------------------------------------------------

  describe("commit()", () => {
    it("sends empty audio with commit:true", async () => {
      await connectWithSession(stt);
      const ws = getLatestWs();

      stt.commit();

      expect(ws.sentMessages).toContainEqual({
        message_type: "input_audio_chunk",
        audio_base_64: "",
        commit: true,
        sample_rate: 16000,
      });
    });

    it("is a no-op when not connected", () => {
      expect(() => stt.commit()).not.toThrow();
    });
  });

  // -- Message handling (all types) -----------------------------------------

  describe("message handling", () => {
    it('session_started → emits "session"', async () => {
      const handler = jest.fn();
      stt.on("session", handler);

      await connectWithSession(stt);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "sess-1" }),
      );
    });

    it('partial_transcript → emits "partial"', async () => {
      await connectWithSession(stt);
      const handler = jest.fn();
      stt.on("partial", handler);

      getLatestWs().simulateMessage({
        message_type: "partial_transcript",
        text: "hello",
      });

      expect(handler).toHaveBeenCalledWith({ text: "hello" });
    });

    it('committed_transcript → emits "committed"', async () => {
      await connectWithSession(stt);
      const handler = jest.fn();
      stt.on("committed", handler);

      getLatestWs().simulateMessage({
        message_type: "committed_transcript",
        text: "hello world",
      });

      expect(handler).toHaveBeenCalledWith({ text: "hello world" });
    });

    it('committed_transcript_with_timestamps → emits "committed" with extra fields', async () => {
      await connectWithSession(stt);
      const handler = jest.fn();
      stt.on("committed", handler);

      getLatestWs().simulateMessage({
        message_type: "committed_transcript_with_timestamps",
        text: "hi",
        language_code: "en",
        words: [{ text: "hi", start: 0, end: 0.5 }],
      });

      expect(handler).toHaveBeenCalledWith({
        text: "hi",
        languageCode: "en",
        words: [{ text: "hi", start: 0, end: 0.5 }],
      });
    });

    it("insufficient_audio_activity → no error emitted", async () => {
      await connectWithSession(stt);
      const handler = jest.fn();
      stt.on("error", handler);

      getLatestWs().simulateMessage({
        message_type: "insufficient_audio_activity",
      });

      expect(handler).not.toHaveBeenCalled();
    });

    const errorMessageTypes = [
      "error",
      "auth_error",
      "rate_limited",
      "quota_exceeded",
      "commit_throttled",
      "input_error",
      "chunk_size_exceeded",
      "transcriber_error",
      "queue_overflow",
      "resource_exhausted",
      "session_time_limit_exceeded",
      "unaccepted_terms",
    ];

    it.each(errorMessageTypes)(
      '%s → emits "error" with correct VoiceErrorCode',
      async (msgType) => {
        await connectWithSession(stt);
        const handler = jest.fn();
        stt.on("error", handler);

        getLatestWs().simulateMessage({
          message_type: msgType,
          error: `${msgType} detail`,
        });

        expect(handler).toHaveBeenCalledTimes(1);
        const emitted = handler.mock.calls[0][0];
        expect(emitted).toBeInstanceOf(VoiceError);
        expect(emitted.code).toBe(getSTTMessageErrorCode(msgType));
      },
    );

    it("ignores unknown message types", async () => {
      await connectWithSession(stt);
      const handler = jest.fn();
      stt.on("error", handler);

      getLatestWs().simulateMessage({ message_type: "some_unknown_type" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("ignores unparseable JSON", async () => {
      await connectWithSession(stt);
      const ws = getLatestWs();
      const handler = jest.fn();
      stt.on("error", handler);

      ws.onmessage({ data: "not json{{{" });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -- isConnected ----------------------------------------------------------

  describe("isConnected()", () => {
    it("returns true after successful connect", async () => {
      await connectWithSession(stt);
      expect(stt.isConnected()).toBe(true);
    });

    it("returns false before connect", () => {
      expect(stt.isConnected()).toBe(false);
    });

    it("returns false after disconnect", async () => {
      await connectWithSession(stt);
      stt.disconnect();
      expect(stt.isConnected()).toBe(false);
    });
  });

  // -- disconnect -----------------------------------------------------------

  describe("disconnect()", () => {
    it("closes WebSocket with code 1000", async () => {
      await connectWithSession(stt);
      const ws = getLatestWs();
      const closeSpy = jest.spyOn(ws, "close");

      stt.disconnect();

      expect(closeSpy).toHaveBeenCalledWith(1000, "Client disconnect");
      expect(stt.isConnected()).toBe(false);
    });

    it("is safe to call when not connected", () => {
      expect(() => stt.disconnect()).not.toThrow();
    });
  });

  // -- WebSocket events -----------------------------------------------------

  describe("WebSocket onerror", () => {
    it("emits error event", async () => {
      const handler = jest.fn();
      stt.on("error", handler);

      const promise = stt.connect();
      const ws = getLatestWs();

      const err = new Error("connection failed");
      ws.simulateError(err);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toBeInstanceOf(VoiceError);

      ws.simulateClose(1006);
      await promise.catch(() => {});
    });
  });

  describe("WebSocket onclose", () => {
    it("emits close with code and reason", async () => {
      await connectWithSession(stt);
      const handler = jest.fn();
      stt.on("close", handler);

      getLatestWs().simulateClose(1001, "going away");

      expect(handler).toHaveBeenCalledWith({
        code: 1001,
        reason: "going away",
      });
    });
  });

  // -- destroy --------------------------------------------------------------

  describe("destroy()", () => {
    it("disconnects and removes all listeners", async () => {
      await connectWithSession(stt);
      const handler = jest.fn();
      stt.on("error", handler);

      stt.destroy();

      expect(stt.isConnected()).toBe(false);
      stt.emit("error", "test");
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
