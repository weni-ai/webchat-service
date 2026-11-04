import AudioCapture from './AudioCapture';
import EchoGuard from './EchoGuard';
import SessionGuard from './SessionGuard';
import TTSPlayer from './TTSPlayer';
import TextChunker from './TextChunker';
import { VoiceError } from './errors';

export type VoiceStateName = 'idle' | 'listening' | 'speaking';

interface VoiceHost {
  emit(event: string, payload?: unknown): void;
  config: { maxReconnectAttempts?: number };
}

/**
 * Voice session transitions. Does not call sendMessage.
 * Tokens and transcripts are not written to logs.
 */
export default class VoiceService {
  private state: VoiceStateName = 'idle';

  private readonly capture = new AudioCapture();

  private readonly player = new TTSPlayer();

  private readonly echo = new EchoGuard();

  private readonly guard = new SessionGuard();

  private readonly chunker = new TextChunker();

  private lastSpokenMessageId = '';

  constructor(private readonly host: VoiceHost) {}

  getState(): VoiceStateName {
    return this.state;
  }

  async enter(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail('unsupported');
      throw new VoiceError('unsupported', 'unsupported');
    }
    const granted = await this.capture.requestPermission();
    if (!granted) {
      this.fail('permission');
      throw new VoiceError('permission denied', 'permission');
    }
    this.guard.enter();
    this.setState('listening');
  }

  exit(): void {
    this.player.cancel();
    this.guard.exit();
    this.setState('idle');
  }

  async speak(text: string, messageId: string): Promise<void> {
    this.lastSpokenMessageId = messageId;
    if (!text.trim() || !this.echo.shouldPlay()) return;
    this.setState('speaking');
    try {
      for (const chunk of this.chunker.chunk(text)) {
        await this.player.speak(chunk);
      }
      if (this.guard.isActive()) this.setState('listening');
    } catch {
      this.host.emit('voice:error', { operation: 'tts' });
      console.warn('VoiceService: playback failed', {
        operation: 'tts',
        connectionState: this.state,
      });
      if (this.guard.isActive()) this.setState('listening');
    }
  }

  emitTranscript(text: string, messageId: string): void {
    this.host.emit('voice:transcript', { text, messageId });
  }

  private setState(state: VoiceStateName): void {
    this.state = state;
    this.host.emit('voice:state', { state });
  }

  private fail(operation: 'permission' | 'unsupported'): void {
    this.host.emit('voice:error', { operation });
    console.warn('VoiceService: entry failed', {
      operation,
      connectionState: this.state,
    });
  }
}
