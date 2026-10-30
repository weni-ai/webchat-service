import {
  AUDIO_CONSTANTS,
  floatTo16BitPCM,
  int16ToBase64,
  audioToBase64PCM,
  downsampleBuffer,
  calculateRMS,
  detectVoiceActivity,
  mergeAudioChunks,
} from '../src/utils/audioUtils';

describe("audioUtils", () => {
  describe("AUDIO_CONSTANTS", () => {
    it("has all expected keys with correct values", () => {
      expect(AUDIO_CONSTANTS.TARGET_SAMPLE_RATE).toBe(16000);
      expect(AUDIO_CONSTANTS.BROWSER_SAMPLE_RATE).toBe(48000);
      expect(AUDIO_CONSTANTS.BUFFER_SIZE).toBe(4096);
      expect(AUDIO_CONSTANTS.VAD_THRESHOLD).toBe(0.01);
    });
  });

  describe("floatTo16BitPCM", () => {
    it("converts 0 to 0", () => {
      const result = floatTo16BitPCM(new Float32Array([0]));
      expect(result[0]).toBe(0);
    });

    it("converts 1 to 0x7FFF (max positive)", () => {
      const result = floatTo16BitPCM(new Float32Array([1]));
      expect(result[0]).toBe(0x7fff);
    });

    it("converts -1 to -0x8000 (max negative)", () => {
      const result = floatTo16BitPCM(new Float32Array([-1]));
      expect(result[0]).toBe(-0x8000);
    });

    it("converts 0.5 to approximately half of max positive", () => {
      const result = floatTo16BitPCM(new Float32Array([0.5]));
      expect(result[0]).toBe(Math.floor(0.5 * 0x7fff));
    });

    it("clamps values beyond [-1, 1]", () => {
      const result = floatTo16BitPCM(new Float32Array([2, -2]));
      expect(result[0]).toBe(0x7fff);
      expect(result[1]).toBe(-0x8000);
    });

    it("returns Int16Array of same length", () => {
      const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
      const result = floatTo16BitPCM(input);
      expect(result).toBeInstanceOf(Int16Array);
      expect(result.length).toBe(5);
    });
  });

  describe("int16ToBase64", () => {
    it("returns a non-empty base64 string", () => {
      const input = new Int16Array([0, 100, -100]);
      const result = int16ToBase64(input);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("roundtrips correctly with known data", () => {
      const original = new Int16Array([0, 1000, -1000, 32767, -32768]);
      const b64 = int16ToBase64(original);
      const decoded = atob(b64);
      const bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) {
        bytes[i] = decoded.charCodeAt(i);
      }
      const restored = new Int16Array(bytes.buffer);
      expect(Array.from(restored)).toEqual(Array.from(original));
    });
  });

  describe("audioToBase64PCM", () => {
    it("combines floatTo16BitPCM and int16ToBase64", () => {
      const input = new Float32Array([0, 1, -1]);
      const result = audioToBase64PCM(input);
      const expected = int16ToBase64(floatTo16BitPCM(input));
      expect(result).toBe(expected);
    });

    it("returns a base64 string", () => {
      const result = audioToBase64PCM(new Float32Array([0.5]));
      expect(typeof result).toBe("string");
      expect(() => atob(result)).not.toThrow();
    });
  });

  describe("downsampleBuffer", () => {
    it("downsamples 48000→16000 with correct output length", () => {
      const input = new Float32Array(4800);
      input.fill(0.5);
      const result = downsampleBuffer(input, 48000, 16000);
      expect(result.length).toBe(Math.round(4800 / 3));
    });

    it("returns same buffer when outputSampleRate >= inputSampleRate", () => {
      const input = new Float32Array([1, 2, 3]);
      const result = downsampleBuffer(input, 16000, 16000);
      expect(result).toBe(input);
    });

    it("returns same buffer when upsampling requested", () => {
      const input = new Float32Array([1, 2, 3]);
      const result = downsampleBuffer(input, 16000, 48000);
      expect(result).toBe(input);
    });

    it("averages samples correctly", () => {
      const input = new Float32Array([1, 2, 3, 4, 5, 6]);
      const result = downsampleBuffer(input, 6, 2);
      expect(result.length).toBe(2);
      expect(result[0]).toBeCloseTo(2, 0);
      expect(result[1]).toBeCloseTo(5, 0);
    });
  });

  describe("calculateRMS", () => {
    it("returns 0 for silence (all zeros)", () => {
      const buffer = new Float32Array(100);
      expect(calculateRMS(buffer)).toBe(0);
    });

    it("returns 1 for full volume (all 1s)", () => {
      const buffer = new Float32Array(100);
      buffer.fill(1);
      expect(calculateRMS(buffer)).toBe(1);
    });

    it("returns 0 for null or empty buffer", () => {
      expect(calculateRMS(null)).toBe(0);
      expect(calculateRMS(new Float32Array(0))).toBe(0);
    });

    it("calculates correctly for known values", () => {
      const buffer = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      expect(calculateRMS(buffer)).toBeCloseTo(0.5, 5);
    });
  });

  describe("detectVoiceActivity", () => {
    it("returns false below default threshold", () => {
      const buffer = new Float32Array(100);
      buffer.fill(0.005);
      expect(detectVoiceActivity(buffer)).toBe(false);
    });

    it("returns true above default threshold", () => {
      const buffer = new Float32Array(100);
      buffer.fill(0.5);
      expect(detectVoiceActivity(buffer)).toBe(true);
    });

    it("respects custom threshold", () => {
      const buffer = new Float32Array(100);
      buffer.fill(0.05);
      expect(detectVoiceActivity(buffer, 0.1)).toBe(false);
      expect(detectVoiceActivity(buffer, 0.01)).toBe(true);
    });

    it("returns false for silence", () => {
      const buffer = new Float32Array(100);
      expect(detectVoiceActivity(buffer)).toBe(false);
    });
  });

  describe("mergeAudioChunks", () => {
    it("merges 2 chunks correctly", () => {
      const chunk1 = new Uint8Array([1, 2, 3]).buffer;
      const chunk2 = new Uint8Array([4, 5, 6]).buffer;
      const result = mergeAudioChunks([chunk1, chunk2]);
      const view = new Uint8Array(result);
      expect(view.length).toBe(6);
      expect(Array.from(view)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("returns empty ArrayBuffer for empty array", () => {
      const result = mergeAudioChunks([]);
      expect(result.byteLength).toBe(0);
    });

    it("returns empty ArrayBuffer for null", () => {
      const result = mergeAudioChunks(null);
      expect(result.byteLength).toBe(0);
    });

    it("handles single chunk", () => {
      const chunk = new Uint8Array([10, 20]).buffer;
      const result = mergeAudioChunks([chunk]);
      expect(new Uint8Array(result)).toEqual(new Uint8Array([10, 20]));
    });
  });
});
