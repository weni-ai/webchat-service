import RetryStrategy from '../../network/RetryStrategy';

type TranscriptHandler = (text: string) => void;

/** Final transcripts only. Partials are ignored. */
export default class STTConnection {
  private socket: WebSocket | null = null;

  private readonly retry = new RetryStrategy({
    baseDelay: 1000,
    maxDelay: 30000,
    factor: 2,
    jitter: false,
    maxJitter: 0,
  });

  constructor(private readonly onFinal: TranscriptHandler) {}

  connect(url: string): void {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event) => {
      const data = JSON.parse(String(event.data)) as {
        text?: string;
        isFinal?: boolean;
      };
      if (data.isFinal && data.text) this.onFinal(data.text);
    });
  }

  onDrop(maxAttempts: number): number {
    const attempt = this.retry.getAttempts();
    if (attempt >= maxAttempts) return attempt;
    this.retry.getDelay(attempt);
    return attempt + 1;
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
