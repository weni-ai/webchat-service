/**
 * ElevenLabs TTS over a single-use-token WebSocket, played with the Web Audio API.
 * Callers pass getConnectionUrl so each connection gets a fresh token.
 */

const CONNECTION_TIMEOUT_MS = 10000;
const FIRST_CHUNK_TIMEOUT_MS = 10000;
const INTER_CHUNK_TIMEOUT_MS = 600;
const MAX_RECONNECT_ATTEMPTS = 2;

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function mergeAudioChunks(chunks: ArrayBuffer[]): ArrayBuffer {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  });
  return result.buffer;
}

export default class TTSPlayer {
  private socket: WebSocket | null = null;

  private connected = false;

  private audioContext: AudioContext | null = null;

  private gain: GainNode | null = null;

  private source: AudioBufferSourceNode | null = null;

  private pendingChunks: string[] = [];

  private resolveCollection: ((chunks: string[]) => void) | null = null;

  private rejectCollection: ((error: Error) => void) | null = null;

  private audioTimer: ReturnType<typeof setTimeout> | null = null;

  private collecting = false;

  private stopped = false;

  constructor(private readonly getConnectionUrl: () => Promise<string>) {}

  async speak(text: string): Promise<void> {
    this.stopped = false;
    await this.ensureConnected();
    this.ensureAudio();
    const pending = this.collectAudio();
    this.socket?.send(JSON.stringify({ text: `${text} `, flush: true }));
    const chunks = await pending;
    if (this.stopped || chunks.length === 0 || !this.audioContext) return;
    const merged = mergeAudioChunks(chunks.map(base64ToArrayBuffer));
    const buffer = await this.audioContext.decodeAudioData(merged);
    if (this.stopped) return;
    await this.play(buffer);
  }

  cancel(): void {
    this.stopped = true;
    this.cancelCollection();
    this.stopSource();
    this.disconnect();
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) return;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      try {
        const url = await this.getConnectionUrl();
        await this.connect(url);
        return;
      } catch (error) {
        lastError = error;
        if (
          error instanceof Error &&
          (error.message.startsWith('ttsModel') ||
            error.message.startsWith('audioFormat'))
        ) {
          throw error;
        }
        if (attempt < MAX_RECONNECT_ATTEMPTS) {
          await new Promise((resolve) => {
            setTimeout(resolve, 1000 * (attempt + 1));
          });
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to connect ElevenLabs TTS');
  }

  private connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.cleanupSocket();
      let settled = false;
      const finish = (fn: (value?: unknown) => void, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn(value);
      };
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('TTS socket failed'));
        return;
      }
      this.socket = socket;
      const timeout = setTimeout(() => {
        finish(reject, new Error('TTS WebSocket connection timed out'));
        this.cleanupSocket();
      }, CONNECTION_TIMEOUT_MS);

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            text: ' ',
            generation_config: { chunk_length_schedule: [50] },
          }),
        );
        this.connected = true;
        finish(resolve);
      };
      socket.onmessage = (event) => {
        let message: { audio?: string; isFinal?: boolean };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.audio && this.collecting) this.takeChunk(message.audio);
        if (message.isFinal) this.flushCollection();
      };
      socket.onerror = () => {
        finish(reject, new Error('TTS WebSocket error'));
      };
      socket.onclose = (event) => {
        this.connected = false;
        if (!settled) {
          const auth = event.code === 1008;
          finish(
            reject,
            new Error(auth ? 'TTS auth rejected' : 'TTS WebSocket closed'),
          );
        }
        if (this.collecting) {
          this.rejectCollection?.(
            new Error('TTS WebSocket closed during audio'),
          );
          this.cancelCollection();
        }
      };
    });
  }

  private collectAudio(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.pendingChunks = [];
      this.resolveCollection = resolve;
      this.rejectCollection = reject;
      this.collecting = true;
      this.armTimer(FIRST_CHUNK_TIMEOUT_MS);
    });
  }

  private takeChunk(audio: string): void {
    this.pendingChunks.push(audio);
    this.armTimer(INTER_CHUNK_TIMEOUT_MS);
  }

  private armTimer(ms: number): void {
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.audioTimer = setTimeout(() => this.flushCollection(), ms);
  }

  private flushCollection(): void {
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.audioTimer = null;
    if (!this.resolveCollection) return;
    const chunks = [...this.pendingChunks];
    this.pendingChunks = [];
    const resolve = this.resolveCollection;
    this.resolveCollection = null;
    this.rejectCollection = null;
    this.collecting = false;
    resolve(chunks);
  }

  private cancelCollection(): void {
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.audioTimer = null;
    this.pendingChunks = [];
    this.resolveCollection = null;
    this.rejectCollection = null;
    this.collecting = false;
  }

  private ensureAudio(): void {
    if (this.audioContext) return;
    const Context =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Context) throw new Error('tts unavailable');
    this.audioContext = new Context();
    this.gain = this.audioContext.createGain();
    this.gain.connect(this.audioContext.destination);
  }

  private play(buffer: AudioBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped || !this.audioContext || !this.gain) {
        resolve();
        return;
      }
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);
      this.source = source;
      source.onended = () => {
        this.source = null;
        resolve();
      };
      try {
        source.start(0);
      } catch (error) {
        this.source = null;
        reject(error instanceof Error ? error : new Error('playback failed'));
      }
    });
  }

  private stopSource(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      // Already stopped.
    }
    this.source = null;
  }

  private disconnect(): void {
    this.connected = false;
    if (!this.socket) return;
    try {
      this.socket.send(JSON.stringify({ text: '' }));
    } catch {
      // Closing.
    }
    try {
      this.socket.close(1000, 'Client disconnect');
    } catch {
      // Already closed.
    }
    this.socket = null;
  }

  private cleanupSocket(): void {
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      try {
        this.socket.close();
      } catch {
        // Ignore.
      }
    }
    this.socket = null;
    this.connected = false;
  }
}
