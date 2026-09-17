import {
  DEFAULT_VOICE_CONFIG,
  validateVoiceConfig,
  mergeVoiceConfig,
  buildSTTWebSocketURL,
  buildTTSWebSocketURL,
} from "../../src/modules/voice/config";
import { VoiceError } from "../../src/modules/voice/errors";

const validConfig = {
  elevenLabs: { voiceId: "test-voice-id" },
  getTokens: jest.fn(),
  languageCode: "en",
  ttsModel: "eleven_flash_v2_5",
  audioFormat: "mp3_44100_128",
  silenceThreshold: 1.5,
  vadThreshold: 0.02,
  latencyOptimization: 3,
};

describe("voice/config", () => {
  describe("DEFAULT_VOICE_CONFIG", () => {
    it("has correct default languageCode", () => {
      expect(DEFAULT_VOICE_CONFIG.languageCode).toBe("en");
    });

    it("has correct default ttsModel", () => {
      expect(DEFAULT_VOICE_CONFIG.ttsModel).toBe("eleven_flash_v2_5");
    });

    it("has correct default silenceThreshold", () => {
      expect(DEFAULT_VOICE_CONFIG.silenceThreshold).toBe(1.5);
    });

    it("has correct default sttModel", () => {
      expect(DEFAULT_VOICE_CONFIG.sttModel).toBe("scribe_v2_realtime");
    });

    it("has correct default sampleRate", () => {
      expect(DEFAULT_VOICE_CONFIG.sampleRate).toBe(16000);
    });

    it("has null getTokens", () => {
      expect(DEFAULT_VOICE_CONFIG.getTokens).toBeNull();
    });

    it("has texts object with expected keys", () => {
      expect(DEFAULT_VOICE_CONFIG.texts).toEqual({
        title: "",
        listening: "",
        microphoneHint: "",
        speaking: "",
        processing: "",
        errorTitle: "",
      });
    });
  });

  describe("validateVoiceConfig", () => {
    it("passes for valid config", () => {
      const { valid, errors } = validateVoiceConfig(validConfig);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it("passes when elevenLabs.voiceId is empty (optional)", () => {
      const { valid } = validateVoiceConfig({
        ...validConfig,
        elevenLabs: { voiceId: "" },
      });
      expect(valid).toBe(true);
    });

    it("fails when getTokens is not a function", () => {
      const { valid, errors } = validateVoiceConfig({
        ...validConfig,
        getTokens: null,
      });
      expect(valid).toBe(false);
      expect(errors[0]).toMatch(/getTokens must be a function/);
    });

    it("fails when silenceThreshold is out of range (too low)", () => {
      const { valid, errors } = validateVoiceConfig({
        ...validConfig,
        silenceThreshold: 0.1,
      });
      expect(valid).toBe(false);
      expect(errors).toContain(
        "silenceThreshold must be a number between 0.3 and 3.0",
      );
    });

    it("fails when silenceThreshold is out of range (too high)", () => {
      const { valid, errors } = validateVoiceConfig({
        ...validConfig,
        silenceThreshold: 5,
      });
      expect(valid).toBe(false);
      expect(errors).toContain(
        "silenceThreshold must be a number between 0.3 and 3.0",
      );
    });

    it("fails when vadThreshold is out of range", () => {
      const { valid, errors } = validateVoiceConfig({
        ...validConfig,
        vadThreshold: 0.001,
      });
      expect(valid).toBe(false);
      expect(errors).toContain(
        "vadThreshold must be a number between 0.01 and 0.5",
      );
    });

    it("fails when latencyOptimization is out of range", () => {
      const { valid, errors } = validateVoiceConfig({
        ...validConfig,
        latencyOptimization: 5,
      });
      expect(valid).toBe(false);
      expect(errors).toContain(
        "latencyOptimization must be an integer between 0 and 4",
      );
    });

    it("fails when ttsModel is invalid", () => {
      const { valid, errors } = validateVoiceConfig({
        ...validConfig,
        ttsModel: "bad_model",
      });
      expect(valid).toBe(false);
      expect(errors[0]).toMatch(/ttsModel must be one of/);
    });

    it("fails when audioFormat is invalid", () => {
      const { valid, errors } = validateVoiceConfig({
        ...validConfig,
        audioFormat: "wav_8000",
      });
      expect(valid).toBe(false);
      expect(errors[0]).toMatch(/audioFormat must be one of/);
    });

    it("collects multiple errors at once", () => {
      const { valid, errors } = validateVoiceConfig({
        elevenLabs: { voiceId: "" },
        getTokens: null,
        silenceThreshold: 99,
        vadThreshold: 99,
        latencyOptimization: 99,
        ttsModel: "bad",
        audioFormat: "bad",
      });
      expect(valid).toBe(false);
      expect(errors.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("mergeVoiceConfig", () => {
    it("merges user config with defaults", () => {
      const merged = mergeVoiceConfig({
        elevenLabs: { voiceId: "v1" },
        getTokens: jest.fn(),
      });
      expect(merged.elevenLabs.voiceId).toBe("v1");
      expect(merged.languageCode).toBe("en");
      expect(merged.ttsModel).toBe("eleven_flash_v2_5");
      expect(merged.silenceThreshold).toBe(1.5);
    });

    it("deep-merges elevenLabs", () => {
      const merged = mergeVoiceConfig({
        elevenLabs: { voiceId: "v1" },
        getTokens: jest.fn(),
      });
      expect(merged.elevenLabs.voiceId).toBe("v1");
    });

    it("deep-merges texts", () => {
      const merged = mergeVoiceConfig({
        elevenLabs: { voiceId: "v1" },
        getTokens: jest.fn(),
        texts: { title: "Voice" },
      });
      expect(merged.texts.title).toBe("Voice");
      expect(merged.texts.listening).toBe("");
    });

    it("throws VoiceError on invalid config (missing getTokens)", () => {
      expect(() => mergeVoiceConfig({})).toThrow(VoiceError);
    });

    it("includes validation errors in thrown message", () => {
      try {
        mergeVoiceConfig({});
        fail("should have thrown");
      } catch (err) {
        expect(err.message).toMatch(/Invalid voice configuration/);
        expect(err.message).toMatch(/getTokens/);
      }
    });

    it("uses default voiceId when none provided", () => {
      const merged = mergeVoiceConfig({
        getTokens: jest.fn(),
      });
      expect(merged.elevenLabs.voiceId).toBe("21m00Tcm4TlvDq8ikWAM");
    });

    it("uses default voiceId when voiceId is empty string", () => {
      const merged = mergeVoiceConfig({
        elevenLabs: { voiceId: "" },
        getTokens: jest.fn(),
      });
      expect(merged.elevenLabs.voiceId).toBe("21m00Tcm4TlvDq8ikWAM");
    });

    it("preserves user-provided voiceId", () => {
      const merged = mergeVoiceConfig({
        elevenLabs: { voiceId: "custom-voice" },
        getTokens: jest.fn(),
      });
      expect(merged.elevenLabs.voiceId).toBe("custom-voice");
    });

    it("forces silenceThreshold, enableBargeIn, autoListen to defaults", () => {
      const merged = mergeVoiceConfig({
        elevenLabs: { voiceId: "v1" },
        getTokens: jest.fn(),
        silenceThreshold: 3.0,
        enableBargeIn: false,
        autoListen: false,
      });
      expect(merged.silenceThreshold).toBe(1.5);
      expect(merged.enableBargeIn).toBe(true);
      expect(merged.autoListen).toBe(true);
    });
  });

  describe("buildSTTWebSocketURL", () => {
    const config = {
      sttModel: "scribe_v2_realtime",
      silenceThreshold: 1.5,
      sttVadThreshold: 0.4,
      minSpeechDuration: 100,
      minSilenceDuration: 100,
      languageCode: "en",
    };

    it("has correct base URL", () => {
      const url = buildSTTWebSocketURL(config, "tok123");
      expect(
        url.startsWith("wss://api.elevenlabs.io/v1/speech-to-text/realtime?"),
      ).toBe(true);
    });

    it("includes token in query params", () => {
      const url = buildSTTWebSocketURL(config, "tok123");
      const params = new URL(url).searchParams;
      expect(params.get("token")).toBe("tok123");
    });

    it("includes audio_format=pcm_16000", () => {
      const url = buildSTTWebSocketURL(config, "tok123");
      const params = new URL(url).searchParams;
      expect(params.get("audio_format")).toBe("pcm_16000");
    });

    it("includes vad_silence_threshold_secs in seconds", () => {
      const url = buildSTTWebSocketURL(config, "tok123");
      const params = new URL(url).searchParams;
      expect(params.get("vad_silence_threshold_secs")).toBe("1.5");
    });

    it("includes min_speech_duration_ms without vad_ prefix", () => {
      const url = buildSTTWebSocketURL(config, "tok123");
      const params = new URL(url).searchParams;
      expect(params.get("min_speech_duration_ms")).toBe("100");
      expect(params.has("vad_min_speech_duration_ms")).toBe(false);
    });

    it("does not include vad_prefix_padding_ms", () => {
      const url = buildSTTWebSocketURL(config, "tok123");
      const params = new URL(url).searchParams;
      expect(params.has("vad_prefix_padding_ms")).toBe(false);
    });

    it("includes language_code when present", () => {
      const url = buildSTTWebSocketURL(config, "tok123");
      const params = new URL(url).searchParams;
      expect(params.get("language_code")).toBe("en");
    });

    it("omits language_code when empty", () => {
      const url = buildSTTWebSocketURL(
        { ...config, languageCode: "" },
        "tok123",
      );
      const params = new URL(url).searchParams;
      expect(params.has("language_code")).toBe(false);
    });
  });

  describe("buildTTSWebSocketURL", () => {
    const config = {
      ttsModel: "eleven_flash_v2_5",
      audioFormat: "mp3_44100_128",
      languageCode: "en",
    };

    it("includes voiceId in path", () => {
      const url = buildTTSWebSocketURL("v123", config, "tok456");
      expect(url).toContain("/text-to-speech/v123/stream-input");
    });

    it("uses wss:// protocol", () => {
      const url = buildTTSWebSocketURL("v123", config, "tok456");
      expect(url.startsWith("wss://")).toBe(true);
    });

    it("includes single_use_token in query params", () => {
      const url = buildTTSWebSocketURL("v123", config, "tok456");
      const params = new URL(url).searchParams;
      expect(params.get("single_use_token")).toBe("tok456");
    });

    it("includes model_id query param", () => {
      const url = buildTTSWebSocketURL("v123", config, "tok456");
      const params = new URL(url).searchParams;
      expect(params.get("model_id")).toBe("eleven_flash_v2_5");
    });

    it("includes output_format query param", () => {
      const url = buildTTSWebSocketURL("v123", config, "tok456");
      const params = new URL(url).searchParams;
      expect(params.get("output_format")).toBe("mp3_44100_128");
    });

    it("includes inactivity_timeout", () => {
      const url = buildTTSWebSocketURL("v123", config, "tok456");
      const params = new URL(url).searchParams;
      expect(params.get("inactivity_timeout")).toBe("120");
    });

    it("includes language_code when present", () => {
      const url = buildTTSWebSocketURL("v123", config, "tok456");
      const params = new URL(url).searchParams;
      expect(params.get("language_code")).toBe("en");
    });

    it("omits language_code when empty", () => {
      const url = buildTTSWebSocketURL(
        "v123",
        { ...config, languageCode: "" },
        "tok456",
      );
      const params = new URL(url).searchParams;
      expect(params.has("language_code")).toBe(false);
    });

    it("does not include xi-api-key", () => {
      const url = buildTTSWebSocketURL("v123", config, "tok456");
      expect(url).not.toContain("xi-api-key");
      expect(url).not.toContain("api_key");
    });

    it("falls back to default voiceId when empty", () => {
      const url = buildTTSWebSocketURL("", config, "tok456");
      expect(url).toContain("/text-to-speech/21m00Tcm4TlvDq8ikWAM/");
      expect(url).not.toContain("//stream-input");
    });

    it("falls back to default voiceId when null", () => {
      const url = buildTTSWebSocketURL(null, config, "tok456");
      expect(url).toContain("/text-to-speech/21m00Tcm4TlvDq8ikWAM/");
    });
  });
});
