import fs from 'fs';
import path from 'path';

import { BackInStockSubscription } from '../src/modules/backInStock/subscription';

const options = {
  subscribePath: '/_v/private/availability-notify/subscribe',
  timeoutMs: 10000,
  maxRetries: 2,
  retryBaseDelayMs: 500,
};

const valid = {
  name: ' Ana ',
  phone: '+55 (11) 98888-7777',
  skuId: '00027',
  seller: '9',
  salesChannel: '3',
  storeLocales: ['en', 'en-US'],
  language: 'pt',
};

function response(status: number, body?: unknown) {
  return {
    status,
    json: async () => {
      if (body === undefined) throw new Error('no json');
      return body;
    },
  };
}

function create(overrides = {}) {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const subscription = new BackInStockSubscription({
    emit: (event, payload) => events.push({ event, payload }),
    options: { ...options, ...overrides },
  });
  return { subscription, events };
}

describe('subscribeBackInStock', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('posts the normalized body and resolves accepted true when the body omits it', async () => {
    fetchMock.mockResolvedValue(response(200));
    const { subscription, events } = create();

    await expect(subscription.subscribe(valid)).resolves.toEqual({
      accepted: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      options.subscribePath,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      sku_id: '27',
      phone: '5511988887777',
      name: 'Ana',
      seller: '9',
      sales_channel: '3',
      locale: 'en-US',
    });
    expect(events[0]).toEqual({
      event: 'backInStock:subscribed',
      payload: { skuId: '27', accepted: true },
    });
  });

  it.each([
    [{ storeLocales: ['pt', 'pt-BR'], language: 'en' }, 'pt-BR'],
    [{ storeLocales: [], language: 'es-ES' }, 'es-ES'],
    [{ language: 'pt' }, 'pt-BR'],
    [{ language: 'en' }, 'en-US'],
    [{ language: 'es' }, 'es-ES'],
    [{ language: 'ro' }, 'ro-RO'],
    [{ language: 'fr' }, 'fr'],
    [{}, 'pt-BR'],
  ])('resolves locale %j to %s', async (extra, locale) => {
    fetchMock.mockResolvedValue(response(200, { accepted: true }));
    const { subscription } = create();
    await subscription.subscribe({
      name: 'Ana',
      phone: '5511988887777',
      skuId: '27',
      ...extra,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).locale).toBe(locale);
  });

  it('defaults a null seller and sales channel to 1', async () => {
    fetchMock.mockResolvedValue(response(200, { accepted: false }));
    const { subscription } = create();
    await expect(
      subscription.subscribe({
        name: 'Ana',
        phone: '5511988887777',
        skuId: '27',
        seller: null,
        salesChannel: null,
      }),
    ).resolves.toEqual({ accepted: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      seller: '1',
      sales_channel: '1',
    });
  });

  it('retries 503 then accepts, waiting 500 ms and then 1 s', async () => {
    fetchMock
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(response(200, { accepted: true }));
    const { subscription } = create();
    const pending = subscription.subscribe(valid);

    await jest.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ accepted: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects HTTP 400 without a retry', async () => {
    fetchMock.mockResolvedValue(response(400, { message: 'no' }));
    const { subscription, events } = create();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(subscription.subscribe(valid)).rejects.toMatchObject({
      code: 'HTTP',
      status: 400,
      attempt: 1,
      skuId: '27',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events[0].event).toBe('backInStock:error');
    expect(events[0].payload).not.toHaveProperty('name');
    expect(events[0].payload).not.toHaveProperty('phone');
    expect(warn).toHaveBeenCalledWith(
      '[WebChatService:BackInStock]',
      expect.objectContaining({ code: 'HTTP', skuId: '27', attempt: 1 }),
    );
    warn.mockRestore();
  });

  it('rejects after three 503 responses with attempt 3', async () => {
    fetchMock.mockResolvedValue(response(503, {}));
    const { subscription } = create();
    const pending = expect(subscription.subscribe(valid)).rejects.toMatchObject(
      {
        code: 'HTTP',
        status: 503,
        attempt: 3,
      },
    );
    await jest.advanceTimersByTimeAsync(500);
    await jest.advanceTimersByTimeAsync(1000);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects TIMEOUT when fetch never settles', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      },
    );
    const { subscription } = create({ timeoutMs: 30, maxRetries: 0 });
    const pending = expect(subscription.subscribe(valid)).rejects.toMatchObject(
      {
        code: 'TIMEOUT',
        attempt: 1,
      },
    );
    await jest.advanceTimersByTimeAsync(30);
    await pending;
  });

  it('rejects NETWORK when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { subscription } = create({ maxRetries: 0 });
    await expect(subscription.subscribe(valid)).rejects.toMatchObject({
      code: 'NETWORK',
      attempt: 1,
    });
  });

  it('shares one fetch for two in-flight calls with the same SKU and phone', async () => {
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { subscription } = create();
    const first = subscription.subscribe(valid);
    const second = subscription.subscribe(valid);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(response(200, { accepted: true }));
    await expect(first).resolves.toEqual({ accepted: true });
    await expect(second).resolves.toEqual({ accepted: true });

    fetchMock.mockResolvedValue(response(200, { accepted: true }));
    await subscription.subscribe(valid);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ ...valid, phone: '123' }, 'phone'],
    [{ ...valid, name: '  ' }, 'name'],
    [{ ...valid, skuId: '' }, 'skuId'],
  ])('rejects validation for %j and does not fetch', async (input, field) => {
    const { subscription, events } = create();
    await expect(subscription.subscribe(input)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events[0].payload.fields).toHaveProperty(field);
    expect(JSON.stringify(events[0].payload)).not.toMatch(/Ana|5511/);
  });

  it('does not read window from the back-in-stock modules', () => {
    const files = [
      'src/modules/backInStock/offer.ts',
      'src/modules/backInStock/contact.ts',
      'src/modules/backInStock/subscription.ts',
      'src/modules/backInStock/error.ts',
      'src/network/BackInStockClient.ts',
      'src/utils/backInStockRequestBuilder.ts',
    ];
    files.forEach((file) => {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/\bwindow\b/);
    });
  });
});
