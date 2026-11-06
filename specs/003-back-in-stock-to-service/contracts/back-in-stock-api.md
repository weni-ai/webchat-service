# Contract: back-in-stock API on `@weni/webchat-service`

Additive. No existing method, event, init field, or storage key changes. Published as a minor release when this library is released. webchat-react spec `010` does not wait for that release. It links this checkout.

## Methods

```text
evaluateBackInStockOffer(input: {
  product: unknown
  selectedSkuId?: string
}): { isUnavailable: boolean; skuId: string; seller: string }
```

Synchronous. See `data-model.md` for the product fields that are read and for the unavailable rule.

```text
validateBackInStockContact(input: {
  name?: string
  phone?: string
}): {
  isValid: boolean
  errors: { name?: 'required'; phone?: 'invalid' }
}
```

Synchronous. `phone` is the international number as typed.

```text
subscribeBackInStock(input: {
  name?: string
  phone?: string
  skuId?: string
  seller?: string
  salesChannel?: string
  storeLocales?: string[]
  language?: string
}): Promise<{ accepted: boolean }>
```

Rejects with `BackInStockError extends Error`:

```text
{ code: 'VALIDATION' | 'HTTP' | 'TIMEOUT' | 'NETWORK'
  skuId: string
  status?: number
  attempt?: number
  fields?: { name?: 'required'; phone?: 'invalid'; skuId?: 'required' } }
```

The rejection is also emitted. It is never an unhandled exception and never a silent catch.

## Events

Added to `SERVICE_EVENTS` in `src/utils/constants.js` and to the published types.

| Constant | Name | When | Payload |
|----------|------|------|---------|
| `BACK_IN_STOCK_SUBSCRIBED` | `backInStock:subscribed` | 2xx | `{ skuId, accepted }` |
| `BACK_IN_STOCK_ERROR` | `backInStock:error` | validation, non-2xx, timeout, network, retries exhausted | `{ code, skuId, status?, attempt?, fields? }` |

Listeners use the existing `service.on(name, handler)`.

## HTTP

`POST` the `subscribePath` option. Default `/_v/private/availability-notify/subscribe`.

Headers: `Content-Type: application/json`. Credentials: `same-origin`.

Body, built only in `src/utils/backInStockRequestBuilder.ts`:

```text
{ sku_id: string, phone: string, name: string, seller: string, sales_channel: string, locale: string }
```

Timeout: `timeoutMs` per attempt, via `AbortController`. Retry only network errors, timeouts, 429, and 5xx, up to `maxRetries`, waiting `retryBaseDelayMs * 2^attempt` before the next try. Other 4xx are not retried.

This route already exists in agentic-cx. This contract does not change it.

## Init

```text
new WeniWebchatService({
  backInStock?: {
    subscribePath?: string
    timeoutMs?: number
    maxRetries?: number
    retryBaseDelayMs?: number
  }
})
```

Every field has the default in `data-model.md`. Omitting `backInStock` keeps today's construction behavior plus the new methods with those defaults.

## Bundles

| Build | `libphonenumber-js/max` |
|-------|-------------------------|
| `dist/index.cjs.js` | external |
| `dist/index.esm.js` | external |
| `dist/index.umd.js` | bundled |

`eventemitter3` stays external in all three.
