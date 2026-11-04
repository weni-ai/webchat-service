import VoiceService from '../VoiceService';

describe('voice session', () => {
  const host = {
    emit: jest.fn(),
    config: { maxReconnectAttempts: 2 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    host.emit.mockClear();
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

  test('speak moves to speaking and back to listening', async () => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak: (utterance: SpeechSynthesisUtterance) =>
          utterance.onend?.(new Event('end') as SpeechSynthesisEvent),
        cancel: jest.fn(),
      },
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
  });
});
