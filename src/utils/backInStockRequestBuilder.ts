import { stripLeadingZeros } from '../modules/backInStock/offer';

const LOCALE_BY_LANGUAGE: Record<string, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  ro: 'ro-RO',
};

export interface BackInStockRequestInput {
  name?: string;
  phone?: string;
  skuId?: string;
  seller?: string | null;
  salesChannel?: string | null;
  storeLocales?: string[];
  language?: string;
}

export interface BackInStockRequestBody {
  sku_id: string;
  phone: string;
  name: string;
  seller: string;
  sales_channel: string;
  locale: string;
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function present(value: string | null | undefined): string {
  if (value == null) return '';
  return String(value).trim();
}

function isRegional(value: unknown): value is string {
  return typeof value === 'string' && value.includes('-');
}

export function resolveNotifyLocale(
  storeLocales: string[] | undefined,
  language: string | undefined,
): string {
  const candidates = [...(storeLocales ?? []), language];
  for (const candidate of candidates) {
    if (isRegional(candidate)) return candidate;
  }
  if (!language) return 'pt-BR';
  return LOCALE_BY_LANGUAGE[language] || language;
}

export function normalizeSkuId(skuId: string | undefined): string {
  const raw = present(skuId);
  if (raw === '') return '';
  return stripLeadingZeros(raw);
}

/**
 * Wire body for the storefront subscribe route. This is the only place
 * the back-in-stock feature uses snake_case.
 */
export function buildBackInStockRequest(
  input: BackInStockRequestInput = {},
): BackInStockRequestBody {
  const seller = present(input.seller);
  const salesChannel = present(input.salesChannel);

  return {
    sku_id: normalizeSkuId(input.skuId),
    phone: digits(String(input.phone ?? '')),
    name: present(input.name),
    seller: seller === '' ? '1' : seller,
    sales_channel: salesChannel === '' ? '1' : salesChannel,
    locale: resolveNotifyLocale(input.storeLocales, input.language),
  };
}
