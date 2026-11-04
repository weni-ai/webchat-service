import OrderForm from '../OrderForm';
import type StorageManager from '../../../core/StorageManager';

function storage(): StorageManager {
  return {
    getStorefrontRecord: () => ({ snapshot: null, pendingCart: {} }),
    setStorefrontRecord: jest.fn(),
  } as unknown as StorageManager;
}

describe('order form', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('conversation origin waits 5000 ms and a second flush does not send again', async () => {
    const host = {
      addProductToCart: jest.fn().mockResolvedValue({}),
      emit: jest.fn(),
      storage: storage(),
    };
    const form = new OrderForm(host);

    form.setPendingCartItem('sku-1', Number.NaN, 'conversation');
    await jest.advanceTimersByTimeAsync(4999);
    expect(host.addProductToCart).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);

    expect(host.addProductToCart).toHaveBeenCalledTimes(1);
    const payload = host.addProductToCart.mock.calls[0][0] as {
      items: { quantity: number }[];
    };
    expect(payload.items[0].quantity).toBe(0);

    form.setPendingCartItem('sku-1', 0, 'conversation');
    await jest.advanceTimersByTimeAsync(5000);
    expect(host.addProductToCart).toHaveBeenCalledTimes(1);
  });

  test('a failed flush emits cart:failed and keeps the item pending', async () => {
    const host = {
      addProductToCart: jest.fn().mockRejectedValue(new Error('timeout')),
      emit: jest.fn(),
      storage: storage(),
    };
    const form = new OrderForm(host);
    form.setPendingCartItem('sku-1', 2, 'catalog');

    await form.flushPendingCart(['sku-1']);

    expect(host.emit).toHaveBeenCalledWith('cart:failed', {
      key: 'sku-1',
      operation: 'flush',
    });

    host.addProductToCart.mockResolvedValue({});
    await form.flushPendingCart(['sku-1']);
    expect(host.addProductToCart).toHaveBeenCalledTimes(2);
  });
});
