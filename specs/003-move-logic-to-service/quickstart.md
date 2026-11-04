# Quickstart: Move logic to service

Validates `@weni/webchat-service` on branch `003-move-logic-to-service`. No live socket and no storefront page. Details of fields and events are in [data-model.md](./data-model.md), [contracts/storefront-api.md](./contracts/storefront-api.md), and [contracts/voice-session.md](./contracts/voice-session.md).

## Prerequisites

- Node 24
- Repository root: `webchat-service`
- Dependencies installed (`npm install`)

## Storefront slice

```bash
npm test -- --testPathPattern='src/modules/(storefront|conversation)/tests' --coverage
npm run lint
npm run build
```

Expected:

- Product-resolution tests accept the fixture documents and emit a snapshot that triggers one `get_pdp_starters` send, then a second navigation with the same path does not send again.
- Leaving the product page clears the starters fingerprint.
- A checkout URL emits `storefront:entered-checkout` and does not call `getStarters`.
- Order-form tests flush a conversation item only after the debounce and do not flush the same key twice.
- A timed-out VTEX fetch emits `cart:failed` and leaves the previous snapshot in place.
- `npm run build` emits `dist/index.cjs.js`, `dist/index.esm.js`, and `dist/index.umd.js`.
- Coverage stays at or above the CI threshold of 80%.

## Voice slice

Run after the voice modules exist:

```bash
npm test -- --testPathPattern='src/modules/voice/tests' --coverage
```

Expected:

- Permission denial emits `voice:error` with `operation: "permission"` and does not start capture.
- A final transcript emits `voice:transcript` and does not call `sendMessage` inside the library.
- `speakIncomingText` moves state to `speaking` and back to `listening`.
- `exitVoiceSession` ends in `idle`.
- Log spies do not receive the transcript string.

## Regression

```bash
npm test -- --testPathPattern='tests/(service.sendPaths|MessageProcessor)' --coverage
```

Expected: existing send and starters tests pass, including `getStarters(productData)` with no `watchStorefront` call.
