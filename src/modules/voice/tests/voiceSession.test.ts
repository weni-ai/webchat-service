import VoiceService from '../VoiceService';

describe('voice session', () => {
  const host = {
    emit: jest.fn(),
    config: {
      maxReconnectAttempts: 2,
      voiceMode: {
        ttsModel: 'eleven_flash_v2_5',
        elevenLabs: { voiceId: 'voice-1' },
      },
    },
    requestVoiceTokens: jest.fn().mockResolvedValue({
      sttToken: 'stt',
      ttsToken: 'tts-token',
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    host.emit.mockClear();
    host.config.voiceMode.ttsModel = 'eleven_flash_v2_5';
  });

  test('permission denial emits voice:error and does not start capture', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockRejectedValue(new Error('denied')),
      },
    });

    const voice = new VoiceService(host);
    await expect(voice.enter()).rejects.toThrow('permission denied');
    expect(host.emit).toHaveBeenCalledWith('voice:error', {
      operation: 'permission',
    });
    expect(voice.getState()).toBe('idle');
  });

  test('a final transcript does not send a chat message and exit returns to idle', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue({
          getTracks: () => [{ stop: jest.fn() }],
        }),
      },
    });
    const voice = new VoiceService(host);
    await voice.enter();
    voice.emitTranscript('hello', 'm1');

    expect(host.emit).toHaveBeenCalledWith('voice:transcript', {
      text: 'hello',
      messageId: 'm1',
    });
    expect(host.emit.mock.calls.map((call) => call[0])).not.toContain(
      'message:sent',
    );

    voice.exit();
    expect(voice.getState()).toBe('idle');
    expect(host.emit).toHaveBeenCalledWith('voice:state', { state: 'idle' });
  });

  test('speak uses the ElevenLabs model and does not use speechSynthesis', async () => {
    const opened: string[] = [];
    const sent: string[] = [];
    class FakeSocket {
      url: string;

      onopen: (() => void) | null = null;

      onmessage: ((event: { data: string }) => void) | null = null;

      onerror: (() => void) | null = null;

      onclose: ((event: { code: number }) => void) | null = null;

      readyState = 1;

      constructor(url: string) {
        this.url = url;
        opened.push(url);
        queueMicrotask(() => this.onopen?.());
      }

      send(payload: string) {
        sent.push(payload);
        const body = JSON.parse(payload) as { text?: string; flush?: boolean };
        if (body.flush) {
          this.onmessage?.({
            data: JSON.stringify({ audio: btoa('hi'), isFinal: true }),
          });
        }
      }

      close() {
        this.readyState = 3;
      }
    }
    (global as { WebSocket: unknown }).WebSocket = FakeSocket;
    (window as { AudioContext: unknown }).AudioContext = class {
      destination = {};

      currentTime = 0;

      createGain() {
        return {
          connect() {},
          gain: {
            value: 1,
            setValueAtTime() {},
            cancelScheduledValues() {},
            exponentialRampToValueAtTime() {},
          },
        };
      }

      decodeAudioData() {
        return Promise.resolve({});
      }

      createBufferSource() {
        return {
          buffer: null,
          connect() {},
          start() {
            this.onended?.();
          },
          stop() {},
          onended: null as (() => void) | null,
        };
      }

      close() {}
    };
    const speak = jest.fn();
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak, cancel: jest.fn() },
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue({
          getTracks: () => [{ stop: jest.fn() }],
        }),
      },
    });

    const voice = new VoiceService(host);
    await voice.enter();
    await voice.speak('Hello.', 'm2');

    const states = host.emit.mock.calls
      .filter((call) => call[0] === 'voice:state')
      .map((call) => (call[1] as { state: string }).state);
    expect(states).toEqual(['listening', 'speaking', 'listening']);
    expect(opened[0]).toContain(
      'wss://api.elevenlabs.io/v1/text-to-speech/voice-1/stream-input',
    );
    expect(opened[0]).toContain('model_id=eleven_flash_v2_5');
    expect(opened[0]).toContain('single_use_token=tts-token');
    expect(sent.some((payload) => payload.includes('Hello.'))).toBe(true);
    expect(speak).not.toHaveBeenCalled();
  });

  test('an unknown tts model does not open ElevenLabs', async () => {
    host.config.voiceMode.ttsModel = 'not-a-model';
    const voice = new VoiceService(host);
    await voice.speak('Hello.', 'm3');
    expect(host.emit).toHaveBeenCalledWith('voice:error', { operation: 'tts' });
    expect(host.requestVoiceTokens).not.toHaveBeenCalled();
  });
});
