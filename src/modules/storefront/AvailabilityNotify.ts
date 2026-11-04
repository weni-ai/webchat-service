const NOTIFY_PATH = '/_v/private/availability-notify/subscribe';
const HTTP_TIMEOUT_MS = 10000;

interface NotifyHost {
  emit(event: string, payload?: unknown): void;
}

export default class AvailabilityNotify {
  constructor(private readonly host: NotifyHost) {}

  async request(
    skuId: string,
    sellerId: string,
    contact: string,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const response = await fetch(NOTIFY_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_id: skuId,
          seller: sellerId,
          phone: contact,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('notify failed');
    } catch {
      this.host.emit('cart:failed', { key: skuId, operation: 'notify' });
      console.warn('AvailabilityNotify: request failed', {
        operation: 'notify',
        connectionState: 'unknown',
      });
      throw new Error('notify failed');
    } finally {
      clearTimeout(timeout);
    }
  }
}
