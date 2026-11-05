import { BackInStockClient } from '../../network/BackInStockClient';
import {
  buildBackInStockRequest,
  normalizeSkuId,
} from '../../utils/backInStockRequestBuilder';
import type { BackInStockRequestInput } from '../../utils/backInStockRequestBuilder';
import { validateBackInStockContact } from './contact';
import { BackInStockError } from './error';
import type { BackInStockFieldErrors } from './error';

export interface BackInStockOptions {
  subscribePath?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

interface ResolvedOptions {
  subscribePath: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

type Emit = (event: string, payload: Record<string, unknown>) => void;

const SUBSCRIBED = 'backInStock:subscribed';
const FAILED = 'backInStock:error';

function resolved(options: BackInStockOptions = {}): ResolvedOptions {
  return {
    subscribePath: options.subscribePath || '',
    timeoutMs: options.timeoutMs ?? 0,
    maxRetries: options.maxRetries ?? 0,
    retryBaseDelayMs: options.retryBaseDelayMs ?? 0,
  };
}

/**
 * One subscription helper per service instance. The pending map is not
 * shared, so two instances and two tests do not collapse each other's calls.
 */
export class BackInStockSubscription {
  private readonly pending = new Map<string, Promise<{ accepted: boolean }>>();

  private readonly options: ResolvedOptions;

  private readonly client: BackInStockClient;

  private readonly emit: Emit;

  constructor(deps: { emit: Emit; options?: BackInStockOptions }) {
    this.emit = deps.emit;
    this.options = resolved(deps.options);
    this.client = new BackInStockClient({
      timeoutMs: this.options.timeoutMs,
      maxRetries: this.options.maxRetries,
      retryBaseDelayMs: this.options.retryBaseDelayMs,
    });
  }

  subscribe(
    input: BackInStockRequestInput = {},
  ): Promise<{ accepted: boolean }> {
    const body = buildBackInStockRequest(input);
    const contact = validateBackInStockContact({
      name: input.name,
      phone: input.phone,
    });
    const fields: BackInStockFieldErrors = { ...contact.errors };
    if (normalizeSkuId(input.skuId) === '') fields.skuId = 'required';

    if (Object.keys(fields).length > 0) {
      const error = new BackInStockError('VALIDATION', {
        skuId: body.sku_id,
        fields,
      });
      this.emit(FAILED, {
        code: error.code,
        skuId: error.skuId,
        fields: error.fields,
      });
      return Promise.reject(error);
    }

    const key = `${body.sku_id}:${body.phone}`;
    const current = this.pending.get(key);
    if (current) return current;

    const promise = this.send(body).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, promise);
    return promise;
  }

  private async send(
    body: ReturnType<typeof buildBackInStockRequest>,
  ): Promise<{ accepted: boolean }> {
    try {
      const result = await this.client.post(this.options.subscribePath, body);
      this.emit(SUBSCRIBED, {
        skuId: body.sku_id,
        accepted: result.accepted,
      });
      return result;
    } catch (error) {
      const wrapped =
        error instanceof BackInStockError
          ? error
          : new BackInStockError('NETWORK', { skuId: body.sku_id });
      const payload = {
        code: wrapped.code,
        skuId: body.sku_id,
        status: wrapped.status,
        attempt: wrapped.attempt,
        fields: wrapped.fields,
      };
      this.emit(FAILED, payload);
      if (wrapped.code !== 'VALIDATION') {
        console.warn('[WebChatService:BackInStock]', {
          operation: 'subscribeBackInStock',
          code: wrapped.code,
          skuId: body.sku_id,
          status: wrapped.status,
          attempt: wrapped.attempt,
        });
      }
      throw new BackInStockError(wrapped.code, {
        skuId: body.sku_id,
        status: wrapped.status,
        attempt: wrapped.attempt,
        fields: wrapped.fields,
      });
    }
  }
}
