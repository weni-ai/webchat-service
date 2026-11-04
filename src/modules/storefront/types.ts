export interface StorefrontSnapshot {
  account: string | null;
  productPath: string | null;
  skuId: string | null;
  sellerId: string | null;
  available: boolean;
  isCheckout: boolean;
  isProductPage: boolean;
  isFastStore: boolean;
}

export interface PendingCartItem {
  key: string;
  quantity: number;
  origin: 'conversation' | 'catalog';
  skuId?: string;
  sellerId?: string;
}

export const EMPTY_SNAPSHOT: StorefrontSnapshot = {
  account: null,
  productPath: null,
  skuId: null,
  sellerId: null,
  available: false,
  isCheckout: false,
  isProductPage: false,
  isFastStore: false,
};

export function emptyStorefrontRecord(): {
  snapshot: StorefrontSnapshot | null;
  pendingCart: Record<string, PendingCartItem>;
} {
  return { snapshot: null, pendingCart: {} };
}
