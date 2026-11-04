import type StorageManager from '../../core/StorageManager';
import type { PendingCartItem, StorefrontSnapshot } from './types';

const DEBOUNCE_MS = 5000;
const HTTP_TIMEOUT_MS = 10000;

interface CartHost {
  addProductToCart(props: {
    VTEXAccountName: string;
    orderFormId: string;
    items: { id: string; seller: string; quantity: number }[];
  }): Promise<unknown>;
  emit(event: string, payload?: unknown): void;
  storage: StorageManager;
}

function quantityOf(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

export default class OrderForm {
  private pending = new Map<string, PendingCartItem>();

  private flushed = new Map<string, number>();

  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  private inflight = new Set<string>();

  private wasProductPage = false;

  constructor(private readonly host: CartHost) {
    const record = host.storage.getStorefrontRecord();
    for (const item of Object.values(record.pendingCart)) {
      this.pending.set(item.key, item);
    }
  }

  setPendingCartItem(
    key: string,
    quantity: number,
    origin: PendingCartItem['origin'],
    skuId = key,
    sellerId = '1',
  ): void {
    const next = quantityOf(quantity);
    const item: PendingCartItem = {
      key,
      quantity: next,
      origin: origin === 'catalog' ? 'catalog' : 'conversation',
      skuId,
      sellerId,
    };
    this.pending.set(key, item);
    this.persist();
    if (item.origin === 'conversation') {
      this.schedule(key);
    }
  }

  onSnapshot(snapshot: StorefrontSnapshot): void {
    if (this.wasProductPage && !snapshot.isProductPage) {
      const catalogKeys = [...this.pending.values()]
        .filter((item) => item.origin === 'catalog')
        .map((item) => item.key);
      void this.flushPendingCart(catalogKeys);
    }
    this.wasProductPage = snapshot.isProductPage;
  }

  async flushPendingCart(keys?: string[]): Promise<void> {
    const selected = keys ?? [...this.pending.keys()];
    for (const key of selected) {
      const item = this.pending.get(key);
      if (!item) continue;
      if (this.flushed.get(key) === item.quantity) continue;
      if (this.inflight.has(key)) continue;
      this.inflight.add(key);
      const timer = this.timers.get(key);
      if (timer) clearTimeout(timer);
      this.timers.delete(key);
      try {
        await this.send(item);
        this.flushed.set(key, item.quantity);
        this.pending.delete(key);
        this.persist();
        this.host.emit('cart:updated', { key, quantity: item.quantity });
      } catch {
        this.host.emit('cart:failed', { key, operation: 'flush' });
        console.warn('OrderForm: cart flush failed', {
          operation: 'flush',
          connectionState: 'unknown',
        });
      } finally {
        this.inflight.delete(key);
      }
    }
  }

  private schedule(key: string): void {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      void this.flushPendingCart([key]);
    }, DEBOUNCE_MS);
    this.timers.set(key, timer);
  }

  private async send(item: PendingCartItem): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      await this.host.addProductToCart({
        VTEXAccountName: '',
        orderFormId: 'pending',
        items: [
          {
            id: item.skuId ?? item.key,
            seller: item.sellerId ?? '1',
            quantity: item.quantity,
          },
        ],
      });
    } finally {
      clearTimeout(timeout);
      void controller.signal;
    }
  }

  private persist(): void {
    const record = this.host.storage.getStorefrontRecord();
    const pendingCart: Record<string, PendingCartItem> = {};
    for (const [key, item] of this.pending) pendingCart[key] = item;
    this.host.storage.setStorefrontRecord({
      snapshot: record.snapshot,
      pendingCart,
    });
  }
}
