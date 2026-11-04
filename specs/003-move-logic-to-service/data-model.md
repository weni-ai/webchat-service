# Data model: Move logic to service

## Storefront snapshot

Owned by `src/modules/storefront/`. Emitted as `storefront:changed`.

| Field | Type | Rules |
|-------|------|--------|
| account | string or null | Required before `getStarters`. Empty string is treated as missing. |
| productPath | string or null | Path or `linkText` the starters request already accepts. |
| skuId | string or null | Selected SKU. Null off a product page. |
| sellerId | string or null | Seller for that SKU. |
| available | boolean | False when the selected SKU is unavailable. |
| isCheckout | boolean | True on the checkout URL. |
| isProductPage | boolean | True only when account and productPath are both present. |

Relationship: one snapshot per page. A new URL replaces it. `StarterSession` calls `getStarters` only when `isProductPage` is true and the `account:productPath` fingerprint changed. `isCheckout` true emits `storefront:entered-checkout` once per entry.

Persisted under `weni:webchat:storefront` as JSON `{ snapshot, pendingCart }`. Missing or invalid JSON loads as an empty snapshot and an empty cart. The session conversation blob is not modified.

## Pending cart item

| Field | Type | Rules |
|-------|------|--------|
| key | string | Stable item key the widget already uses. |
| quantity | number | Integer ≥ 0. Non-numeric becomes 0. |
| origin | `conversation` or `catalog` | Same split `OrderFormContext` uses for debounce versus immediate flush. |

State:

1. `pending` — held in the map. Conversation origin waits 5000 ms (`PENDING_CART_DEBOUNCE_MS`). Catalog origin flushes on page leave, matching the context today.
2. `flushed` — removed from the map after a successful send. A second flush of the same key and quantity does not send again.
3. `failed` — `cart:failed` with the key. The item stays pending so the widget can roll the displayed quantity back. No automatic retry.

## Voice session

In memory only. Not written to storage.

| State | Meaning | Next |
|-------|---------|------|
| idle | Not in voice mode | `enterVoiceSession` → `listening`, or `voice:error` if permission is denied or the browser is unsupported |
| listening | Capture and STT are running | transcript emitted; `speakIncomingText` → `speaking`; `exitVoiceSession` → `idle` |
| speaking | TTS is playing | playback ends → `listening`; playback throws → `voice:error` then `listening` |
| error | Terminal for that attempt | `enterVoiceSession` may be called again; `exitVoiceSession` → `idle` |

`voice:transcript` carries `{ text }` for a final transcript only. Partial transcripts are not emitted. The widget sends `text` through the existing `sendMessage`.
