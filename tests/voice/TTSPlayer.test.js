import TTSPlayer from "../../src/modules/voice/TTSPlayer";
import { VoiceError, VoiceErrorCode } from "../../src/modules/voice/errors";

jest.mock("../../src/utils/audioUtils", () => ({
  mergeAudioChunks: jest.fn(() => new ArrayBuffer(8)),
}));

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._sentMessages = [];

    Promise.resolve().then(() => this.onopen?.());
  }

  send(data) {
    this._sentMessages.push(JSON.parse(data));
  }

  close(code, reason) {
    this.readyState = MockWebSocket.CLOSED;
    Promise.resolve().then(() =>
      this.onclose?.({ code: code || 1000, reason }),
    );
  }

  _receiveAudio(base64 = "AAAA") {
    this.onmessage?.({ data: JSON.stringify({ audio: base64 }) });
  }

  _receiveFinal() {
    this.onmessage?.({ data: JSON.stringify({ isFinal: true }) });
  }

  _triggerError() {
    this.onerror?.({});
  }

  _triggerClose(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

// ---------------------------------------------------------------------------
// Browser API mocks
// ---------------------------------------------------------------------------

const createMockBufferSource = () => {
  const source = {
    buffer: null,
    onended: null,
    connect: jest.fn(),
    start: jest.fn(() => {
      Promise.resolve().then(() => source.onended?.());
    }),
    stop: jest.fn(),
  };
  return source;
};

const createMockGainNode = () => ({
  gain: {
    value: 1,
    setValueAtTime: jest.fn(),
    exponentialRampToValueAtTime: jest.fn(),
    cancelScheduledValues: jest.fn(),
  },
  connect: jest.fn(),
});

const createMockAudioContext = () => ({
  currentTime: 0,
  destination: {},
  createBufferSource: jest.fn(() => createMockBufferSource()),
  createGain: jest.fn(() => createMockGainNode()),
  decodeAudioData: jest.fn(() => Promise.resolve({ duration: 1.0 })),
  close: jest.fn(),
});

function installAudioContext() {
  const ctx = createMockAudioContext();
  window.AudioContext = jest.fn(() => ctx);
  window.webkitAudioContext = undefined;
  return ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TTSPlayer (WebSocket)", () => {
  let player;
  let mockCtx;
  let lastWs;

  beforeEach(() => {
    jest.useFakeTimers();
    mockCtx = installAudioContext();

    const wsMock = jest.fn((url) => {
      lastWs = new MockWebSocket(url);
      return lastWs;
    });
    wsMock.OPEN = 1;
    wsMock.CLOSED = 3;
    global.WebSocket = wsMock;

    player = new TTSPlayer();
  });

  afterEach(() => {
    player.destroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
    delete global.WebSocket;
  });

  // -- connect ----------------------------------------------------------------

  describe("connect()", () => {
    it("opens WebSocket and sends init message with blank space", async () => {
      await player.connect("wss://example.com/tts?token=abc");

      expect(global.WebSocket).toHaveBeenCalledWith(
        "wss://example.com/tts?token=abc",
      );
      expect(lastWs._sentMessages[0]).toEqual(
        expect.objectContaining({ text: " " }),
      );
    });

    it("sets generation_config.chunk_length_schedule in init", async () => {
      await player.connect("wss://example.com/tts?token=abc");

      const initMsg = lastWs._sentMessages[0];
      expect(initMsg.generation_config).toEqual({ chunk_length_schedule: [50] });
    });

    it("isConnected() returns true after connect", async () => {
      await player.connect("wss://example.com/tts?token=abc");
      expect(player.isConnected()).toBe(true);
    });

    it("rejects on timeout", async () => {
      const staleWsMock = jest.fn(() => ({
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        send: jest.fn(),
        close: jest.fn(),
        readyState: 0,
      }));
      staleWsMock.OPEN = 1;
      global.WebSocket = staleWsMock;

      const p = player.connect("wss://example.com/tts");
      jest.advanceTimersByTime(11000);
      await expect(p).rejects.toMatchObject({
        code: VoiceErrorCode.TTS_CONNECTION_FAILED,
      });
    });

    it("rejects on auth failure (1008)", async () => {
      const authFailWsMock = jest.fn((url) => {
        const ws = {
          url,
          readyState: 0,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          send: jest.fn(),
          close: jest.fn(),
        };
        Promise.resolve().then(() => {
          ws.readyState = MockWebSocket.CLOSED;
          ws.onclose?.({ code: 1008, reason: "invalid token" });
        });
        return ws;
      });
      authFailWsMock.OPEN = 1;
      global.WebSocket = authFailWsMock;

      await expect(
        player.connect("wss://example.com/tts"),
      ).rejects.toMatchObject({
        code: VoiceErrorCode.TTS_AUTH_FAILED,
      });
    });
  });

  // -- speak ------------------------------------------------------------------

  describe("speak()", () => {
    it("sends text with trailing space and flush=true", async () => {
      await player.connect("wss://example.com/tts");

      const speakPromise = player.speak("Hello world.");
      await Promise.resolve();
      lastWs._receiveAudio("AAAA");
      jest.advanceTimersByTime(700);

      await speakPromise;

      const textMsg = lastWs._sentMessages[1];
      expect(textMsg.text).toBe("Hello world. ");
      expect(textMsg.flush).toBe(true);
    });

    it("emits started and ended events", async () => {
      await player.connect("wss://example.com/tts");

      const started = jest.fn();
      const ended = jest.fn();
      player.on("started", started);
      player.on("ended", ended);

      const speakPromise = player.speak("Text");
      await Promise.resolve();
      lastWs._receiveAudio("AAAA");
      jest.advanceTimersByTime(700);

      await speakPromise;

      expect(started).toHaveBeenCalledWith({ text: "Text" });
      expect(ended).toHaveBeenCalled();
    });

    it("emits queue:drained after last item processed", async () => {
      await player.connect("wss://example.com/tts");

      const drained = jest.fn();
      player.on("queue:drained", drained);

      const speakPromise = player.speak("Only one");
      await Promise.resolve();
      lastWs._receiveAudio("AAAA");
      jest.advanceTimersByTime(700);

      await speakPromise;
      expect(drained).toHaveBeenCalled();
    });
  });

  // -- stop -------------------------------------------------------------------

  describe("stop()", () => {
    it("stop(immediate=true) stops source immediately", async () => {
      await player.connect("wss://example.com/tts");

      player._initAudioContext();
      const mockSource = { stop: jest.fn() };
      player._currentSource = mockSource;
      player.isPlaying = true;

      player.stop(true);

      expect(mockSource.stop).toHaveBeenCalled();
      expect(player.isPlaying).toBe(false);
    });

    it("stop(bargeIn=true) uses fast fade", async () => {
      await player.connect("wss://example.com/tts");

      player._initAudioContext();
      player._currentSource = { stop: jest.fn() };
      player.isPlaying = true;

      player.stop(false, true);

      const gain = mockCtx.createGain.mock.results[0].value;
      expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalled();
      const fadeArgs = gain.gain.exponentialRampToValueAtTime.mock.calls[0];
      expect(fadeArgs[0]).toBeCloseTo(0.001);
    });

    it("stop() rejects pending queue entries", () => {
      player._ttsQueue = [
        { text: "A", resolve: jest.fn(), reject: jest.fn() },
        { text: "B", resolve: jest.fn(), reject: jest.fn() },
      ];
      const rejectA = player._ttsQueue[0].reject;
      const rejectB = player._ttsQueue[1].reject;

      player.stop(true);

      expect(rejectA).toHaveBeenCalled();
      expect(rejectB).toHaveBeenCalled();
      expect(player._ttsQueue).toEqual([]);
    });
  });

  // -- disconnect -------------------------------------------------------------

  describe("disconnect()", () => {
    it("sends close message and closes WebSocket", async () => {
      await player.connect("wss://example.com/tts");

      player.disconnect();

      const lastMsg = lastWs._sentMessages[lastWs._sentMessages.length - 1];
      expect(lastMsg.text).toBe("");
    });
  });

  // -- auto-reconnect via getConnectionUrl ------------------------------------

  describe("auto-reconnect", () => {
    it("reconnects transparently when WebSocket is disconnected", async () => {
      const getUrl = jest.fn(() =>
        Promise.resolve("wss://example.com/tts?token=fresh"),
      );
      player = new TTSPlayer({ getConnectionUrl: getUrl });

      await player.connect("wss://example.com/tts?token=initial");

      lastWs._triggerClose(1000, "inactivity");
      expect(player.isConnected()).toBe(false);

      const speakPromise = player.speak("After reconnect");

      // Flush microtask queue multiple times for the async reconnection chain
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      lastWs._receiveAudio("BBBB");
      jest.advanceTimersByTime(700);

      await speakPromise;

      expect(getUrl).toHaveBeenCalled();
      expect(player.isConnected()).toBe(true);
    });

    it("throws after max reconnect retries", async () => {
      const getUrl = jest.fn(() =>
        Promise.reject(new Error("token service down")),
      );
      player = new TTSPlayer({ getConnectionUrl: getUrl });

      const speakPromise = player.speak("Will fail");

      // Each retry has a setTimeout delay + promise resolution
      for (let i = 0; i < 15; i++) {
        jest.advanceTimersByTime(3000);
        await Promise.resolve();
      }

      await expect(speakPromise).rejects.toMatchObject({
        code: VoiceErrorCode.TTS_CONNECTION_FAILED,
      });
    });
  });

  // -- destroy ----------------------------------------------------------------

  describe("destroy()", () => {
    it("stops playback, disconnects, and closes AudioContext", async () => {
      await player.connect("wss://example.com/tts");

      player._initAudioContext();
      player.destroy();

      expect(mockCtx.close).toHaveBeenCalled();
      expect(player.isConnected()).toBe(false);
    });

    it("removes all listeners", () => {
      const handler = jest.fn();
      player.on("started", handler);
      player.destroy();

      player.emit("started", { text: "x" });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -- edge cases -------------------------------------------------------------

  describe("edge cases", () => {
    it("_playBuffer resolves immediately when isStopped", async () => {
      player._initAudioContext();
      player.isStopped = true;
      await player._playBuffer({ duration: 1.0 });
    });

    it("_fadeAndStop falls back to _stopSource when no gainNode", () => {
      player._currentSource = { stop: jest.fn() };
      player._gainNode = null;
      player._audioContext = null;

      player._fadeAndStop(0.15);

      expect(player._currentSource).toBeNull();
    });

    it("handles isFinal message by flushing collected audio", async () => {
      await player.connect("wss://example.com/tts");

      const speakPromise = player.speak("Hello");
      await Promise.resolve();

      lastWs._receiveAudio("CCCC");
      lastWs._receiveFinal();

      await speakPromise;
    });
  });

  // -- Event emitter ----------------------------------------------------------

  describe("event emitter", () => {
    it("on/off work correctly", () => {
      const handler = jest.fn();
      player.on("test", handler);
      player.emit("test", "data");
      expect(handler).toHaveBeenCalledWith("data");

      player.off("test", handler);
      player.emit("test", "data2");
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("listener errors do not propagate", () => {
      const bad = jest.fn(() => {
        throw new Error("boom");
      });
      player.on("test", bad);
      expect(() => player.emit("test")).not.toThrow();
    });

    it("removeAllListeners clears all", () => {
      const handler = jest.fn();
      player.on("a", handler);
      player.on("b", handler);
      player.removeAllListeners();
      player.emit("a");
      player.emit("b");
      expect(handler).not.toHaveBeenCalled();
    });

    it("removeAllListeners(event) clears only that event", () => {
      const h1 = jest.fn();
      const h2 = jest.fn();
      player.on("a", h1);
      player.on("b", h2);
      player.removeAllListeners("a");
      player.emit("a");
      player.emit("b");
      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();
    });
  });
});
