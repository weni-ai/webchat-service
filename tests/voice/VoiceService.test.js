import { VoiceService, VoiceSessionState } from "../../src/modules/voice/VoiceService";
import { VoiceError, VoiceErrorCode } from "../../src/modules/voice/errors";

// ---------------------------------------------------------------------------
// Mock all sub-components
// ---------------------------------------------------------------------------

const mockAudioCapture = {
  start: jest.fn(() => Promise.resolve()),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  destroy: jest.fn(),
  resetSpeakingState: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  removeAllListeners: jest.fn(),
  isCapturing: false,
};

const mockSTTConnection = {
  connect: jest.fn(() => Promise.resolve()),
  sendAudio: jest.fn(),
  commit: jest.fn(),
  disconnect: jest.fn(),
  destroy: jest.fn(),
  isConnected: jest.fn(() => true),
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  removeAllListeners: jest.fn(),
};

const mockTTSPlayer = {
  speak: jest.fn(() => Promise.resolve()),
  stop: jest.fn(),
  connect: jest.fn(() => Promise.resolve()),
  disconnect: jest.fn(),
  destroy: jest.fn(),
  isConnected: jest.fn(() => true),
  on: jest.fn(),
  once: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  removeAllListeners: jest.fn(),
  isPlaying: false,
};

const mockTextChunker = {
  addText: jest.fn(() => null),
  flush: jest.fn(() => null),
  clear: jest.fn(),
};

const mockEchoGuard = {
  shouldForwardAudio: jest.fn(() => true),
  shouldTriggerBargeIn: jest.fn(() => false),
  onTTSStarted: jest.fn(),
  onTTSStopped: jest.fn(),
  onBargeInDetected: jest.fn(),
  reset: jest.fn(),
  destroy: jest.fn(),
  bargeInThreshold: 0.08,
};

const mockSessionGuard = {
  start: jest.fn(),
  stop: jest.fn(),
  recordActivity: jest.fn(),
  destroy: jest.fn(),
};

jest.mock("../../src/modules/voice/AudioCapture", () => ({
  AudioCapture: jest.fn(() => ({ ...mockAudioCapture })),
}));

jest.mock("../../src/modules/voice/STTConnection", () => ({
  STTConnection: jest.fn(() => ({ ...mockSTTConnection })),
  __esModule: true,
  default: jest.fn(() => ({ ...mockSTTConnection })),
}));

jest.mock("../../src/modules/voice/TTSPlayer", () => ({
  TTSPlayer: jest.fn((opts) => ({
    ...mockTTSPlayer,
    _getConnectionUrl: opts?.getConnectionUrl || null,
  })),
  __esModule: true,
  default: jest.fn((opts) => ({
    ...mockTTSPlayer,
    _getConnectionUrl: opts?.getConnectionUrl || null,
  })),
}));

jest.mock("../../src/modules/voice/TextChunker", () => ({
  TextChunker: jest.fn(() => ({ ...mockTextChunker })),
  __esModule: true,
  default: jest.fn(() => ({ ...mockTextChunker })),
}));

jest.mock("../../src/modules/voice/EchoGuard", () => ({
  EchoGuard: jest.fn(() => ({ ...mockEchoGuard })),
  __esModule: true,
  default: jest.fn(() => ({ ...mockEchoGuard })),
}));

jest.mock("../../src/modules/voice/SessionGuard", () => ({
  SessionGuard: jest.fn(() => ({ ...mockSessionGuard })),
  __esModule: true,
  default: jest.fn(() => ({ ...mockSessionGuard })),
}));

jest.mock("../../src/modules/voice/config", () => ({
  mergeVoiceConfig: jest.fn((cfg) => ({
    elevenLabs: { voiceId: "voice-1", ...cfg?.elevenLabs },
    languageCode: "en",
    ttsModel: "eleven_flash_v2_5",
    audioFormat: "mp3_44100_128",
    latencyOptimization: 3,
    vadThreshold: 0.02,
    maxSessionDurationMs: 15 * 60 * 1000,
    idleTimeoutMs: 4 * 60 * 1000,
    hiddenGracePeriodMs: 30 * 1000,
    sttLeadInFrames: 3,
    sttTrailFrames: 8,
    getTokens:
      cfg.getTokens ||
      jest.fn(() =>
        Promise.resolve({ sttToken: "stt-token-abc", ttsToken: "tts-token-xyz" }),
      ),
    ...cfg,
  })),
  buildTTSWebSocketURL: jest.fn(
    (voiceId, config, token) =>
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?single_use_token=${token}`,
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const { AudioCapture } = require("../../src/modules/voice/AudioCapture");
const { STTConnection } = require("../../src/modules/voice/STTConnection");

function createInitializedService(overrides = {}) {
  const svc = new VoiceService();
  const config = {
    elevenLabs: { voiceId: "voice-1" },
    getTokens: jest.fn(() =>
      Promise.resolve({ sttToken: "stt-token-abc", ttsToken: "tts-token-xyz" }),
    ),
    ...overrides,
  };
  svc.init(config);
  return svc;
}

function getAudioCaptureListenerFor(svc, eventName) {
  const onCalls = svc.audioCapture.on.mock.calls;
  const match = onCalls.find(([name]) => name === eventName);
  return match ? match[1] : null;
}

function getSTTListenerFor(svc, eventName) {
  const onCalls = svc.sttConnection.on.mock.calls;
  const match = onCalls.find(([name]) => name === eventName);
  return match ? match[1] : null;
}

function getTTSListenerFor(svc, eventName) {
  const onCalls = svc.ttsPlayer.on.mock.calls;
  const match = onCalls.find(([name]) => name === eventName);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VoiceService", () => {
  let svc;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = null;
  });

  afterEach(() => {
    if (svc) {
      svc.removeAllListeners();
    }
  });

  // -- isSupported ----------------------------------------------------------

  describe("isSupported()", () => {
    it("returns true when all APIs present", () => {
      AudioCapture.isSupported = jest.fn(() => true);
      global.WebSocket = jest.fn();
      window.AudioContext = jest.fn();

      expect(VoiceService.isSupported()).toBe(true);

      delete global.WebSocket;
      delete window.AudioContext;
    });

    it("returns false when AudioCapture not supported", () => {
      AudioCapture.isSupported = jest.fn(() => false);
      global.WebSocket = jest.fn();
      window.AudioContext = jest.fn();

      expect(VoiceService.isSupported()).toBe(false);

      delete global.WebSocket;
      delete window.AudioContext;
    });

    it("returns false when WebSocket is missing", () => {
      AudioCapture.isSupported = jest.fn(() => true);
      const savedWs = global.WebSocket;
      delete global.WebSocket;
      window.AudioContext = jest.fn();

      expect(VoiceService.isSupported()).toBe(false);

      global.WebSocket = savedWs;
      delete window.AudioContext;
    });

    it("falls back to webkitAudioContext", () => {
      AudioCapture.isSupported = jest.fn(() => true);
      global.WebSocket = jest.fn();
      delete window.AudioContext;
      window.webkitAudioContext = jest.fn();

      expect(VoiceService.isSupported()).toBe(true);

      delete global.WebSocket;
      delete window.webkitAudioContext;
    });
  });

  // -- init -----------------------------------------------------------------

  describe("init()", () => {
    it("merges config and creates sub-components", async () => {
      svc = createInitializedService();

      expect(svc.config).toBeDefined();
      expect(svc.audioCapture).toBeDefined();
      expect(svc.ttsPlayer).toBeDefined();
      expect(svc.textChunker).toBeDefined();
      expect(svc.echoGuard).toBeDefined();
    });

    it("wires AudioCapture listeners", () => {
      svc = createInitializedService();

      const onCalls = svc.audioCapture.on.mock.calls.map(([name]) => name);
      expect(onCalls).toContain("audioData");
      expect(onCalls).toContain("voiceActivity");
    });

    it("passes getConnectionUrl callback to TTSPlayer", () => {
      svc = createInitializedService();
      const { TTSPlayer } = require("../../src/modules/voice/TTSPlayer");
      expect(TTSPlayer).toHaveBeenCalledWith(
        expect.objectContaining({
          getConnectionUrl: expect.any(Function),
        }),
      );
    });
  });

  // -- startSession ---------------------------------------------------------

  describe("startSession()", () => {
    it("transitions IDLE→INITIALIZING→LISTENING, emits session:started", async () => {
      svc = createInitializedService();
      const stateChanges = [];
      svc.on("state:changed", (e) => stateChanges.push(e.state));
      const sessionStarted = jest.fn();
      svc.on("session:started", sessionStarted);

      const result = await svc.startSession();

      expect(stateChanges).toContain(VoiceSessionState.INITIALIZING);
      expect(stateChanges).toContain(VoiceSessionState.LISTENING);
      expect(svc.state).toBe(VoiceSessionState.LISTENING);
      expect(sessionStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          startedAt: expect.any(Number),
        }),
      );
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("startedAt");
    });

    it("calls getTokens and passes sttToken to STTConnection", async () => {
      svc = createInitializedService();
      await svc.startSession();

      expect(svc.config.getTokens).toHaveBeenCalled();
      expect(STTConnection).toHaveBeenCalledWith(
        expect.anything(),
        "stt-token-abc",
      );
    });

    it("connects TTS WebSocket with ttsToken", async () => {
      svc = createInitializedService();
      await svc.startSession();

      expect(svc.ttsPlayer.connect).toHaveBeenCalledWith(
        expect.stringContaining("tts-token-xyz"),
      );
    });

    it("starts AudioCapture and connects STT", async () => {
      svc = createInitializedService();
      await svc.startSession();

      expect(svc.audioCapture.start).toHaveBeenCalledWith(
        expect.objectContaining({ vadThreshold: 0.02 }),
      );
      expect(svc.sttConnection.connect).toHaveBeenCalled();
    });

    it("throws when not in IDLE state", async () => {
      svc = createInitializedService();
      await svc.startSession();

      await expect(svc.startSession()).rejects.toThrow();
    });

    it("transitions to ERROR on VoiceError failure", async () => {
      svc = createInitializedService();
      svc.audioCapture.start.mockRejectedValueOnce(
        new VoiceError(VoiceErrorCode.MICROPHONE_PERMISSION_DENIED),
      );

      const errorHandler = jest.fn();
      svc.on("error", errorHandler);

      await expect(svc.startSession()).rejects.toThrow();
      expect(svc.state).toBe(VoiceSessionState.ERROR);
      expect(errorHandler).toHaveBeenCalled();
      expect(errorHandler.mock.calls[0][0].code).toBe(
        VoiceErrorCode.MICROPHONE_PERMISSION_DENIED,
      );
    });

    it("wraps non-VoiceError in UNKNOWN_ERROR on failure", async () => {
      svc = createInitializedService();
      svc.audioCapture.start.mockRejectedValueOnce(new Error("generic fail"));

      const errorHandler = jest.fn();
      svc.on("error", errorHandler);

      await expect(svc.startSession()).rejects.toThrow();
      expect(svc.state).toBe(VoiceSessionState.ERROR);
      expect(errorHandler.mock.calls[0][0].code).toBe(
        VoiceErrorCode.UNKNOWN_ERROR,
      );
    });
  });

  // -- endSession -----------------------------------------------------------

  describe("endSession()", () => {
    it("stops all components, disconnects TTS, and transitions to IDLE", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const ended = jest.fn();
      svc.on("session:ended", ended);

      svc.endSession();

      expect(svc.audioCapture.stop).toHaveBeenCalled();
      expect(svc.ttsPlayer.stop).toHaveBeenCalledWith(true);
      expect(svc.ttsPlayer.disconnect).toHaveBeenCalled();
      expect(svc.textChunker.clear).toHaveBeenCalled();
      expect(svc.echoGuard.reset).toHaveBeenCalled();
      expect(svc.sessionGuard.stop).toHaveBeenCalled();
      expect(svc.state).toBe(VoiceSessionState.IDLE);
      expect(ended).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: expect.any(String),
          duration: expect.any(Number),
          reason: 'user',
        }),
      );
    });

    it("includes custom reason in session:ended event", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const ended = jest.fn();
      svc.on("session:ended", ended);

      svc.endSession('idle');

      expect(ended).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'idle' }),
      );
    });

    it("clears currentTokens on end", async () => {
      svc = createInitializedService();
      await svc.startSession();
      expect(svc.currentTokens).toBeTruthy();

      svc.endSession();
      expect(svc.currentTokens).toBeNull();
    });
  });

  // -- State transitions via AudioCapture events ----------------------------

  describe("state transitions", () => {
    it("voiceActivity {speaking:true} in LISTENING → PROCESSING", async () => {
      svc = createInitializedService();
      await svc.startSession();
      expect(svc.state).toBe(VoiceSessionState.LISTENING);

      const voiceHandler = getAudioCaptureListenerFor(svc, "voiceActivity");
      voiceHandler({ speaking: true });

      expect(svc.state).toBe(VoiceSessionState.PROCESSING);
    });

    it("STT committed → LISTENING, calls messageCallback", async () => {
      svc = createInitializedService();
      const msgCallback = jest.fn();
      svc.setMessageCallback(msgCallback);
      await svc.startSession();

      svc.setState(VoiceSessionState.PROCESSING);

      const committedHandler = getSTTListenerFor(svc, "committed");
      committedHandler({ text: "hello world" });

      expect(svc.state).toBe(VoiceSessionState.LISTENING);
      expect(msgCallback).toHaveBeenCalledWith("hello world");
    });

    it("voiceActivity {speaking:false} does not change state", async () => {
      svc = createInitializedService();
      await svc.startSession();
      expect(svc.state).toBe(VoiceSessionState.LISTENING);

      const voiceHandler = getAudioCaptureListenerFor(svc, "voiceActivity");
      voiceHandler({ speaking: false });

      expect(svc.state).toBe(VoiceSessionState.LISTENING);
    });

    it("voiceActivity in non-LISTENING state does not transition", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.setState(VoiceSessionState.SPEAKING);

      const voiceHandler = getAudioCaptureListenerFor(svc, "voiceActivity");
      voiceHandler({ speaking: true });

      expect(svc.state).toBe(VoiceSessionState.SPEAKING);
    });

    it("audioData forwarding when not SPEAKING does not check bargeIn", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.echoGuard.shouldForwardAudio.mockReturnValue(true);

      const audioHandler = getAudioCaptureListenerFor(svc, "audioData");
      audioHandler({
        data: "base64",
        sampleRate: 16000,
        hasVoice: true,
        energy: 0.05,
      });

      expect(svc.echoGuard.shouldTriggerBargeIn).not.toHaveBeenCalled();
      expect(svc.sttConnection.sendAudio).toHaveBeenCalled();
    });

    it("STT committed with empty text does not call messageCallback", async () => {
      svc = createInitializedService();
      const msgCallback = jest.fn();
      svc.setMessageCallback(msgCallback);
      await svc.startSession();

      const committedHandler = getSTTListenerFor(svc, "committed");
      committedHandler({ text: "   " });

      expect(msgCallback).not.toHaveBeenCalled();
    });

    it("STT partial → updates partialTranscript", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const partialHandler = getSTTListenerFor(svc, "partial");
      partialHandler({ text: "hel" });

      expect(svc.partialTranscript).toBe("hel");
    });
  });

  // -- processTextChunk → TTS pipeline -------------------------------------

  describe("processTextChunk()", () => {
    it("feeds text through TextChunker and speaks when chunk is ready", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.textChunker.addText.mockReturnValueOnce("Hello world.");

      svc.processTextChunk("Hello world.");

      expect(svc.textChunker.addText).toHaveBeenCalledWith("Hello world.");
      expect(svc.echoGuard.onTTSStarted).toHaveBeenCalled();
      expect(svc.ttsPlayer.speak).toHaveBeenCalledWith("Hello world.");
      expect(svc.state).toBe(VoiceSessionState.SPEAKING);
    });

    it("flushes remaining text when isComplete=true", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.textChunker.addText.mockReturnValueOnce(null);
      svc.textChunker.flush.mockReturnValueOnce("last bit");

      svc.processTextChunk("last bit", true);

      expect(svc.textChunker.flush).toHaveBeenCalled();
      expect(svc.ttsPlayer.speak).toHaveBeenCalledWith("last bit");
    });

    it("does nothing if textChunker is null", () => {
      svc = new VoiceService();
      expect(() => svc.processTextChunk("hi")).not.toThrow();
    });

    it("skips emoji-only chunks", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.processTextChunk("😀🎉");

      expect(svc.textChunker.addText).not.toHaveBeenCalled();
    });

    it("skips text-presentation pictographic chunks", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.processTextChunk("☀☺");

      expect(svc.textChunker.addText).not.toHaveBeenCalled();
    });

    it("skips bare URL chunks", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.processTextChunk("https://example.com/path?q=1");

      expect(svc.textChunker.addText).not.toHaveBeenCalled();
    });

    it("skips fenced code block chunks", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.processTextChunk("```js\nconsole.log(1);\n```");

      expect(svc.textChunker.addText).not.toHaveBeenCalled();
    });

    it("does not skip chunks containing only digits", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.processTextChunk("42");

      expect(svc.textChunker.addText).toHaveBeenCalledWith("42");
    });

    it("does not skip chunks mixing text and numbers", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.processTextChunk("item 3");

      expect(svc.textChunker.addText).toHaveBeenCalledWith("item 3");
    });

    it("does not skip chunks mixing emoji and text", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.processTextChunk("hello 😀 world");

      expect(svc.textChunker.addText).toHaveBeenCalledWith("hello 😀 world");
    });

    it("sanitizes URLs from chunk, replacing with 'link'", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.textChunker.addText.mockReturnValueOnce(
        "Veja em https://loja.com/produto agora.",
      );

      svc.processTextChunk("Veja em https://loja.com/produto agora.");

      expect(svc.ttsPlayer.speak).toHaveBeenCalledWith("Veja em link agora.");
    });

    it("sanitizes markdown bold from chunk before speaking", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.textChunker.addText.mockReturnValueOnce("Isso é **importante** aqui.");

      svc.processTextChunk("Isso é **importante** aqui.");

      expect(svc.ttsPlayer.speak).toHaveBeenCalledWith(
        "Isso é importante aqui.",
      );
    });

    it("does not speak when sanitized chunk has only punctuation", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.textChunker.addText.mockReturnValueOnce("**?**");

      svc.processTextChunk("**?**");

      expect(svc.ttsPlayer.speak).not.toHaveBeenCalled();
    });

    it("sanitizes flushed remaining text on isComplete", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.textChunker.addText.mockReturnValueOnce(null);
      svc.textChunker.flush.mockReturnValueOnce("Clique **aqui** ok");

      svc.processTextChunk("Clique **aqui** ok", true);

      expect(svc.ttsPlayer.speak).toHaveBeenCalledWith("Clique aqui ok");
    });

    it("does not speak when flushed text sanitizes to punctuation-only", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.textChunker.addText.mockReturnValueOnce(null);
      svc.textChunker.flush.mockReturnValueOnce("...");

      svc.processTextChunk("text", true);

      expect(svc.ttsPlayer.speak).not.toHaveBeenCalled();
    });
  });

  // -- Transcription interruption on agent message ---------------------------

  describe("transcription interruption on agent message", () => {
    it("clears partial transcript when processTextChunk receives agent text", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const partialHandler = getSTTListenerFor(svc, "partial");
      partialHandler({ text: "how is the wea" });
      expect(svc.partialTranscript).toBe("how is the wea");

      const transcriptEvents = [];
      svc.on("transcript:partial", (e) => transcriptEvents.push(e));

      svc.textChunker.addText.mockReturnValueOnce("Hello from agent.");
      svc.processTextChunk("Hello from agent.");

      expect(svc.partialTranscript).toBe("");
      expect(transcriptEvents).toContainEqual({ text: "" });
    });

    it("ignores STT partial events while in SPEAKING state", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.textChunker.addText.mockReturnValueOnce("Agent says hello.");
      svc.processTextChunk("Agent says hello.");
      expect(svc.state).toBe(VoiceSessionState.SPEAKING);

      const partialHandler = getSTTListenerFor(svc, "partial");
      partialHandler({ text: "stale partial" });

      expect(svc.partialTranscript).toBe("");
    });

    it("processes STT committed during SPEAKING but keeps SPEAKING state", async () => {
      svc = createInitializedService();
      const msgCallback = jest.fn();
      svc.setMessageCallback(msgCallback);
      await svc.startSession();

      svc.textChunker.addText.mockReturnValueOnce("Agent response.");
      svc.processTextChunk("Agent response.");
      expect(svc.state).toBe(VoiceSessionState.SPEAKING);

      const committedHandler = getSTTListenerFor(svc, "committed");
      committedHandler({ text: "user message before TTS" });

      expect(msgCallback).toHaveBeenCalledWith("user message before TTS");
      expect(svc.state).toBe(VoiceSessionState.SPEAKING);
    });

    it("does not clear partial when there is no active partial transcript", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const transcriptEvents = [];
      svc.on("transcript:partial", (e) => transcriptEvents.push(e));

      svc.textChunker.addText.mockReturnValueOnce("Hello.");
      svc.processTextChunk("Hello.");

      expect(transcriptEvents).not.toContainEqual({ text: "" });
    });
  });

  // -- TTS queue:drained → back to LISTENING ---------------------------------

  describe("TTS queue:drained transition", () => {
    it("transitions SPEAKING → LISTENING on TTS queue:drained", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.setState(VoiceSessionState.SPEAKING);

      const drainedCallback = getTTSListenerFor(svc, "queue:drained");
      expect(drainedCallback).toBeDefined();

      drainedCallback();

      expect(svc.echoGuard.onTTSStopped).toHaveBeenCalled();
      expect(svc.state).toBe(VoiceSessionState.LISTENING);
    });
  });

  // -- Barge-in -------------------------------------------------------------

  describe("barge-in", () => {
    it("voice during SPEAKING → stops TTS, clears chunker, emits barge-in", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.setState(VoiceSessionState.SPEAKING);

      svc.echoGuard.shouldTriggerBargeIn.mockReturnValueOnce(true);
      const bargeHandler = jest.fn();
      svc.on("barge-in", bargeHandler);

      const audioDataHandler = getAudioCaptureListenerFor(svc, "audioData");
      audioDataHandler({
        data: "base64",
        sampleRate: 16000,
        hasVoice: true,
        energy: 0.1,
      });

      expect(svc.ttsPlayer.stop).toHaveBeenCalledWith(false, true);
      expect(svc.textChunker.clear).toHaveBeenCalled();
      expect(svc.echoGuard.onBargeInDetected).toHaveBeenCalled();
      expect(svc.audioCapture.resetSpeakingState).toHaveBeenCalled();
      expect(bargeHandler).toHaveBeenCalled();
      expect(svc.state).toBe(VoiceSessionState.LISTENING);
    });
  });

  // -- EchoGuard integration ------------------------------------------------

  describe("EchoGuard integration", () => {
    it("shouldForwardAudio checked before sendAudio", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.echoGuard.shouldForwardAudio.mockReturnValueOnce(false);

      const audioDataHandler = getAudioCaptureListenerFor(svc, "audioData");
      audioDataHandler({
        data: "base64",
        sampleRate: 16000,
        hasVoice: true,
        energy: 0.05,
      });

      expect(svc.sttConnection.sendAudio).not.toHaveBeenCalled();
    });

    it("forwards voice audio when echoGuard allows", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.echoGuard.shouldForwardAudio.mockReturnValueOnce(true);

      const audioDataHandler = getAudioCaptureListenerFor(svc, "audioData");
      audioDataHandler({
        data: "base64",
        sampleRate: 16000,
        hasVoice: true,
        energy: 0.05,
      });

      expect(svc.sttConnection.sendAudio).toHaveBeenCalledWith(
        "base64",
        16000,
        false,
      );
    });
  });

  // -- EchoGuard TTS-gating integration ------------------------------------

  describe("EchoGuard TTS-gating", () => {
    it("blocks sendAudio while TTS is playing, resumes after cooldown", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const audioDataHandler = getAudioCaptureListenerFor(svc, "audioData");
      const voicePayload = {
        data: "base64",
        sampleRate: 16000,
        hasVoice: true,
        energy: 0.05,
      };

      svc.echoGuard.shouldForwardAudio.mockReturnValue(false);
      audioDataHandler(voicePayload);
      expect(svc.sttConnection.sendAudio).not.toHaveBeenCalled();

      svc.echoGuard.shouldForwardAudio.mockReturnValue(false);
      audioDataHandler(voicePayload);
      expect(svc.sttConnection.sendAudio).not.toHaveBeenCalled();

      svc.echoGuard.shouldForwardAudio.mockReturnValue(true);
      audioDataHandler(voicePayload);
      expect(svc.sttConnection.sendAudio).toHaveBeenCalledTimes(1);
    });

    it("calls onTTSStarted when speaking", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.textChunker.addText.mockReturnValueOnce("Hello.");
      svc.processTextChunk("Hello.");

      expect(svc.echoGuard.onTTSStarted).toHaveBeenCalled();
    });
  });

  // -- STT auto-reconnect ---------------------------------------------------

  describe("STT auto-reconnect on close", () => {
    it("reconnects STT when close fires and not IDLE", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const closeHandler = getSTTListenerFor(svc, "close");
      closeHandler();

      await Promise.resolve();

      expect(STTConnection).toHaveBeenCalledTimes(2);
    });

    it("does not reconnect when in IDLE state", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const closeHandler = getSTTListenerFor(svc, "close");
      expect(closeHandler).toBeDefined();

      svc.endSession();
      STTConnection.mockClear();

      closeHandler();

      await Promise.resolve();
      expect(STTConnection).not.toHaveBeenCalled();
    });

    it("refreshes tokens on STT reconnect", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.config.getTokens.mockClear();

      const closeHandler = getSTTListenerFor(svc, "close");
      closeHandler();

      await Promise.resolve();
      expect(svc.config.getTokens).toHaveBeenCalled();
    });

    it("destroys old connection on reconnect", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const oldStt = svc.sttConnection;
      const closeHandler = getSTTListenerFor(svc, "close");
      closeHandler();

      await new Promise((r) => setTimeout(r, 10));

      expect(oldStt.destroy).toHaveBeenCalled();
      expect(svc.sttConnection).not.toBe(oldStt);
    });

    it("prevents concurrent reconnections", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const closeHandler = getSTTListenerFor(svc, "close");
      closeHandler();
      closeHandler();
      closeHandler();

      await new Promise((r) => setTimeout(r, 10));

      expect(STTConnection).toHaveBeenCalledTimes(2);
    });

    it("resets silence filter on reconnect", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.echoGuard.shouldForwardAudio.mockReturnValue(true);

      const audioHandler = getAudioCaptureListenerFor(svc, "audioData");
      audioHandler({ data: "v1", sampleRate: 16000, hasVoice: true, energy: 0.1 });
      expect(svc._isForwardingToSTT).toBe(true);

      const closeHandler = getSTTListenerFor(svc, "close");
      closeHandler();

      await new Promise((r) => setTimeout(r, 10));

      expect(svc._isForwardingToSTT).toBe(false);
    });
  });

  // -- setLanguage ----------------------------------------------------------

  describe("setLanguage()", () => {
    it("updates config languageCode", () => {
      svc = createInitializedService();
      svc.setLanguage("pt");
      expect(svc.config.languageCode).toBe("pt");
    });
  });

  // -- destroy --------------------------------------------------------------

  describe("destroy()", () => {
    it("calls endSession and destroys all components", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.destroy();

      expect(svc.audioCapture).toBeNull();
      expect(svc.ttsPlayer).toBeNull();
      expect(svc.textChunker).toBeNull();
      expect(svc.echoGuard).toBeNull();
      expect(svc.config).toBeNull();
      expect(svc.state).toBe(VoiceSessionState.IDLE);
    });

    it("removes all listeners", async () => {
      svc = createInitializedService();
      const handler = jest.fn();
      svc.on("test", handler);

      svc.destroy();

      svc.emit("test", "data");
      expect(handler).not.toHaveBeenCalled();
      svc = null;
    });
  });

  // -- getSession -----------------------------------------------------------

  describe("getSession()", () => {
    it("returns null when no session", () => {
      svc = createInitializedService();
      expect(svc.getSession()).toBeNull();
    });

    it("returns session info when active", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const session = svc.getSession();
      expect(session).toHaveProperty("id");
      expect(session).toHaveProperty("state", VoiceSessionState.LISTENING);
      expect(session).toHaveProperty("startedAt");
      expect(session).toHaveProperty("config");
    });
  });

  // -- stopSpeaking ---------------------------------------------------------

  describe("stopSpeaking()", () => {
    it("stops TTS and clears chunker", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.stopSpeaking(true);

      expect(svc.ttsPlayer.stop).toHaveBeenCalledWith(true);
      expect(svc.textChunker.clear).toHaveBeenCalled();
    });
  });

  // -- once/off event helpers -----------------------------------------------

  describe("event once()", () => {
    it("fires callback only once", () => {
      svc = createInitializedService();
      const handler = jest.fn();
      svc.once("test:event", handler);

      svc.emit("test:event", "a");
      svc.emit("test:event", "b");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith("a");
    });
  });

  // -- STT reconnect error --------------------------------------------------

  describe("STT reconnect error", () => {
    it("emits error when reconnect fails", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.config.getTokens = jest.fn(() =>
        Promise.reject(new Error("token fail")),
      );
      const errorHandler = jest.fn();
      svc.on("error", errorHandler);

      const closeHandler = getSTTListenerFor(svc, "close");
      closeHandler();

      await new Promise((r) => setTimeout(r, 10));
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  // -- TTS speak error in _speak() ------------------------------------------

  describe("TTS speak error in _speak()", () => {
    it("emits error when ttsPlayer.speak rejects", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.ttsPlayer.speak.mockRejectedValueOnce(new Error("tts fail"));

      const errorHandler = jest.fn();
      svc.on("error", errorHandler);

      svc.textChunker.addText.mockReturnValueOnce("Chunk");
      svc.processTextChunk("Chunk");

      await new Promise((r) => setTimeout(r, 10));

      expect(errorHandler).toHaveBeenCalled();
      expect(errorHandler.mock.calls[0][0].code).toBe(
        VoiceErrorCode.TTS_GENERATION_FAILED,
      );
    });
  });

  // -- STT error handling ---------------------------------------------------

  describe("STT error handling", () => {
    it("emits VoiceError from STT error events directly", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const errorHandler = jest.fn();
      svc.on("error", errorHandler);

      const sttErrorHandler = getSTTListenerFor(svc, "error");
      const voiceErr = new VoiceError(VoiceErrorCode.STT_TRANSCRIPTION_FAILED);
      sttErrorHandler(voiceErr);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].code).toBe(
        VoiceErrorCode.STT_TRANSCRIPTION_FAILED,
      );
    });

    it("wraps non-VoiceError from STT into STT_TRANSCRIPTION_FAILED", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const errorHandler = jest.fn();
      svc.on("error", errorHandler);

      const sttErrorHandler = getSTTListenerFor(svc, "error");
      sttErrorHandler(new Error("generic"));

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].code).toBe(
        VoiceErrorCode.STT_TRANSCRIPTION_FAILED,
      );
    });
  });

  // -- Silence filter -------------------------------------------------------

  describe("silence filter", () => {
    it("buffers silence frames in lead-in without forwarding", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.echoGuard.shouldForwardAudio.mockReturnValue(true);

      const handler = getAudioCaptureListenerFor(svc, "audioData");
      handler({ data: "s1", sampleRate: 16000, hasVoice: false, energy: 0 });
      handler({ data: "s2", sampleRate: 16000, hasVoice: false, energy: 0 });

      expect(svc.sttConnection.sendAudio).not.toHaveBeenCalled();
    });

    it("flushes lead-in buffer when voice detected", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.echoGuard.shouldForwardAudio.mockReturnValue(true);

      const handler = getAudioCaptureListenerFor(svc, "audioData");
      handler({ data: "s1", sampleRate: 16000, hasVoice: false, energy: 0 });
      handler({ data: "s2", sampleRate: 16000, hasVoice: false, energy: 0 });

      handler({ data: "v1", sampleRate: 16000, hasVoice: true, energy: 0.1 });

      expect(svc.sttConnection.sendAudio).toHaveBeenCalledTimes(3);
      expect(svc.sttConnection.sendAudio).toHaveBeenNthCalledWith(
        1, "s1", 16000, false,
      );
      expect(svc.sttConnection.sendAudio).toHaveBeenNthCalledWith(
        2, "s2", 16000, false,
      );
      expect(svc.sttConnection.sendAudio).toHaveBeenNthCalledWith(
        3, "v1", 16000, false,
      );
    });

    it("caps lead-in buffer to sttLeadInFrames", async () => {
      svc = createInitializedService({ sttLeadInFrames: 2 });
      await svc.startSession();
      svc.echoGuard.shouldForwardAudio.mockReturnValue(true);

      const handler = getAudioCaptureListenerFor(svc, "audioData");
      handler({ data: "s1", sampleRate: 16000, hasVoice: false, energy: 0 });
      handler({ data: "s2", sampleRate: 16000, hasVoice: false, energy: 0 });
      handler({ data: "s3", sampleRate: 16000, hasVoice: false, energy: 0 });

      handler({ data: "v1", sampleRate: 16000, hasVoice: true, energy: 0.1 });

      expect(svc.sttConnection.sendAudio).toHaveBeenCalledTimes(3);
      expect(svc.sttConnection.sendAudio).toHaveBeenNthCalledWith(
        1, "s2", 16000, false,
      );
    });

    it("sends trailing silence frames up to sttTrailFrames", async () => {
      svc = createInitializedService({ sttTrailFrames: 2 });
      await svc.startSession();
      svc.echoGuard.shouldForwardAudio.mockReturnValue(true);

      const handler = getAudioCaptureListenerFor(svc, "audioData");
      handler({ data: "v1", sampleRate: 16000, hasVoice: true, energy: 0.1 });
      svc.sttConnection.sendAudio.mockClear();

      handler({ data: "t1", sampleRate: 16000, hasVoice: false, energy: 0 });
      handler({ data: "t2", sampleRate: 16000, hasVoice: false, energy: 0 });

      expect(svc.sttConnection.sendAudio).toHaveBeenCalledTimes(2);
    });

    it("stops forwarding and commits after trail frames exceeded", async () => {
      svc = createInitializedService({ sttTrailFrames: 2 });
      await svc.startSession();
      svc.echoGuard.shouldForwardAudio.mockReturnValue(true);

      const handler = getAudioCaptureListenerFor(svc, "audioData");
      handler({ data: "v1", sampleRate: 16000, hasVoice: true, energy: 0.1 });
      svc.sttConnection.sendAudio.mockClear();

      handler({ data: "t1", sampleRate: 16000, hasVoice: false, energy: 0 });
      handler({ data: "t2", sampleRate: 16000, hasVoice: false, energy: 0 });
      handler({ data: "t3", sampleRate: 16000, hasVoice: false, energy: 0 });
      handler({ data: "t4", sampleRate: 16000, hasVoice: false, energy: 0 });

      expect(svc.sttConnection.sendAudio).toHaveBeenCalledTimes(2);
      expect(svc.sttConnection.commit).toHaveBeenCalledTimes(1);
    });

    it("resumes forwarding when voice detected during trail", async () => {
      svc = createInitializedService({ sttTrailFrames: 2 });
      await svc.startSession();
      svc.echoGuard.shouldForwardAudio.mockReturnValue(true);

      const handler = getAudioCaptureListenerFor(svc, "audioData");
      handler({ data: "v1", sampleRate: 16000, hasVoice: true, energy: 0.1 });
      handler({ data: "t1", sampleRate: 16000, hasVoice: false, energy: 0 });

      handler({ data: "v2", sampleRate: 16000, hasVoice: true, energy: 0.1 });

      expect(svc.sttConnection.sendAudio).toHaveBeenCalledTimes(3);
    });
  });

  // -- SessionGuard integration ---------------------------------------------

  describe("SessionGuard integration", () => {
    it("starts session guard during startSession", async () => {
      svc = createInitializedService();
      await svc.startSession();

      expect(svc.sessionGuard.start).toHaveBeenCalledWith(
        expect.objectContaining({
          onTimeout: expect.any(Function),
          onIdle: expect.any(Function),
          onHidden: expect.any(Function),
          onVisible: expect.any(Function),
          onHiddenExpired: expect.any(Function),
        }),
      );
    });

    it("does NOT record activity on voiceActivity (only transcribed text resets idle)", async () => {
      svc = createInitializedService();
      await svc.startSession();
      svc.sessionGuard.recordActivity.mockClear();

      const handler = getAudioCaptureListenerFor(svc, "voiceActivity");
      handler({ speaking: true });

      expect(svc.sessionGuard.recordActivity).not.toHaveBeenCalled();
    });

    it("records activity on STT committed", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const handler = getSTTListenerFor(svc, "committed");
      handler({ text: "hello" });

      expect(svc.sessionGuard.recordActivity).toHaveBeenCalled();
    });

    it("onTimeout ends session with max_duration reason", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const timeoutHandler = jest.fn();
      svc.on("session:timeout", timeoutHandler);
      const endedHandler = jest.fn();
      svc.on("session:ended", endedHandler);

      const guardCallbacks = svc.sessionGuard.start.mock.calls[0][0];
      guardCallbacks.onTimeout();

      expect(timeoutHandler).toHaveBeenCalledWith({
        reason: "max_duration",
      });
      expect(endedHandler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "max_duration" }),
      );
    });

    it("onIdle ends session with idle reason", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const endedHandler = jest.fn();
      svc.on("session:ended", endedHandler);

      const guardCallbacks = svc.sessionGuard.start.mock.calls[0][0];
      guardCallbacks.onIdle();

      expect(endedHandler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "idle" }),
      );
    });

    it("onHidden pauses audio capture", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const pausedHandler = jest.fn();
      svc.on("session:paused", pausedHandler);

      const guardCallbacks = svc.sessionGuard.start.mock.calls[0][0];
      guardCallbacks.onHidden();

      expect(svc.audioCapture.pause).toHaveBeenCalled();
      expect(pausedHandler).toHaveBeenCalledWith({
        reason: "tab_hidden",
      });
    });

    it("onVisible resumes audio capture", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const resumedHandler = jest.fn();
      svc.on("session:resumed", resumedHandler);

      const guardCallbacks = svc.sessionGuard.start.mock.calls[0][0];
      guardCallbacks.onVisible();

      expect(svc.audioCapture.resume).toHaveBeenCalled();
      expect(resumedHandler).toHaveBeenCalled();
    });

    it("onHiddenExpired ends session with tab_hidden reason", async () => {
      svc = createInitializedService();
      await svc.startSession();

      const endedHandler = jest.fn();
      svc.on("session:ended", endedHandler);

      const guardCallbacks = svc.sessionGuard.start.mock.calls[0][0];
      guardCallbacks.onHiddenExpired();

      expect(endedHandler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "tab_hidden" }),
      );
    });

    it("destroyed with VoiceService", async () => {
      svc = createInitializedService();
      await svc.startSession();

      svc.destroy();

      expect(svc.sessionGuard).toBeNull();
    });
  });
});
