import { EMPTY_SNAPSHOT, type StorefrontSnapshot } from './types';

interface ProductNode {
  sku?: string;
  name?: string;
  offers?: {
    availability?: string;
    seller?: { identifier?: string };
  };
}

interface HostWindow extends Window {
  __RUNTIME__?: { account?: string };
  VTEX_METADATA?: { account?: string };
  faststore_sdk_stores?: { get?: (key: string) => unknown };
}

function hostWindow(): HostWindow {
  return window as HostWindow;
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readAccount(): string | null {
  const host = hostWindow();
  const runtime = nonEmpty(host.__RUNTIME__?.account);
  if (runtime) return runtime;
  const metadata = nonEmpty(host.VTEX_METADATA?.account);
  if (metadata) return metadata;

  const link = document.querySelector('link[href*="vtexassets.com"]');
  const href = link?.getAttribute('href') ?? '';
  const match = href.match(/^https?:\/\/([a-z0-9-]+)\.vtexassets\.com/i);
  return match?.[1] ?? null;
}

function isFastStoreHost(): boolean {
  return typeof hostWindow().faststore_sdk_stores?.get === 'function';
}

function productFromLdJson(): ProductNode | null {
  const scripts = document.querySelectorAll(
    'script[type="application/ld+json"]',
  );
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent ?? '') as {
        '@type'?: string | string[];
        sku?: string;
        offers?: ProductNode['offers'];
      };
      const type = data['@type'];
      const isProduct =
        type === 'Product' || (Array.isArray(type) && type.includes('Product'));
      if (isProduct) return data;
    } catch {
      // Skip a malformed tag.
    }
  }
  return null;
}

/**
 * Reads the host page into the storefront snapshot.
 * Empty account strings are missing. skuId is null off a product page.
 */
export default class VtexPageReader {
  read(): StorefrontSnapshot {
    const path = window.location.pathname;
    const isCheckout = path.includes('/checkout/');
    const isPdp = /\/[^/]+\/p\/?$/.test(path);
    const account = readAccount();
    const productPath = isPdp ? path : null;
    const product = isPdp ? productFromLdJson() : null;
    const urlSku = nonEmpty(
      new URLSearchParams(window.location.search).get('skuId'),
    );
    const skuId = isPdp ? (urlSku ?? nonEmpty(product?.sku)) : null;
    const sellerId = isPdp
      ? nonEmpty(product?.offers?.seller?.identifier)
      : null;
    const availability = product?.offers?.availability ?? '';
    const available = isPdp && !availability.includes('OutOfStock');

    return {
      ...EMPTY_SNAPSHOT,
      account,
      productPath,
      skuId,
      sellerId,
      available,
      isCheckout,
      isProductPage: Boolean(account && productPath),
      isFastStore: isFastStoreHost(),
    };
  }
}
