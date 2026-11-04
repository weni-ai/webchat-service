import type { StorefrontSnapshot } from '../storefront/types';

interface StarterHost {
  getStarters(productData: {
    account: string;
    linkText: string;
    productPath: string;
  }): void;
  clearStarters(): void;
  emit(event: string, payload?: unknown): void;
  isConnected(): boolean;
}

/**
 * Decides when an existing getStarters / clearStarters call runs.
 * A checkout URL emits storefront:entered-checkout once per entry.
 */
export default class StarterSession {
  private fingerprint: string | null = null;

  private wasCheckout = false;

  constructor(private readonly host: StarterHost) {}

  onSnapshot(snapshot: StorefrontSnapshot): void {
    if (snapshot.isCheckout && !this.wasCheckout) {
      this.host.emit('storefront:entered-checkout', { at: Date.now() });
    }
    this.wasCheckout = snapshot.isCheckout;

    if (!snapshot.isProductPage || !snapshot.account || !snapshot.productPath) {
      if (this.fingerprint) {
        this.fingerprint = null;
        this.host.clearStarters();
      }
      return;
    }

    const next = `${snapshot.account}:${snapshot.productPath}`;
    if (next === this.fingerprint || snapshot.isCheckout) return;

    this.fingerprint = next;
    if (!this.host.isConnected()) {
      this.host.emit('starters:error', {
        operation: 'starters',
        reason: 'not-connected',
      });
      return;
    }

    const slug = snapshot.productPath
      .split('/')
      .filter(Boolean)
      .slice(-2, -1)[0];
    try {
      this.host.getStarters({
        account: snapshot.account,
        linkText: slug || snapshot.productPath,
        productPath: snapshot.productPath,
      });
    } catch (error) {
      this.host.emit('starters:error', {
        operation: 'starters',
        reason: error instanceof Error ? error.message : 'starters-failed',
      });
    }
  }
}
