# Engineering Specification: Move logic to service

**Repository**: webchat-service — frontend

**Feature Branch**: `003-move-logic-to-service`

**Created**: 2026-11-04

**Status**: Draft

## Origin Without Product Spec

- Product Spec: none
- Problem: Storefront detection, cart and order-form rules, conversation-starter decisions, and voice-session control still run inside webchat-react, so this library is not the owner of the behavior the widget displays.
- Acceptance criteria:
  - Given a VTEX product page document, the library resolves the same account, product path, selected SKU, availability, and seller that `webchat-react/src/utils/vtex.js` resolves today, and it requests starters through the existing `getStarters` path without the caller scraping the page.
  - Given pending cart quantities, the library applies the same debounce and flush rules that `OrderFormContext` applies today, including FastStore bootstrap and the VTEX IO minicart bridge, and it emits the cart result for the widget to render.
  - Given navigation onto checkout, the library emits an entered-checkout signal. Given navigation off the product page, it clears the in-flight starters fingerprint.
  - Given a voice-mode entry with microphone permission, the library runs capture, speech-to-text, echo guarding, and speech synthesis for incoming assistant text, and it emits session state the widget can render. Denied permission and an unsupported browser are explicit error states, not silent no-ops.
  - Existing consumers that only call the current public methods (`init`, `connect`, `sendMessage`, `getStarters`, `sendAttachment`, `sendAudio`, recorders) keep working against this version without a code change.
  - A shopper message, token, or media byte is never written to a log or event payload.

## Scope in This Repository

**This repository implements**: The headless slice of `webchat-react` → `@weni/webchat-service` → `weni-webchat-socket`. This library becomes the owner of storefront context, cart mutation rules, the decision to call `getStarters`, custom-field sync, and the voice session. The socket server stays the owner of starter generation and media upload. New behavior is added as modules the facade delegates to. `src/index.js` does not gain the extracted function bodies.

**Out of scope here**:

- Rendering, layout, BEM, Unnnic tokens, i18n, and HTML sanitization. `webchat-react` keeps those.
- Message grouping, streaming-buffer animation, and visual-viewport CSS variables. Those are presentation and stay in the widget.
- The socket server's `get_pdp_starters` Lambda and the media-upload acknowledgement. This library already consumes both.
- Changing the wire shape of `get_pdp_starters`, custom fields, or media messages.

**Depends on**: `webchat-react` stopping its own copies of these rules and calling the methods and events in Contracts. Until that widget release, this library's new API is unused and the current `getStarters(productData)` entry remains. Host-page inputs stay the VTEX storefront (`window`, DOM, `fetch` to VTEX) and the browser media APIs already used by `AudioRecorder`.

## Current State

- `src/index.js` — facade already owns the socket session, `getStarters`, `clearStarters`, `setContext`, `setCustomField`, `sendOrder`, file and audio send, and `AudioRecorder` / `CameraRecorder`. It is already over the file-size guidance. New responsibilities must not be pasted into it.
- `src/utils/validators.js` `validateStartersData` — starters still require the caller to pass `account` and a product path. The widget builds that object.
- `src/utils/messageBuilder.js` `buildStartersRequest` — wire payload for starters already exists. This change calls it; it does not redesign it.
- `src/core/StateManager.js` and `src/core/SessionManager.js` — in-memory state and `weni:webchat:` browser storage. No storefront or voice-session record exists.
- `src/modules/AudioRecorder.js` — push-to-talk capture only. Full voice mode (streaming STT, TTS playback, echo guard, session guard) is not here.
- `webchat-react` counterparts this library does not own yet:
  - `src/utils/vtex.js` — PDP detection, account lookup, JSON-LD / `__NEXT_DATA__` / VTEX state product resolution, SKU and seller selection.
  - `src/utils/vtexCustomFields.js`, `src/utils/sendVtexUtm.js`, `src/utils/VTEXIOMinicartBridge.js`, `src/utils/faststoreBootstrap.js`, `src/utils/availabilityNotify.js`, `src/utils/navigationMonitor.js` — host-page side effects and URL watching.
  - `src/contexts/OrderFormContext.jsx` — pending cart, 5s debounce, FastStore versus VTEX IO flush.
  - `src/hooks/useConversationStarters.js` — when to resolve the product, call `service.getStarters`, and clear starters on navigation. Visibility timers and i18n stay in the widget.
  - `src/services/voice/*` and the voice branch of `src/contexts/ChatContext.jsx` — `VoiceService`, `STTConnection`, `TTSPlayer`, `AudioCapture`, `EchoGuard`, `SessionGuard`, `TextChunker`.

## Technical Approach

### Components Affected

| Component | Change | Why |
|-----------|--------|-----|
| `src/modules/storefront/` | new | Host-page product resolution, navigation, order form, custom fields, UTM, and back-in-stock notify. Moved from the widget utils and `OrderFormContext`. |
| `src/modules/conversation/StarterSession.js` | new | Decides when a resolved product should call `getStarters` and when `clearStarters` runs. |
| `src/modules/voice/` | new | Voice session moved from `webchat-react/src/services/voice`. |
| `src/index.js` | modified | Delegates to the new modules and emits the new events. No rule bodies added. |
| `src/utils/constants.js` | modified | New `SERVICE_EVENTS` names. |
| `src/types/index.d.ts` | modified | Public types for the new methods and events, in the same pull request as the API. |
| `src/core/StorageManager.js` | modified | One new storage key for storefront snapshot and pending cart. The existing session blob is not rewritten. |

The first new source file includes the TypeScript toolchain (Principle X): Rollup compiles `.ts`, Jest matches `.ts` tests and counts them in coverage, and ESLint lints `.ts`. Modules added after that are TypeScript. Existing `.js` files stay JavaScript except for the thin delegations above.

Delivery order inside this spec: storefront and starter session first, voice session second. The widget can adopt each slice as it ships. Voice does not block the storefront contract.

### Flow

Storefront slice, for a shopper opening a product page:

1. The widget calls `service.watchStorefront()` once after `init`. The storefront module reads the host document through the same signals `vtex.js` uses today (URL, JSON-LD, `__NEXT_DATA__`, VTEX state, FastStore account) and emits `storefront:changed` with a normalized snapshot: account, product path, SKU, seller, availability, and whether the URL is checkout.
2. `StarterSession` treats a snapshot with account and product path as the trigger `useConversationStarters` uses today. It calls the existing `getStarters`. Results still arrive on `starters:received` and `starters:error`. A later snapshot with a different path replaces the fingerprint; leaving the PDP calls `clearStarters`.
3. Entering checkout emits `storefront:entered-checkout`. The widget closes the chat. This library does not toggle UI state.
4. Cart controls call `setPendingCartItem` / `flushPendingCart`. The order-form module keeps the pending map, the 5s conversation debounce (`PENDING_CART_DEBOUNCE_MS`), FastStore bootstrap, and the VTEX IO minicart bridge. It emits `cart:updated` and `cart:failed`. Custom fields and UTM go out through the existing `setCustomField` and message queue.
5. Back-in-stock notify is a method on the storefront module (`requestAvailabilityNotify`) that performs the HTTP call now in `availabilityNotify.js` and emits success or failure. The widget only opens the notify view.

Voice slice, after the shopper chooses voice mode:

1. `enterVoiceSession()` checks support and microphone permission, then starts `AudioCapture`, `STTConnection`, `EchoGuard`, and `SessionGuard` with the same transitions as `VoiceService`.
2. Final transcripts emit `voice:transcript`. The widget sends them with the existing `sendMessage`. This library does not invent a second send path.
3. Incoming assistant text is pushed with `speakIncomingText`. `TextChunker` and `TTSPlayer` speak it. `voice:state` carries `idle`, `listening`, `speaking`, and `error`.
4. `exitVoiceSession()` stops capture and playback and emits `voice:state` `idle`.

### Rejected Alternatives

- Leaving the rules in `webchat-react` and documenting them as UI: the widget would remain the owner of storefront and voice behavior, which is the problem this spec exists to close.
- Moving presentation too (message grouping, streaming buffer, locale formatting): the service constitution says this library ships no markup, and the widget constitution requires locale formatting and sanitization at render time.
- Folding the new rules into `src/index.js`: the facade is already past the file-size guidance, and Principle XI says new responsibilities go to focused modules.
- A breaking `getStarters()` with no arguments in this version: current consumers pass `productData`. The new watch API is additive; the old method stays.

## Contracts

| Interface | Change | Version impact | Backward compatible |
|-----------|--------|----------------|---------------------|
| `watchStorefront()`, `unwatchStorefront()`, `getStorefrontSnapshot()` | added | minor | yes — unused until a consumer calls them |
| `setPendingCartItem`, `flushPendingCart`, `requestAvailabilityNotify` | added | minor | yes |
| `enterVoiceSession`, `exitVoiceSession`, `speakIncomingText` | added | minor | yes |
| `SERVICE_EVENTS` `storefront:changed`, `storefront:entered-checkout`, `cart:updated`, `cart:failed`, `voice:state`, `voice:transcript`, `voice:error` | added | minor | yes — new names, no renamed events |
| `getStarters(productData)`, `clearStarters`, `setCustomField`, `sendMessage`, `sendAudio` | unchanged | none | yes |
| Storage key `weni:webchat:storefront` | added | minor | yes — previous versions never read it |
| `src/types/index.d.ts` | modified | minor | yes — additions only |

**Consumers affected**: `webchat-react` is the first consumer and adopts the API in its own spec `specs/010-move-logic-to-service`. Other frontends keep compiling against the current methods. README and `CHANGELOG.md` list the new methods and events in the same pull request. The published version is the next minor after `1.19.2`, through the existing tag-driven `npm-publish.yaml` workflow. No major version.

## Data Model and Migrations

- **Storefront snapshot**: account, product path, SKU id, seller id, availability, checkout flag. Owned by the storefront module. Persisted under `weni:webchat:storefront` so a reload can skip a blank frame. Not written into the session conversation blob.
- **Pending cart**: map of item key to quantity, origin, and debounce deadline. Lives in that same key. Flushed quantities still leave as the existing order and custom-field messages.
- **Voice session**: in-memory only. Nothing about transcripts or audio is persisted.

**Migrations**: No change to the session schema `SessionManager` already writes. The previous package version ignores the unknown key. Rollback to `1.19.2` leaves an unused key and a working session. This version treats a missing or unreadable key as an empty snapshot and resolves the page again.

## Non-Functional Requirements

### Peak Load

One library instance per storefront page. The peak that matters is a seasonal sales peak (Black Friday weekend): the instance handles one streaming assistant reply, one starters round-trip, and one cart flush in the same second. It does not host concurrent shoppers.

### Observability

Structured `console.warn` / `console.error` with a module prefix and a context object: `operation`, `connectionState`, and the correlation ids already on the session (`channelUuid`, session id, message id or starters fingerprint). No message text, token, cart contents, email, phone, or media. New events carry ids and state names, not those payloads.

### Failure Handling

- VTEX and FastStore HTTP calls use a 10s timeout, no retry of a cart flush that may have been applied, and one retry only for a network failure on product resolution. A second failure emits `cart:failed` or a storefront error state and leaves the previous snapshot in place.
- `getStarters` keeps today's behavior: it throws when the socket is not connected. `StarterSession` surfaces that as `starters:error` instead of throwing into the widget.
- Voice permission denial and missing browser support emit `voice:error` and do not start capture. STT socket drops retry with the existing `RetryStrategy` defaults (base delay from `reconnectInterval`, factor 2, max delay 30s) and stop after `maxReconnectAttempts`. Playback failure emits `voice:error` and returns the session to `listening`.
- Cart flush is idempotent on item key: a second flush of the same flushed quantity does not send another order for that key.

### Security and Authorization

The trust boundary is the host page and the socket. Product JSON from the document is validated with the same required-field checks as `validateStartersData` before it is sent. Cart quantities are non-negative numbers. The library does not add a server-side authorization check; the socket server remains the authority for the channel, and this library still only sends on the shopper's existing socket. Tokens from `requestVoiceTokens` stay inside the voice module and are not emitted or logged. No new secret is committed; channel and socket configuration stay on `init`.

## Test Strategy

| Success / acceptance criterion | How this repository proves it |
|--------------------------------|-------------------------------|
| Product page resolution matches today's `vtex.js` rules and triggers `getStarters` | `src/modules/storefront/tests/productResolution.test.ts` feeds fixture documents and asserts the snapshot and the `get_pdp_starters` payload |
| Pending cart debounce, FastStore bootstrap, and VTEX IO flush match `OrderFormContext` | `src/modules/storefront/tests/orderForm.test.ts` |
| Checkout emits entered-checkout; leaving the PDP clears starters | `src/modules/conversation/tests/starterSession.test.ts` |
| Voice entry, transcript, speak, denial, and unsupported browser | `src/modules/voice/tests/voiceSession.test.ts` |
| Current public methods still work | Existing `tests/service.sendPaths.test.js` and starters tests stay green; a new case calls `getStarters(productData)` without `watchStorefront` |
| Logs and events omit shopper content | Assertions on the context object in the tests above |

**Flow coverage**: product page → snapshot → starters request → starters event; pending cart → debounce → flush event; checkout navigation → entered-checkout; voice entry → transcript event → `speakIncomingText` → idle on exit.

**Failure paths covered**: VTEX HTTP timeout, socket down on starters, cart flush failure, microphone denial, STT drop past max attempts, unreadable storefront storage key.

**Stubbed at the boundary**: `fetch`, `WebSocket`, `localStorage`, `MediaRecorder`, and speech-synthesis are stubbed. Tests do not open a live socket or a storefront.

## Rollout and Rollback

Publish this package as the next minor before `webchat-react` bumps its `@weni/webchat-service` peer. Until that bump, production widgets keep their in-repo rules and this API is dormant. Rollback is reverting the widget peer first, then optionally republishing `1.19.2`. The new storage key does not block the old package. Voice ships in a later pull request on the same spec, still as a minor addition, after the storefront slice is in production.

## Constitution Alignment

| Principle | How this spec complies | Exception + justification |
|-----------|------------------------|---------------------------|
| II. Specification Traceability | Opens with Origin Without Product Spec. No product spec is inherited. | none |
| III. No Silent Divergence | Applies only to derived specs. Nothing is inherited. | none |
| IV. Versioned Public Contracts | Additions are a minor. `getStarters(productData)` and existing events stay. | none |
| V. Release & Changelog | `CHANGELOG.md` and README ship in the same pull request as the API. Tag-driven publish. | none |
| VII. Security & Secrets | No committed secrets. Voice tokens stay inside the voice module. | none |
| VIII. Observability | Structured context, correlation ids, no shopper content. | none |
| X. Type Safety | The first new file adds the TypeScript toolchain. New modules are TypeScript. `index.d.ts` updates with the public API. | Existing JavaScript files stay JavaScript; the constitution allows that until a substantial edit. The facade only gains delegations. |
| XI. Single Responsibility | New rules live in `src/modules/storefront`, `conversation`, and `voice`, not in `src/index.js`. The voice port keeps one file per current module (`VoiceService`, `AudioCapture`, `STTConnection`, `TTSPlayer`, `TextChunker`, `EchoGuard`, `SessionGuard`, `errors`, `config`). `TTSPlayer` and `VoiceService` are not merged. | none |
| XIII. Module & Public API Architecture | Facade delegates. New events use `domain:action`. | none |
| XIV. WebSocket Contract & Data Boundaries | Host-page reads sit in the storefront module. Starters still use `buildStartersRequest`. Wire snake_case is unchanged. | none |
| XV. State Management & Async Correctness | Pending, success, and error are events. Cart failure does not leave a flushed key looking pending. | none |
| XVI. Resilience & Error Handling | Timeouts, retriable versus permanent failures, and retry bounds are stated above. | none |
| Testing | New behavior is covered by colocated tests under `src/<area>/tests/` that fail before the move and pass after. Coverage stays at or above the CI threshold. | none |

## Implementation Decisions

- **One spec, two slices**: storefront plus starter session ships first; voice session ships second. They share the ownership goal and do not share code paths, so the widget can adopt them independently.
- **Additive API**: `watchStorefront` is the new entry. `getStarters(productData)` remains for callers that already hold product data.
- **Separate storage key**: `weni:webchat:storefront` avoids rewriting the session blob, so rollback does not depend on a migration.
- **Widget still sends chat text**: voice transcripts are events. `sendMessage` stays the single outbound text path.
- **Presentation stays in the widget**: grouping, streaming animation, locale formatting, sanitization, and starter visibility timers are not moved.
