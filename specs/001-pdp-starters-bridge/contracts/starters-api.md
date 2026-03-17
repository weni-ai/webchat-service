# Public API Contract: PDP Conversation Starters

**Branch**: `001-pdp-starters-bridge` | **Date**: 2026-03-09

## Method: `getStarters(productData)`

### Signature

```typescript
getStarters(productData: StartersData): void
```

### Parameters

```typescript
interface StartersData {
  account: string        // Required. VTEX store identifier.
  linkText: string       // Required. Product slug.
  productName?: string   // Optional. Human-readable product name.
  description?: string   // Optional. Product description.
  brand?: string         // Optional. Brand name.
  attributes?: Record<string, string>  // Optional. Product attributes.
}
```

### Behavior

1. Validates `productData`:
   - Throws `Error('Product data is required')` if `productData` is falsy.
   - Throws `Error('account is required and must be a non-empty string')` if `account` is missing or empty.
   - Throws `Error('linkText is required and must be a non-empty string')` if `linkText` is missing or empty.
2. Checks connection state:
   - Throws `Error('WebSocket not connected')` if the service is not in `connected` state.
3. Sets `_latestStartersFingerprint` to `account:linkText`.
4. Constructs payload:
   ```json
   {
     "type": "get_pdp_starters",
     "from": "<sessionId>",
     "data": {
       "account": "<account>",
       "linkText": "<linkText>",
       "productName": "<productName if provided>",
       "description": "<description if provided>",
       "brand": "<brand if provided>",
       "attributes": "<attributes if provided>"
     }
   }
   ```
5. Sends payload via `WebSocketManager.send()`.
6. Returns `void`. Response arrives asynchronously via events.

### Errors (synchronous)

| Condition | Error message |
|-----------|---------------|
| `productData` is falsy | `'Product data is required'` |
| `account` missing/empty | `'account is required and must be a non-empty string'` |
| `linkText` missing/empty | `'linkText is required and must be a non-empty string'` |
| Not connected | `'WebSocket not connected'` |

---

## Method: `clearStarters()`

### Signature

```typescript
clearStarters(): void
```

### Behavior

1. Clears `_latestStartersFingerprint` (sets to `null`).
2. This prevents any in-flight starters response from being emitted.
3. Should be called by the consumer when navigating away from a PDP.

---

## Event: `starters:received`

### Emitted when

The server sends a `starters` response AND the response matches the latest request fingerprint (is not stale).

### Payload

```typescript
{
  questions: string[]  // Array of 1–3 generated questions
}
```

### Example

```javascript
service.on('starters:received', ({ questions }) => {
  console.log(questions)
  // ["Qual a diferença entre as versões de 64GB e 256GB?", ...]
})
```

---

## Event: `starters:error`

### Emitted when

The server sends an `error` response containing "starters" in the error message, AND there is an active starters fingerprint.

### Payload

```typescript
{
  error: string  // Server error message
}
```

### Example

```javascript
service.on('starters:error', ({ error }) => {
  console.warn('Starters failed:', error)
})
```

---

## Constants Added

### SERVICE_EVENTS

| Constant | Value | Description |
|----------|-------|-------------|
| `STARTERS_RECEIVED` | `'starters:received'` | Emitted when starters response arrives |
| `STARTERS_ERROR` | `'starters:error'` | Emitted when starters request fails |

### WS_MESSAGE_TYPES

| Constant | Value | Description |
|----------|-------|-------------|
| `GET_PDP_STARTERS` | `'get_pdp_starters'` | Outgoing message type for starters request |
| `STARTERS` | `'starters'` | Incoming message type for starters response |

---

## WebSocket Protocol Alignment

This contract aligns with the weni-webchat-socket server contract documented at `weni-webchat-socket/specs/001-pdp-starters/contracts/websocket-events.md`:

| Aspect | Server expects | Service sends |
|--------|---------------|---------------|
| Outgoing type | `get_pdp_starters` | `get_pdp_starters` |
| Required data | `account`, `linkText` | Validated before send |
| Optional data | `productName`, `description`, `brand`, `attributes` | Passed through |
| Response type | `starters` | Handled in `_handleMessage()` |
| Error pattern | `error` with "conversation starters" message | Matched and emitted as `starters:error` |
| Pre-condition | Client must be registered | Enforced via `isConnected()` check |
