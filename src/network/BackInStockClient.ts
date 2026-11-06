import { BackInStockError } from '../modules/backInStock/error';
import type { BackInStockRequestBody } from '../utils/backInStockRequestBuilder';

export interface BackInStockClientOptions {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  fetchImpl?: typeof fetch;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error != null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

async function readAccepted(response: Response): Promise<boolean> {
  try {
    const data = (await response.json()) as { accepted?: unknown };
    return data?.accepted === false ? false : true;
  } catch {
    return true;
  }
}

/**
 * POST helper for the back-in-stock route. Retries are safe because the
 * storefront deduplicates waiters. The delay is 500 ms then 1 s at the
 * defaults: base * 2^(attempt - 1), where attempt is 1-based.
 */
export class BackInStockClient {
  constructor(private readonly options: BackInStockClientOptions) {}

  async post(
    path: string,
    body: BackInStockRequestBody,
  ): Promise<{ accepted: boolean }> {
    const attempts = this.options.maxRetries + 1;
    let lastError: BackInStockError | undefined;

    for (let index = 0; index < attempts; index += 1) {
      const attempt = index + 1;
      try {
        const accepted = await this.once(path, body, attempt);
        return { accepted };
      } catch (error) {
        const wrapped = this.asError(error, attempt);
        const retriable =
          wrapped.code === 'NETWORK' ||
          wrapped.code === 'TIMEOUT' ||
          (wrapped.code === 'HTTP' &&
            (wrapped.status === 429 || (wrapped.status ?? 0) >= 500));
        if (!retriable || attempt === attempts) throw wrapped;
        lastError = wrapped;
        await wait(this.options.retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }

    throw lastError ?? new BackInStockError('NETWORK', { attempt: attempts });
  }

  private async once(
    path: string,
    body: BackInStockRequestBody,
    attempt: number,
  ): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const fetchImpl = this.options.fetchImpl ?? fetch;

    try {
      const response = await fetchImpl(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 429 || response.status >= 500) {
        throw new BackInStockError('HTTP', {
          status: response.status,
          attempt,
        });
      }
      if (response.status < 200 || response.status >= 300) {
        throw new BackInStockError('HTTP', {
          status: response.status,
          attempt,
        });
      }
      return readAccepted(response);
    } finally {
      clearTimeout(timer);
    }
  }

  private asError(error: unknown, attempt: number): BackInStockError {
    if (error instanceof BackInStockError) return error;
    if (isAbortError(error)) {
      return new BackInStockError('TIMEOUT', { attempt });
    }
    return new BackInStockError('NETWORK', { attempt });
  }
}
