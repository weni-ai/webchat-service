import WeniWebchatService, { SERVICE_EVENTS } from '../src/index';

function create(backInStock?: Record<string, unknown>) {
  return new WeniWebchatService({
    socketUrl: 'wss://example.test/socket',
    channelUuid: 'channel-1',
    connectOn: 'manual',
    backInStock,
  });
}

describe('WeniWebchatService back-in-stock facade', () => {
  beforeEach(() => {
    global.localStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
    } as unknown as Storage;
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ accepted: true }),
    });
  });

  it('delegates the three methods', async () => {
    const service = create();
    expect(
      service.evaluateBackInStockOffer({
        product: {
          items: [
            {
              itemId: '27',
              sellers: [
                {
                  sellerId: '4',
                  commertialOffer: { AvailableQuantity: 0 },
                },
              ],
            },
          ],
        },
        selectedSkuId: '27',
      }),
    ).toEqual({ isUnavailable: true, skuId: '27', seller: '4' });

    expect(
      service.validateBackInStockContact({
        name: 'Ana',
        phone: '5511988887777',
      }).isValid,
    ).toBe(true);

    const subscribed = jest.fn();
    service.on(SERVICE_EVENTS.BACK_IN_STOCK_SUBSCRIBED, subscribed);
    await expect(
      service.subscribeBackInStock({
        name: 'Ana',
        phone: '5511988887777',
        skuId: '27',
      }),
    ).resolves.toEqual({ accepted: true });
    expect(subscribed).toHaveBeenCalledWith({ skuId: '27', accepted: true });
    service.destroy();
  });

  it('honors subscribePath, timeoutMs, and maxRetries', async () => {
    const service = create({
      subscribePath: '/custom-subscribe',
      timeoutMs: 25,
      maxRetries: 0,
    });
    (global.fetch as jest.Mock).mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    jest.useFakeTimers();
    const pending = expect(
      service.subscribeBackInStock({
        name: 'Ana',
        phone: '5511988887777',
        skuId: '27',
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(25);
    await pending;
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      '/custom-subscribe',
    );
    jest.useRealTimers();
    service.destroy();
  });

  it('rejects a bad backInStock option at construction', () => {
    expect(() => create({ timeoutMs: -1 })).toThrow(/timeoutMs/);
    expect(() => create({ maxRetries: 1.5 })).toThrow(/maxRetries/);
    expect(() => create({ subscribePath: '  ' })).toThrow(/subscribePath/);
  });
});
