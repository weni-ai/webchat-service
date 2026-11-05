export interface BackInStockOfferInput {
  product?: unknown;
  selectedSkuId?: string;
}

export interface BackInStockOfferResult {
  isUnavailable: boolean;
  skuId: string;
  seller: string;
}

interface NormalizedSeller {
  sellerId: string;
  isDefault: boolean;
  availableQuantity: number | null;
}

interface NormalizedItem {
  skuId: string;
  sellers: NormalizedSeller[];
}

/**
 * Strip leading zeros from a numeric id. Alphanumeric ids stay as written
 * so a SKU that merely starts with a letter is not rewritten.
 */
export function stripLeadingZeros(id: string): string {
  if (!/^\d+$/.test(id)) return id;
  const stripped = id.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

function skuIdsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  return stripLeadingZeros(left) === stripLeadingZeros(right);
}

function readQuantity(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function readSellers(value: unknown): NormalizedSeller[] {
  if (!Array.isArray(value)) return [];
  return value.map((seller) => {
    const record = seller as {
      sellerId?: unknown;
      sellerDefault?: unknown;
      commertialOffer?: { AvailableQuantity?: unknown };
    };
    const sellerId = record?.sellerId;
    return {
      sellerId: sellerId == null || sellerId === '' ? '' : String(sellerId),
      isDefault: record?.sellerDefault === true,
      availableQuantity: readQuantity(
        record?.commertialOffer?.AvailableQuantity,
      ),
    };
  });
}

function readItems(product: unknown): NormalizedItem[] {
  if (!product || typeof product !== 'object') return [];
  const items = (product as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const record = item as { itemId?: unknown; sellers?: unknown };
    const itemId = record?.itemId;
    return {
      skuId: itemId == null ? '' : String(itemId),
      sellers: readSellers(record?.sellers),
    };
  });
}

function findItem(
  items: NormalizedItem[],
  selectedSkuId: string,
): NormalizedItem | undefined {
  if (selectedSkuId === '') return undefined;
  return items.find(
    (item) => item.skuId !== '' && skuIdsMatch(item.skuId, selectedSkuId),
  );
}

function sellerFrom(item: NormalizedItem | undefined): string {
  const sellers = item?.sellers ?? [];
  const preferred = sellers.find((seller) => seller.isDefault) ?? sellers[0];
  if (!preferred || preferred.sellerId === '') return '1';
  return preferred.sellerId;
}

/**
 * Whether the selected SKU should show the back-in-stock offer.
 * Unknown or unmatched stock stays available so the widget does not
 * prompt "notify me" for a product that may be in stock.
 */
export function evaluateBackInStockOffer(
  input: BackInStockOfferInput = {},
): BackInStockOfferResult {
  const selected =
    input.selectedSkuId == null ? '' : String(input.selectedSkuId);
  const skuId = selected === '' ? '' : stripLeadingZeros(selected);
  const matched = findItem(readItems(input.product), selected);
  const quantity = matched?.sellers[0]?.availableQuantity;
  const isUnavailable = Boolean(matched) && quantity != null && quantity <= 0;

  return {
    isUnavailable,
    skuId,
    seller: sellerFrom(matched),
  };
}
