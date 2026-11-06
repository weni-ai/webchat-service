# Data model: Back-in-stock logic and request in the service

Nothing is persisted. There is no storage key, schema, or migration. The previous published library keeps working because no stored shape changes.

All types below are the in-memory contract. `src/types/index.d.ts` is the published form. Internal modules use camelCase. The only snake_case object is the request body, and only `backInStockRequestBuilder.ts` builds it.

## Offer input

The widget passes the object `normalizeForContext` already returns. The service does not import that function.

| Field | Meaning |
|-------|---------|
| `product` | VTEX catalog shape. Read at the boundary: `items[].itemId`, `items[].sellers[].sellerId`, `items[].sellers[].sellerDefault`, `items[].sellers[].commertialOffer.AvailableQuantity`. |
| `selectedSkuId` | SKU the shopper has selected. May be empty. |

Normalized inside `offer.ts` to `{ skuId, sellers: [{ sellerId, isDefault, availableQuantity }] }`. PascalCase does not leave that function.

## Offer result

| Field | Rule |
|-------|------|
| `isUnavailable` | `true` only when a matched item has `availableQuantity <= 0`. Unmatched SKU, missing sellers, unknown quantity, or a product that is not an object: `false`. Never throws. |
| `skuId` | `selectedSkuId` with leading zeros stripped when it is all digits. `''` when absent. |
| `seller` | `sellerId` of the seller with `sellerDefault`, else the first seller, else `'1'`. |

SKU match: string equality, then equality after stripping leading zeros from numeric ids. A non-numeric id is not stripped.

## Contact input and result

| Input | Rule |
|-------|------|
| `name` | Valid when trim is non-empty. |
| `phone` | Digits of the calling code plus the national number, separators allowed, optional leading `+`. Valid when `isValidPhoneNumber('+' + digits)` from `libphonenumber-js/max` is true. |

Result: `{ isValid, errors }`. `errors.name` is `'required'` or absent. `errors.phone` is `'invalid'` or absent. No display strings.

## Subscribe input

| Field | Resolution |
|-------|------------|
| `name`, `phone` | Same rules as contact. Phone sent as digits only. Name sent trimmed. |
| `skuId` | Required after the same strip. Empty rejects `VALIDATION` and sends nothing. |
| `seller` | Trimmed value, or `'1'`. |
| `salesChannel` | Trimmed value, or `'1'`. |
| `storeLocales` | Ordered raw strings from the host. May be empty. |
| `language` | Widget language, such as `pt` or `pt-BR`. |

`locale` is the first value containing `-` in `storeLocales`, then in `language`. Otherwise `language` maps `{ pt: pt-BR, en: en-US, es: es-ES, ro: ro-RO }`, then the raw `language`, then `pt-BR`.

## Request body

Built only by `src/utils/backInStockRequestBuilder.ts`:

```text
{ sku_id, phone, name, seller, sales_channel, locale }
```

## Subscribe result and error

Resolve `{ accepted: boolean }`. A 2xx body with `accepted: false` resolves `false`. A 2xx body without `accepted`, or a body that is not JSON, resolves `true`.

Reject `BackInStockError`:

| `code` | When | Extra fields |
|--------|------|----------------|
| `VALIDATION` | Name, phone, or SKU fails | `fields`: `{ name?: 'required', phone?: 'invalid', skuId?: 'required' }` |
| `HTTP` | Response status is not 2xx | `status`, `attempt` |
| `TIMEOUT` | `AbortController` fired | `attempt` |
| `NETWORK` | `fetch` threw | `attempt` |

`attempt` is 1-based and counts the tries already made.

## In-flight entry

Key: `normalizedSkuId + ':' + phoneDigits`. Value: the promise already returned to the caller. Cleared in `finally`. A second call with the same key receives that promise and does not call `fetch`. A call after settlement sends again.

## Events

| Name | Payload |
|------|---------|
| `backInStock:subscribed` | `{ skuId, accepted }` |
| `backInStock:error` | `{ code, skuId, status?, attempt?, fields? }` |

Name and phone are not fields of either payload.

## Init option

`backInStock`, all optional:

| Field | Default |
|-------|---------|
| `subscribePath` | `/_v/private/availability-notify/subscribe` |
| `timeoutMs` | `10000` |
| `maxRetries` | `2` |
| `retryBaseDelayMs` | `500` |

A provided number that is not finite or is below 0 throws from the constructor. `maxRetries` must be an integer. The path must be a non-empty string.
