# Contract: storefront and cart

Consumer: `webchat-react` after it bumps `@weni/webchat-service` past `1.19.2`. Existing callers of `getStarters(productData)` are unchanged.

## Methods

```text
watchStorefront(): void
unwatchStorefront(): void
getStorefrontSnapshot(): StorefrontSnapshot
setPendingCartItem(key: string, quantity: number, origin: "conversation" | "catalog"): void
flushPendingCart(keys?: string[]): Promise<void>
requestAvailabilityNotify(skuId: string, sellerId: string, contact: string): Promise<void>
```

`watchStorefront` is idempotent. A second call does not attach a second listener. `flushPendingCart` with no keys flushes every pending item whose deadline has passed or whose origin is `catalog`.

## Events

Added to `SERVICE_EVENTS` in `src/utils/constants.js`.

| Event | Payload |
|-------|---------|
| `storefront:changed` | `StorefrontSnapshot` from `data-model.md` |
| `storefront:entered-checkout` | `{ at: number }` timestamp. No cart contents. |
| `cart:updated` | `{ key, quantity }` after a successful flush |
| `cart:failed` | `{ key, operation: "flush" \| "notify" }` |

`starters:received` and `starters:error` stay as they are. `StarterSession` is what calls `getStarters` when the snapshot fingerprint changes, and `clearStarters` when `isProductPage` becomes false.

## Wire

`buildStartersRequest` is not modified. Outbound custom-field and order messages keep their current shapes. Product fields are camelCase on the snapshot. Snake_case remains only inside the existing wire builders.

## Storage

Key: `weni:webchat:storefront`. Value: `{ snapshot, pendingCart }`. No other `weni:webchat:` key changes.

## Compatibility

All methods are new. Omitting them is valid on `1.19.2`. This minor does not remove or rename an existing method or event.
