# Data Model: PDP Conversation Starters Bridge

**Branch**: `001-pdp-starters-bridge` | **Date**: 2026-03-09

## Entities

### StartersData (input)

Product data provided by the consumer when requesting conversation starters.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `account` | `string` | Yes | VTEX store identifier (e.g., `"brandless"`) |
| `linkText` | `string` | Yes | Product slug / canonical identifier (e.g., `"ipad-10th-gen"`) |
| `productName` | `string` | No | Human-readable product name |
| `description` | `string` | No | Product description text |
| `brand` | `string` | No | Brand name |
| `attributes` | `Record<string, string>` | No | Product attributes as key-value pairs (e.g., `{ "Storage": "64GB, 256GB" }`) |

**Validation rules**:
- `account` must be a non-empty string
- `linkText` must be a non-empty string
- All other fields are optional and passed through without validation

**Request fingerprint**: `account` + `:` + `linkText` (e.g., `"brandless:ipad-10th-gen"`)

### StartersResponse (output)

Server response containing generated conversation starter questions.

| Field | Type | Description |
|-------|------|-------------|
| `questions` | `string[]` | Array of 1–3 generated questions |

**Source**: Extracted from `IncomingPayload.data.questions` when `type === "starters"`.

### WebSocket Payloads

#### Outgoing: `get_pdp_starters` (client → server)

```json
{
  "type": "get_pdp_starters",
  "from": "<sessionId>",
  "data": {
    "account": "brandless",
    "linkText": "ipad-10th-gen",
    "productName": "iPad 10th Gen",
    "description": "Versatile tablet...",
    "brand": "Apple",
    "attributes": {
      "Storage": "64GB, 256GB",
      "Color": "Blue, Silver, Pink"
    }
  }
}
```

#### Incoming: `starters` (server → client)

```json
{
  "type": "starters",
  "to": "<client-uuid>",
  "from": "system",
  "data": {
    "questions": [
      "Qual a diferença entre as versões de 64GB e 256GB?",
      "O iPad 10th Gen é compatível com Apple Pencil de qual geração?",
      "Quais cores estão disponíveis para pronta entrega?"
    ]
  }
}
```

#### Incoming: `error` (server → client, starters failure)

```json
{
  "type": "error",
  "error": "failed to generate conversation starters: <reason>"
}
```

## State

### Instance-level tracking on WeniWebchatService

| Property | Type | Initial | Description |
|----------|------|---------|-------------|
| `_latestStartersFingerprint` | `string \| null` | `null` | Tracks the `account:linkText` of the latest `getStarters()` call. Used to discard stale responses. Set on `getStarters()`, cleared on `starters:received`, `starters:error`, or explicit `clearStarters()`. |

No persistent storage is needed. Starters state is ephemeral and scoped to the current page context.

## Relationships

```text
webchat-react (consumer)
    │
    │ calls getStarters(productData)
    │ listens on('starters:received')
    │ listens on('starters:error')
    ▼
WeniWebchatService (this library)
    │
    │ validates StartersData
    │ builds get_pdp_starters payload
    │ tracks request fingerprint
    │ sends via WebSocketManager.send()
    │ receives 'starters' via WebSocketManager._handleMessage()
    │ emits starters:received / starters:error
    ▼
weni-webchat-socket (server)
    │
    │ ParsePayload → GetPDPStarters
    │ validates, deduplicates, semaphore
    │ spawns goroutine → Lambda
    │ c.Send(startersPayload)
    ▼
Lambda (AWS)
    │
    │ DynamoDB cache check
    │ LLM generation (on miss)
    │ returns { questions: [...] }
```
