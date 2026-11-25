# Engineering Specification: Shopping Assistant Components Streaming

**Repository**: `@weni/webchat-service` — frontend

**Feature Branch**: `004-components-streaming`

**Created**: 2026-11-25

**Status**: Draft

## Inheritance from Product Spec

- Product Spec: Streaming de componentes no Shopping Assistant (quick reply, lista e CTA) — https://github.com/weni-ai/vtex-cx-experience-specs/blob/e0f8e7ec9b5645681534645dc182a070b2d38e15/specs/019-sa-components-streaming/spec.md
- Pinned version: `019-sa-components-streaming-v1` (commit `e0f8e7ec9b5645681534645dc182a070b2d38e15`)
- Architecture doc: https://github.com/weni-ai/vtex-cx-experience-specs/blob/148d5ee704f49fb3cf47df26df20d3ac124cd3b8/specs/019-sa-components-streaming/architecture.md — tag `019-sa-components-streaming/arch-v1` (commit `148d5ee704f49fb3cf47df26df20d3ac124cd3b8`)
- Inherited binding decisions: `BD-001`, `BD-002`, `BD-003`, `BD-004`, `BD-005`, `BD-006`, `BD-007`, `BD-008`, `BD-009`, `BD-010`, `BD-011`, plus Architecture Contract Decisions `AD-002`, `AD-005`, and `AD-006`
- Scope of this spec: `weni-webchat-socket` → `@weni/webchat-service` → `webchat-react` (and custom integrators) transport and normalization slice — consuming additive WebSocket streaming component frames (`stream_component_hint`, `stream_component`, `stream_text_end`, extended `stream_end`), normalizing them into camelCase `componentHints` and `streamPhase` on `Message` (while preserving `quick_replies`, `list_message` with optional `item_count`, and `cta_message`), emitting component-only streaming messages on hint arrival, finalizing streams and clearing hints on `stream_end` or WebSocket disconnect/close, stripping transient streaming fields from browser storage and history, restoring `cta_message` in `HistoryManager.processHistory`, and updating `src/types/index.d.ts`
- Divergences: none

## Scope in This Repository

**This repository implements**:

- Boundary validation and normalization (in a new focused TypeScript module `src/utils/streamComponents.ts`) for the additive WebSocket frames defined in [`socket-stream-frames.schema.json`](https://github.com/weni-ai/vtex-cx-experience-specs/blob/148d5ee704f49fb3cf47df26df20d3ac124cd3b8/specs/019-sa-components-streaming/contracts/messages/socket-stream-frames.schema.json): `stream_component_hint`, `stream_component`, `stream_text_end`, and extended `stream_end` (`quick_replies`, `list_message`, `cta_message`), plus `cta_message` validation/restoration in history frames.
- Extending `MessageProcessor` (`src/core/MessageProcessor.js`) to:
  - Emit `streamPhase: 'streaming_text'` on live streamed messages as soon as the bubble is created (either on first `delta` or on `stream_component_hint` / `stream_component` before the first `delta`, supporting both Journey 1 early hints and textless component responses per `FR-028`).
  - Maintain `componentHints` (`{ componentType, labels?, count?, itemCount? }`) idempotently per `(id, componentType)`, strictly excluding any `url` field on hints (`BD-004`, `AD-002`).
  - Transition active streams to `streamPhase: 'awaiting_components'` on `stream_text_end` with authoritative text while keeping the stream open for pending `stream_component` / `stream_end` frames (`FR-009`, `FR-018`).
  - Apply validated `stream_component` payloads (`quick_replies`, `list_message` with optional `item_count`, `cta_message` with validated complete `http(s)` URL) idempotently per `(id, component_type)` while preserving `componentHints` until stream completion.
  - Finalize streams on `stream_end` with authoritative text, any validated final components (supporting multiple component types on the same message per `BD-006`/`AD-006`), `status: 'delivered'`, `streamPhase: 'completed'`, and `componentHints` cleared/omitted (including the `!emitted` path when `stream_start` is followed directly by `stream_end` without deltas or hints, `BD-008`/`FR-028`).
  - Finalize all active emitted streams on WebSocket `disconnected` or `closed` (`handleConnectionLost()` wired from `src/index.js`): clear `componentHints`, set `status: 'delivered'` and `streamPhase: 'completed'`, preserve already-received text, stop active typing/thinking indicators, and emit `message:updated` without attaching undelivered components (`FR-012`, `AD-005`).
- Ensuring `StateManager.updateMessage` cleanly removes `componentHints` from stored in-memory `Message` objects when updated with `componentHints: undefined` while still emitting `{ ..., componentHints: undefined }` in the `message:updated` event payload (`AD-005`).
- Ensuring `SessionManager` (`src/core/SessionManager.js`) never persists transient streaming fields (`componentHints`, `streamPhase`, or `status: 'streaming'`) to `localStorage`/`sessionStorage`, and defensively strips them on restore so page reloads, reopens, and "Use here" tab switches never replay skeletons or animations (`BD-007`, `FR-029`, `AD-005`).
- Fixing `HistoryManager.processHistory` (`src/modules/HistoryManager.js`) to restore validated `cta_message` (`display_text` + complete `http(s)` `url` with unescaped URL slashes) and preserve optional positive integer `list_message.item_count`, while never emitting `componentHints` or `streamPhase` (`FR-029`, `FR-034`, `AD-005`, `AD-006`), and backfilling `cta_message` in `HistoryManager.merge` when a cached copy lacks it.
- Updating `src/types/index.d.ts`, `src/utils/constants.js`, `src/index.js` (constant exports if added and disconnect wiring), `CHANGELOG.md`, and `README.md` for a backward-compatible MINOR release (`1.22.0`).
- Verifying `simulateMessageReceived(frame)` passes through the new stream frames (`stream_component_hint`, `stream_component`, `stream_text_end`, extended `stream_end`) cleanly so `webchat-react`'s dev stream simulation harness (`src/dev/simulateComponentStreams.ts` in [webchat-react#177](https://github.com/weni-ai/webchat-react/pull/177)) works end to end without a live socket.

**Out of scope here**:

- `nexus-ai` (owned by Nexus): gRPC emission of `component_hint`, `component`, `text_end`, `completed` (`metadata["components"]`), enabling gRPC for `use_components=True` Shopping Assistant projects, removing the 1024-char split on the stream path, and `POST /api/v2/internals/messages/stream` calls.
- `flows` (owned by Engine/Flows): `MsgStreamSerializer` component validation and `Idempotency-Key` support in `POST /api/v2/internals/messages/stream` (`AD-004`).
- `weni-webchat-socket` (owned by Experience): gRPC ingestion/validation of streaming component events, cross-pod Redis Pub/Sub and WebSocket frame emission, and single atomic MongoDB `Save` on `completed` (`AD-001`, `AD-002`).
- `webchat-react` (owned by Experience, implemented in [webchat-react#177](https://github.com/weni-ai/webchat-react/pull/177)): skeleton UI, staggered entrance animations (<=300ms), 10-second component wait timer, last-message click gating, `prefers-reduced-motion`, scroll/focus/sub-view stability, and `aria-live="polite"` announcements (`BD-001`..`BD-008`).
- Out-of-scope channels and message types per `BD-009`: WhatsApp, `product_list`, `product_carousel`, media messages, `order` messages, `ThinkingIndicator` copy/cadence, voice mode, message timestamps/read ticks (spec 009), and merchant configuration (`BD-010`).
- Normalizing legacy `snake_case` component field names (`quick_replies`, `list_message`, `cta_message`, `button_text`, `list_items`, `item_count`, `display_text`) to `camelCase`: preserved for backward compatibility per `AD-005` and Constitution IV.

**Depends on**:

- `weni-webchat-socket` producing WebSocket frames conforming to [`contracts/messages/socket-stream-frames.schema.json`](https://github.com/weni-ai/vtex-cx-experience-specs/blob/148d5ee704f49fb3cf47df26df20d3ac124cd3b8/specs/019-sa-components-streaming/contracts/messages/socket-stream-frames.schema.json) (`AD-002`): `stream_component_hint`, `stream_component`, `stream_text_end`, extended `stream_end`, and `history` items carrying `quick_replies`, `list_message` (with optional `item_count`), and `cta_message`.
- Consumer `webchat-react` ([webchat-react#177](https://github.com/weni-ai/webchat-react/pull/177)) consuming [`contracts/messages/webchat-service-message.schema.json`](https://github.com/weni-ai/vtex-cx-experience-specs/blob/148d5ee704f49fb3cf47df26df20d3ac124cd3b8/specs/019-sa-components-streaming/contracts/messages/webchat-service-message.schema.json) (`AD-005`, `AD-006`) via `message:received`, `message:updated`, `history:loaded`, and `StateManager`. Development and automated tests in this repository use the schema `examples` and `webchat-react` frame shapes as mocks; there is no build-time dependency on `weni-webchat-socket` being deployed first.

## Current State

- `src/core/MessageProcessor.js` (880 lines) —
  - `process(rawMessage)` routes `message`, `stream_start`, `stream_rationale`, `delta`, `stream_end`, `typing_start`, and `ack`; any other frame (`stream_component_hint`, `stream_component`, `stream_text_end`) falls through to `SERVICE_EVENTS.MESSAGE_UNKNOWN`.
  - `_beginStream(streamId)` records `{ text: '', timestamp }` in `this.streams` and defers emitting a chat message until the first `delta` (`_handleFirstDelta` → `_emitDeferredStreamMessage`), creating `{ id, type: 'text', text: '', timestamp, direction: 'incoming', status: 'streaming' }` with no `streamPhase` and no `componentHints`.
  - `_processStreamEnd(raw)` only extracts `raw.content` (with `isJsonObject` leaked-JSON guard) and ignores `quick_replies`, `list_message`, and `cta_message`. It also branches on `this.streams.has(messageId)` rather than whether a message was actually emitted, so a `stream_start` followed directly by `stream_end` (without deltas) emits `MESSAGE_UPDATED` for a message that was never added to `StateManager`.
  - Has no handler to finalize active streams when the WebSocket disconnects or closes.
  - `_handleTypingIndicator` and `_processStreamRationale` gate on `this.nextExpectedSeq > STREAM_INITIAL_SEQUENCE`, not on `this.streamMessageEmitted`, which would let a late typing/rationale event re-show thinking after a hint already opened the bubble.
- `src/index.js` (1462 lines) —
  - `_setupEventListeners()` handles `websocket` `CONNECTION_STATUS_CHANGED` (`connected`, `disconnected`, `closed`) by toggling `this._connected` and emitting `DISCONNECTED`/`CLOSED`, but never notifies `this.messageProcessor` to finalize in-flight streams.
  - On `messageProcessor` `MESSAGE_PROCESSED` → calls `state.addMessage(msg)`, `session.appendToConversation(msg)`, and `emit(SERVICE_EVENTS.MESSAGE_RECEIVED, msg)`.
  - On `messageProcessor` `MESSAGE_UPDATED` → calls `state.updateMessage(messageId, updates)`, `session.updateConversation(messageId, updates)`, and `emit(SERVICE_EVENTS.MESSAGE_UPDATED, messageId, updates)`.
  - `simulateMessageReceived(message)` calls `this.messageProcessor.process({ ...message, persisted: true })`, adding `persisted: true` onto any simulated wire frame.
- `src/core/StateManager.js` (240 lines) —
  - `updateMessage(messageId, updates)` shallow-merges `{ ...msg, ...updates }`, so passing `{ componentHints: undefined }` leaves an explicit `componentHints: undefined` own property on `msg` instead of omitting the key.
- `src/core/SessionManager.js` (453 lines) —
  - `appendToConversation` and `updateConversation` store the live message object references and call `_save()`. `_save()` filters out ephemeral `data:`/`blob:` media messages, then persists every remaining property — meaning `componentHints`, `streamPhase`, and `status: 'streaming'` would be written to `localStorage`/`sessionStorage` and restored on page reload unless stripped before persistence.
- `src/modules/HistoryManager.js` (345 lines) —
  - `processHistory(rawHistory)` copies `quick_replies` and `list_message` (when `list_items?.length >= 1`), but drops `cta_message` completely.
  - `merge(historyMessages, currentMessages)` prefers cached messages over history messages, with a backfill exception only for `customData`.
- `src/types/index.d.ts` (556 lines) —
  - `Message.status` omits `'streaming'`; `Message.quick_replies` is typed only as `QuickReply[]` (excluding `string[]`); `Message` lacks `streamPhase`, `componentHints`, `list_message`, and `cta_message`.
- `src/utils/constants.js` (342 lines) — defines `MESSAGE_STATUS.STREAMING`, `SERVICE_EVENTS`, `MESSAGE_ID_PREFIX` (`'msg_'`), and `STREAM_INITIAL_SEQUENCE` (`1`), but has no constants for component types or stream phases.
- `src/utils/messageBuilder.js` — exports `isOfficialHttpUrl(value)` (checks `new URL(value)` protocol is `http:` or `https:`). Note: `new URL('https://')` throws, while hostname validation ensures a complete absolute URL (`parsed.hostname` non-empty).
- TypeScript toolchain (`tsconfig.json`, `rollup.config.js`, `eslint.config.mjs`, `jest.config.js`, `package.json`) — already enabled and proven by `src/modules/backInStock/*.ts` and `src/network/BackInStockClient.ts`. Note: `jest.config.js` `collectCoverageFrom` excludes `'!src/**/*.test.js'` but does not yet exclude `'!src/**/*.test.ts'`.
- Nearest analogous features and test seams: `stream_rationale` in `MessageProcessor.js` + `tests/MessageProcessor.test.js`, `customData` in `src/utils/helpers.js` + `HistoryManager.js` + `tests/HistoryManager.test.js`, and `tests/service.events.test.js` / `tests/SessionManager.test.js`.

## Technical Approach

### Components Affected

| Component | Change | Why |
|-----------|--------|-----|
| `src/utils/streamComponents.ts` | new | Single source of truth (strict TypeScript, Constitution X & XI) for streaming component constants (`COMPONENT_TYPES`, `STREAM_PHASES`), TypeScript types (`ComponentType`, `StreamPhase`, `ComponentHint`, `ListMessageItem`, `ListMessage`, `CtaMessage`, `StreamComponentsBundle`), boundary validators/normalizers (`normalizeComponentHint`, `normalizeStreamComponent`, `normalizeStreamEndComponents`, `normalizeCtaMessage`, `normalizeListMessage`, `normalizeQuickReplies`, `upsertComponentHint`), PII-free structured warning helper, and `stripTransientStreamingFields` for storage sanitization. Keeps `MessageProcessor.js` and `HistoryManager.js` thin. |
| `src/utils/constants.js` | modified | Re-exports or centralizes `COMPONENT_TYPES` (`QUICK_REPLIES`, `LIST_MESSAGE`, `CTA_MESSAGE`) and `STREAM_PHASES` (`STREAMING_TEXT`, `AWAITING_COMPONENTS`, `COMPLETED`) alongside existing `MESSAGE_STATUS` and `MESSAGE_KINDS`. |
| `src/core/MessageProcessor.js` | modified | Routes `stream_component_hint`, `stream_component`, and `stream_text_end` in `process()`; tracks per-stream `{ text, timestamp, emitted, streamPhase, componentHints }` and bounded `completedStreamIds`; emits initial streaming bubble with `streamPhase: 'streaming_text'` on first delta or early hint/component; updates `streamPhase` to `'awaiting_components'` on `stream_text_end`; attaches validated components on `stream_component` and `stream_end`; clears `componentHints` and sets `streamPhase: 'completed'` on `stream_end`; adds `handleConnectionLost()` for disconnect/close cleanup (`FR-012`); guards typing/rationale against `streamMessageEmitted`. |
| `src/core/StateManager.js` | modified | In `updateMessage(messageId, updates)`, deletes keys explicitly set to `undefined` for transient fields (`componentHints`) on the stored message object while still emitting `updates` verbatim on `SERVICE_EVENTS.MESSAGE_UPDATED` so `message` conforms to `webchat-service-message.schema.json` ("Cleared (omitted)") and `AD-005`. |
| `src/core/SessionManager.js` | modified | Uses `stripTransientStreamingFields` in `_save()` (without mutating live in-memory message objects) and defensively in `restore()` so `componentHints`, `streamPhase`, and `status: 'streaming'` are never stored in browser storage or revived after reload (`BD-007`, `FR-029`, `AD-005`). |
| `src/modules/HistoryManager.js` | modified | Uses `normalizeCtaMessage` (and preserves validated `list_message` including optional `item_count`) in `processHistory()` to restore `cta_message` (`FR-029`, `AD-005`); guarantees `componentHints` and `streamPhase` are never emitted on history items (`BD-007`); backfills `cta_message` in `merge()` when a cached message lacks it. |
| `src/index.js` | modified | Calls `this.messageProcessor.handleConnectionLost()` in the `websocket` `CONNECTION_STATUS_CHANGED` listener when `status === 'disconnected'` or `status === 'closed'`; exports `STREAM_PHASES` and `COMPONENT_TYPES` on `WeniWebchatService` and as named exports. |
| `src/types/index.d.ts` | modified | Declares `ComponentType`, `StreamPhase`, `ComponentHint`, `ListMessageItem`, `ListMessage`, `CtaMessage`, and wire frame interfaces (`StreamComponentHintMessage`, `StreamComponentMessage`, `StreamTextEndMessage`, `StreamEndMessage`); extends `Message` with `status` including `'streaming'`, `streamPhase?: StreamPhase`, `componentHints?: ComponentHint[]`, `quick_replies?: Array<string | QuickReply>`, `list_message?: ListMessage`, and `cta_message?: CtaMessage`; declares `STREAM_PHASES` and `COMPONENT_TYPES` exports. |
| `jest.config.js` | modified | Adds `'!src/**/*.test.ts'` to `collectCoverageFrom` so colocated TypeScript unit tests under `src/<area>/tests/` are excluded from production coverage measurement. |
| `src/utils/tests/streamComponents.test.ts` | new | Colocated TypeScript unit tests covering every boundary validator, normalizer, hint upsert idempotency, CTA URL rejection, PII-free warning checks, and `stripTransientStreamingFields`. |
| `tests/MessageProcessor.test.js`, `tests/HistoryManager.test.js`, `tests/SessionManager.test.js`, `tests/StateManager.test.js`, `tests/service.events.test.js`, `tests/service.simulators.test.js` | modified | End-to-end flow tests and failure path tests for streaming components, disconnect cleanup, storage sanitization, `cta_message` history parity, and `simulateMessageReceived` frame replay. |
| `CHANGELOG.md`, `README.md` | modified | Adds `1.22.0` (`[Unreleased]` → `Added` / `Fixed`) changelog entry and documents `componentHints`, `streamPhase`, `list_message.item_count`, `cta_message` history support, and disconnect stream finalization in `README.md`. |

### Flow

#### 1. Stream Lifecycle With Early Hint, Optional Delayed Component, and Completion

1. **`stream_start`** (`{ type: 'stream_start', id }`):
   - `MessageProcessor._processStreamStart` converts `id` to `msg_<id>` via `_getMessageIdFromRaw` and calls `_beginStream(streamId)`, storing `{ text: '', timestamp: Date.now(), emitted: false, streamPhase: 'streaming_text', componentHints: [] }` in `this.streams`. No chat message is emitted yet so the thinking indicator remains visible until either the first hint or the first text delta arrives.
2. **`stream_component_hint`** (`{ type: 'stream_component_hint', id, component_type, labels?, count?, item_count? }`):
   - `MessageProcessor._processStreamComponentHint` resolves `streamId`. If `streamId` is missing, logs a PII-free `console.warn` and returns. If `streamId` is in `completedStreamIds`, ignores silently.
   - Delegates validation and normalization to `normalizeComponentHint(raw)` in `src/utils/streamComponents.ts`:
     - Whitelists only `component_type` → `componentType`, `labels` (non-empty strings), `count` (positive integer), and `item_count` → `itemCount` (positive integer, only when `componentType === 'list_message'`).
     - Ignores extra transport/simulator envelope keys such as `persisted` (added by `simulateMessageReceived`).
     - Never reads or forwards any `url` field (`BD-004`, `AD-002`).
     - If invalid (unknown `component_type`, non-object, etc.), logs a structured PII-free `console.warn` and returns without emitting `SERVICE_EVENTS.ERROR`.
   - If `this.streams` has no entry for `streamId` and `!this.activeStreamId`, adopts the stream via `_beginStream(streamId)`. (If a different stream is active, ignores to avoid hijacking an unrelated stream.)
   - Upserts the normalized hint into `streamData.componentHints` idempotently by `componentType` (`upsertComponentHint` replaces an existing entry for the same `componentType` without duplicating skeletons).
   - Stops any active typing/thinking indicator (`_stopTyping()`).
   - If `!streamData.emitted`: creates the initial streaming `Message` (`{ id: streamId, type: 'text', text: streamData.text, timestamp: streamData.timestamp, direction: 'incoming', status: 'streaming', streamPhase: streamData.streamPhase, componentHints: [...streamData.componentHints] }`), sets `streamData.emitted = true` and `this.streamMessageEmitted = true`, pushes to `this.queue`, and runs `_processQueue()` → `MESSAGE_PROCESSED` → `state.addMessage` + `session.appendToConversation` + `emit('message:received')`.
   - If `streamData.emitted`: emits `MESSAGE_UPDATED` with `{ componentHints: [...streamData.componentHints], status: 'streaming', streamPhase: streamData.streamPhase, timestamp: Date.now() }` → `state.updateMessage` + `session.updateConversation` + `emit('message:updated')`.
3. **`delta`** (`{ v, seq }`):
   - Existing sequence-ordered buffering (`_processDeltaSequence`) runs unchanged.
   - If `!this.streamMessageEmitted`, `_handleFirstDelta()` stops typing and emits the initial streaming `Message` with `status: 'streaming'` and `streamPhase: 'streaming_text'`.
   - `_appendStreamContent` updates `streamData.text` (preserving `emitted`, `streamPhase`, and `componentHints` on the stream entry) and emits `MESSAGE_UPDATED` with `{ text: mergedText, status: 'streaming', streamPhase: streamData.streamPhase, timestamp }`.
4. **`stream_text_end`** (`{ type: 'stream_text_end', id, content }`):
   - Resolves `streamId`; ignores missing `id` (with `console.warn`) or already-completed `streamId`.
   - Stops typing/thinking (`_stopTyping()`).
   - Computes authoritative text with the same leaked-JSON protection as `_processStreamEnd`: if `typeof raw.content === 'string' && !isJsonObject(raw.content)`, uses `unescapeEscapedUrlSlashes(raw.content)`; otherwise falls back to `streamData?.text || ''`.
   - Sets `streamData.text = finalText` and `streamData.streamPhase = 'awaiting_components'`.
   - If `!streamData.emitted`: emits the initial streaming `Message` (`text: finalText`, `status: 'streaming'`, `streamPhase: 'awaiting_components'`, plus `componentHints` if non-empty) and marks `emitted = true`.
   - If `streamData.emitted`: emits `MESSAGE_UPDATED` with `{ text: finalText, status: 'streaming', streamPhase: 'awaiting_components', timestamp: Date.now() }`.
   - Keeps the stream open in `this.streams` waiting for `stream_component` / `stream_end`.
5. **`stream_component`** (`{ type: 'stream_component', id, component_type, quick_replies | list_message | cta_message }`):
   - Resolves `streamId`; ignores missing `id` (with `console.warn`) or already-completed `streamId`.
   - Validates and normalizes via `normalizeStreamComponent(raw)` in `src/utils/streamComponents.ts`:
     - `quick_replies`: non-empty array of non-empty strings (also accepting legacy `{ title }` objects with non-empty `title`).
     - `list_message`: non-empty `button_text`, non-empty `list_items` (each with non-empty `uuid` and `title`, optional `description`), optional positive integer `item_count` (omitted when absent or invalid).
     - `cta_message`: non-empty `display_text` and complete absolute `http(s)` `url` (after `unescapeEscapedUrlSlashes`, verified by `new URL()` protocol `http:`/`https:` and non-empty `hostname`; blocks `javascript:`, `data:`, relative URLs, and partial URLs like `"https://"`).
     - Malformed payload → logs structured PII-free `console.warn` and discards without failing the stream or emitting `SERVICE_EVENTS.ERROR`.
   - Adopts stream if not yet started and no other stream is active; stops typing/thinking.
   - If `!streamData.emitted`: emits the initial streaming `Message` with `{ id: streamId, type: 'text', text: streamData.text, timestamp, direction: 'incoming', status: 'streaming', streamPhase: streamData.streamPhase, [componentType]: normalizedPayload }` (and `componentHints` if non-empty) and marks `emitted = true`.
   - If `streamData.emitted`: emits `MESSAGE_UPDATED` with `{ [componentType]: normalizedPayload, status: 'streaming', streamPhase: streamData.streamPhase, timestamp: Date.now() }`. Does **not** clear `componentHints` yet so multi-component messages keep remaining skeletons visible until `stream_end` (matching `useComponentStreamLifecycle` in `webchat-react`).
6. **`stream_end`** (`{ type: 'stream_end', id, content, quick_replies?, list_message?, cta_message? }`):
   - Resolves `streamId`; stops typing/thinking; clears `isAwaitingReply`.
   - Extracts authoritative `finalText` (with existing `isJsonObject` leaked-JSON guard) and extracts all validated components via `normalizeStreamEndComponents(raw)` (supporting any combination of `quick_replies`, `list_message`, and `cta_message` simultaneously per `BD-006`/`AD-006`; malformed individual components are discarded with a PII-free `console.warn` without dropping text or other valid components).
   - If `streamData && streamData.emitted`:
     - Emits `MESSAGE_UPDATED` with `{ text: finalText, status: 'delivered', streamPhase: 'completed', componentHints: undefined, ...validatedComponents, timestamp: now }`.
     - `StateManager.updateMessage` merges updates and removes the `componentHints` property from the stored `Message` object; `SessionManager.updateConversation` persists the finalized message without transient streaming fields (`componentHints`, `streamPhase`).
   - Else (`!streamData || !streamData.emitted` — e.g. missed `stream_start`, instant `stream_start` → `stream_end` with components, or `BD-008` no-hint textless response):
     - If `contentIsLeakedJson` and no valid components were present: returns without creating a message (preserving existing leaked-JSON guard).
     - Otherwise queues a delivered `Message` (`{ id: streamId, type: 'text', text: finalText, timestamp: streamData?.timestamp || now, direction: 'incoming', status: 'delivered', streamPhase: 'completed', ...validatedComponents }`) and runs `_processQueue()`.
   - Cleans up `this.streams` via `_cleanupStream(streamId)`, records `streamId` in bounded `completedStreamIds` (max 20 entries), and calls `_rememberIncomingText(finalText)`.

#### 2. WebSocket Disconnect / Close Cleanup (`FR-012`, `AD-005`)

1. `WebSocketManager` transitions to `'disconnected'` or `'closed'` and emits `SERVICE_EVENTS.CONNECTION_STATUS_CHANGED`.
2. `WeniWebchatService` (`src/index.js`) invokes `this.messageProcessor.handleConnectionLost()`.
3. `MessageProcessor.handleConnectionLost()`:
   - Stops any active typing/thinking indicator (`_stopTyping()`).
   - For every `[streamId, streamData]` in `this.streams`:
     - If `streamData.emitted`: emits `SERVICE_EVENTS.MESSAGE_UPDATED` with `(streamId, { status: 'delivered', streamPhase: 'completed', componentHints: undefined, timestamp: Date.now() })` (preserving already-received `text` and any already-delivered valid component; omitting undelivered hinted components).
     - Records `streamId` in `completedStreamIds`.
   - Clears `this.streams` and calls `_resetStreamState()`.
4. `StateManager` updates the message (omitting `componentHints`), `SessionManager` persists the clean delivered copy, and `webchat-react` immediately unmounts any active skeletons with zero error UI (`FR-012`).

#### 3. Storage Persistence and History Restore (`BD-007`, `FR-029`, `FR-034`, `AD-005`)

1. **`SessionManager._save()`**: maps each non-ephemeral message through `stripTransientStreamingFields(item)` onto a shallow copy before writing to `this.storage.set(...)`:
   - Removes `componentHints` and `streamPhase`.
   - If `item.status === 'streaming'`, persists `status: 'delivered'` in storage (without mutating the live object in memory).
2. **`SessionManager.restore()`**: passes restored `conversation` entries through `stripTransientStreamingFields` defensively before returning the session.
3. **`HistoryManager.processHistory(rawHistory)`**:
   - Restores `quick_replies` (as today) and `list_message` (preserving optional positive integer `item_count` when `list_items.length >= 1`).
   - Restores `cta_message` using `normalizeCtaMessage(item.message?.cta_message)`: validates non-empty `display_text` and complete `http(s)` `url` (with `unescapeEscapedUrlSlashes`), logging a PII-free `console.warn` under `HistoryManager:` if malformed.
   - Never sets `componentHints` or `streamPhase`, ensuring `webchat-react` renders history/reload/reconnect/"Use here" responses directly in final state without skeleton or animation (`BD-007`, `FR-029`).
4. **`HistoryManager.merge(historyMessages, currentMessages)`**: when a cached message lacks `cta_message` and the matching history message has one, copies `cta_message` onto the merged entry (matching the existing `customData` backfill pattern).

### Rejected Alternatives

- **Adding new `SERVICE_EVENTS` (`stream:component-hint`, `stream:text-end`, `stream:component`)**: Rejected by `AD-005`. Consumers already subscribe to `message:received`, `message:updated`, and `state:changed`; exposing `componentHints` and `streamPhase` directly on `Message` keeps the public event surface minimal and guarantees `StateManager` remains the single source of truth (Constitution XV).
- **Adding all validation/normalization logic directly inside `src/core/MessageProcessor.js`**: Rejected by Constitution X and XI. `MessageProcessor.js` is already 880 lines (well above the 500-line threshold) and written in JS. Extracting boundary validation, normalization, and storage sanitization into `src/utils/streamComponents.ts` enforces strict TypeScript for all new code and keeps edits to `MessageProcessor.js` focused on stream orchestration.
- **Mutating `session.conversation` items in place inside `SessionManager._save()` to remove `componentHints`/`streamPhase`**: Rejected because `SessionManager.appendToConversation` stores the same object reference held in `StateManager.state.messages`; in-place mutation would strip live `componentHints`/`streamPhase` out of `StateManager` mid-stream. Mapping to a sanitized shallow copy during serialization keeps live state and persisted storage strictly isolated.
- **Validating wire frames with strict unknown-key rejection on the top-level WebSocket envelope**: Rejected because `WeniWebchatService.simulateMessageReceived(frame)` spreads `persisted: true` onto simulated frames (used by `webchat-react`'s dev harness). Whitelisting contract fields during normalization guarantees no unapproved fields (like a stray `url` on a hint) leak out while keeping `simulateMessageReceived` compatible.
- **Throwing or emitting `SERVICE_EVENTS.ERROR` on malformed `stream_component_hint` or `stream_component` payloads**: Rejected by `FR-011`, `FR-012`, and Architecture Cross-Cutting Conventions. Malformed component payloads are permanent contract errors that must be discarded with a structured PII-free `console.warn` without interrupting text delivery or surfacing an error banner to the shopper.

## Contracts

| Interface | Change | Version impact | Backward compatible |
|-----------|--------|----------------|---------------------|
| `Message` emitted via `message:received`, `message:updated`, `state:changed`, `getMessages()` | added optional `streamPhase?: 'streaming_text' \| 'awaiting_components' \| 'completed'` and `componentHints?: ComponentHint[]` (`camelCase`); extended `stream_end` / `stream_component` to populate `quick_replies`, `list_message` (with optional `item_count`), and `cta_message` | minor | yes — purely additive optional fields; consumers not reading them behave identically |
| `Message` emitted via `history:loaded` and `getHistory()` | added `cta_message` restoration parity and preserved optional `list_message.item_count`; never includes `streamPhase` or `componentHints` | minor | yes — additive restoration of existing wire field; legacy history items without `cta_message` or `item_count` are unchanged |
| Consumed WebSocket frames (`socket-stream-frames.schema.json`) | added handlers for `stream_component_hint`, `stream_component`, `stream_text_end`; extended `stream_end` to accept optional `quick_replies`, `list_message`, `cta_message` | minor | yes — existing `stream_start` / `delta` / `stream_end` (text-only) and `message` frames continue working identically |
| Stored browser session (`weni:webchat:session` `conversation[]`) | strips transient `componentHints`, `streamPhase`, and `status: 'streaming'` before storage write and on restore | minor | yes — same storage key and schema; older library versions read stored messages without change |
| Constants (`STREAM_PHASES`, `COMPONENT_TYPES`) on `WeniWebchatService` and named exports | added | minor | yes — additive exports |
| `src/types/index.d.ts` (`Message`, `ComponentHint`, `StreamPhase`, `ComponentType`, `ListMessage`, `ListMessageItem`, `CtaMessage`, stream frame interfaces) | added / broadened (`Message.status` includes `'streaming'`; `Message.quick_replies` accepts `Array<string \| QuickReply>`) | minor | yes — strictly additive / widening compatible with existing consumers |

Package version bumps from `1.21.0` to `1.22.0` (MINOR release, published via tag-driven `npm-publish.yaml` with `CHANGELOG.md` updated in the same PR).

**Consumers affected**:
- `webchat-react` ([webchat-react#177](https://github.com/weni-ai/webchat-react/pull/177)): upgrades its `@weni/webchat-service` dependency from `1.21.0` to `1.22.0` to receive live `componentHints`, `streamPhase`, streamed component delivery, disconnect cleanup, and `cta_message` history parity.
- Custom webchat integrators on `@weni/webchat-service`: unaffected if they do not read the new optional fields; notified via `CHANGELOG.md` (`1.22.0`) and `README.md` documentation.

## Data Model and Migrations

- **In-memory `Message` (`StateManager`)**: gains optional transient fields `streamPhase?: StreamPhase` and `componentHints?: ComponentHint[]` during live streaming, plus existing component payloads `quick_replies`, `list_message` (with optional `item_count`), and `cta_message`. On `stream_end` or WebSocket disconnect/close, `componentHints` is omitted and `streamPhase` becomes `'completed'` with `status: 'delivered'`.
- **In-memory stream buffer (`MessageProcessor.streams`)**: internal `Map<string, StreamEntry>` extended from `{ text, timestamp }` to `{ text, timestamp, emitted, streamPhase, componentHints }`, plus bounded `completedStreamIds` (max 20 entries) to discard stray post-completion frames. Owned exclusively by `MessageProcessor`; cleared on `stream_end` or `handleConnectionLost()`.
- **Persisted session conversation (`SessionManager` / `StorageManager`, key `weni:webchat:session`)**: stores finalized message text and delivered components (`quick_replies`, `list_message`, `cta_message`), and **never** stores `componentHints`, `streamPhase`, or `status: 'streaming'` (`BD-007`, `AD-005`).

**Migrations**: none. No storage key change and no schema version bump. Sessions persisted by `1.21.0` restore without error in `1.22.0`; sessions persisted by `1.22.0` contain no transient streaming fields and remain 100% readable by `1.21.0`, making rollback safe in both directions.

## Non-Functional Requirements

### Peak Load

Peak load occurs during seasonal retail campaign spikes (e.g., Black Friday shopping peak) across all Shopping Assistant storefronts simultaneously (`BD-010`). In one shopper browser tab, the peak is 1 active streamed response at a time (~20–30 assistant turns per hour per shopper, up to 3 component types per turn: 1 `list_message` + 1 `cta_message` + 1 `quick_replies`, with up to 32 KB UTF-8 per component payload as bounded upstream by `AD-001`).

- Per-frame processing in `webchat-service` is O(k) where `k` is the number of labels/items in the single hint or component frame (simple property validation and shallow object construction, zero DOM work, zero extra network requests, zero timers added by this feature).
- `completedStreamIds` is bounded to 20 IDs (FIFO eviction), preventing unbounded memory growth over long sessions.
- `componentHints` and `streamPhase` are never persisted to `localStorage`/`sessionStorage`, adding zero transient storage overhead.

### Observability

- All warnings use `console.warn` with a module prefix (`MessageProcessor:` or `HistoryManager:`) and a structured context object (Constitution VIII):
  - Malformed or missing-id `stream_component_hint`: `console.warn('MessageProcessor: invalid component hint discarded', { operation: 'normalize-component-hint', messageId, componentType, reason })`
  - Malformed `stream_component` or invalid component inside `stream_end`: `console.warn('MessageProcessor: invalid stream component discarded', { operation: 'normalize-stream-component', messageId, componentType, reason })`
  - Missing-id `stream_text_end`: `console.warn('MessageProcessor: stream_text_end ignored', { operation: 'stream-text-end', reason: 'missing_id' })`
  - Malformed `cta_message` in history: `console.warn('HistoryManager: invalid cta_message discarded', { operation: 'normalize-history-cta', messageId, componentType: 'cta_message', reason })`
- **Correlation identifier**: `messageId` (prefixed `msg_<id>` from `weni-webchat-socket`'s `id`, which originates from `nexus-ai`'s `msg_id`, or MongoDB `ID` in history) is included in every structured warning context so logs across `webchat-react`, `webchat-service`, and `weni-webchat-socket` can be joined.
- **Strict PII exclusion**: Logs and error events MUST NEVER include `text`, `content`, `labels`, `button_text`, `list_items`, `display_text`, `url`, session tokens, or raw payload dumps (Constitution VII & VIII; Product Spec *Privacy & Data Protection*; Architecture *Risks*).
- Normal/valid frames and absent optional fields produce zero log noise.

### Failure Handling

This feature introduces no new outbound network calls or timers; all failures arrive as malformed WebSocket frames or connection drops:

- **Malformed `stream_component_hint` / `stream_component` / `stream_end` component** (permanent contract error, non-retriable): discarded at the `streamComponents.ts` boundary with a structured PII-free `console.warn`. Text streaming continues unaffected, no `SERVICE_EVENTS.ERROR` is emitted, and valid sibling components in the same `stream_end` frame are still delivered (`FR-011`, `FR-012`, `AD-002`).
- **Invalid or partial CTA URL** (`javascript:`, `data:`, relative path, empty host, missing scheme): rejected by `normalizeCtaMessage` (in `stream_component`, `stream_end`, and `HistoryManager.processHistory`) with a structured PII-free `console.warn` (never logging the URL), guaranteeing partial or unsafe links never reach consumers (`BD-004`, `FR-018`).
- **CTA `url` accidentally included on `stream_component_hint`**: silently stripped by whitelisted normalization (`componentType`, `labels`, `count`, `itemCount` only) so a URL can never leak via hints (`BD-004`).
- **WebSocket disconnect or permanent close mid-stream** (retriable transport failure handled by existing `WebSocketManager` + `RetryStrategy` exponential backoff up to `maxReconnectAttempts: 30` / 30s cap): `MessageProcessor.handleConnectionLost()` immediately finalizes all active emitted streams with `status: 'delivered'`, `streamPhase: 'completed'`, and `componentHints: undefined`, keeping partial text intact and allowing `webchat-react` to remove skeletons immediately without error UI (`FR-012`, `AD-005`). Upon reconnect, `_handleWebSocketConnected()` fetches history (`getHistory`, existing 30s timeout) and replaces temporary `msg_*` messages with the MongoDB-persisted completed records (`FR-029`, `BD-007`).
- **Duplicate/replayed `stream_component_hint` or `stream_component` frames**: idempotent by `(id, componentType)` — replaces existing entry without duplicating hints or components (Architecture *Cross-Cutting Conventions*).
- **Late component/hint/text_end frames after `stream_end` or disconnect**: ignored via bounded `completedStreamIds` set so finalized messages are never reopened or duplicated.
- **Retry policy**: no outbound data propagation is added by this feature; WebSocket reconnection continues using the existing configurable `RetryStrategy` (`reconnectInterval` default 3000ms, max 30000ms, factor 2, jitter up to 1000ms, `maxReconnectAttempts` default 30).

### Security and Authorization

- **Trust boundary**: Unvalidated JSON frames from `weni-webchat-socket` cross the boundary at `MessageProcessor.process()` (`stream_component_hint`, `stream_component`, `stream_text_end`, `stream_end`) and `HistoryManager.processHistory()` (`history[]`). Every component payload is validated and normalized in `src/utils/streamComponents.ts` before entering `StateManager`, `SessionManager`, or emitted events (Constitution XIV).
- **URL safety**: `cta_message.url` is unescaped only for JSON-escaped slashes (`unescapeEscapedUrlSlashes`) and strictly validated to require an absolute `http:` or `https:` URL with a non-empty hostname (`new URL()`). Any other scheme (`javascript:`, `data:`, `vbscript:`) or incomplete URL is rejected.
- **No secrets or new permissions**: No new secrets, tokens, or browser API permissions are introduced. Existing session tokens continue flowing exclusively through `SessionManager`/`StorageManager` and are never logged or attached to message events (Constitution VII).
- **Server-side authorization**: Session and conversation isolation (`client_id`/`channel_uuid`) is enforced server-side by `weni-webchat-socket` on the registered WebSocket session and by `flows` on `POST /api/v2/internals/messages/stream`; this client library never renders or receives frames from another shopper's conversation.

## Test Strategy

The inherited Product Spec defines four QA-validated success criteria (`SC-001` through `SC-004`, `BD-011`). Automated unit and flow tests in `@weni/webchat-service` prove every transport, normalization, persistence, and lifecycle invariant this repository owns in support of those criteria:

| Success / acceptance criterion | How this repository proves it |
|--------------------------------|-------------------------------|
| `SC-001`: First content of a component response appears early during streaming without waiting for full component completion (`FR-001`..`FR-003`, `FR-008`, `FR-028`) | `tests/MessageProcessor.test.js` & `tests/service.events.test.js`: flow tests using `socket-stream-frames.schema.json` examples verify that `stream_start` + early `stream_component_hint` immediately stops thinking and emits `message:received` (`status: 'streaming'`, `streamPhase: 'streaming_text'`, camelCase `componentHints`), subsequent `{ v, seq }` deltas stream `text` via `message:updated` without re-emitting a duplicate bubble, mid-stream hints emit `message:updated` with `componentHints`, textless component responses emit on hint arrival (`FR-028`), and text-only streams emit zero `componentHints`. |
| `SC-002`: No component is clickable before the response is complete and entrance finishes (`FR-001`, `FR-009`, `FR-018`, `FR-021`, `BD-004`) | `src/utils/tests/streamComponents.test.ts` & `tests/MessageProcessor.test.js`: proves `stream_component_hint` strips any accidental `url` field and never attaches real `cta_message`/`list_message`/`quick_replies`; proves `stream_text_end` transitions `streamPhase` to `'awaiting_components'` while keeping `status: 'streaming'` and `componentHints` intact until delayed `stream_component` / `stream_end`; proves partial or non-`http(s)` CTA URLs are rejected and never emitted; proves `stream_end` emits `status: 'delivered'`, `streamPhase: 'completed'`, and clears `componentHints`. |
| `SC-003`: When hints include labels, hint metadata reaches the widget intact so skeletons match final button dimensions (`FR-004`..`FR-006`, `FR-019`, `FR-020`, `AD-006`) | `src/utils/tests/streamComponents.test.ts` & `tests/MessageProcessor.test.js`: proves `stream_component_hint` preserves ordered `labels`, `count`, and list `item_count` → `itemCount` accurately (and omits `labels` when absent, omits `itemCount` on non-list hints), upserts idempotently by `(id, componentType)`, and allows authoritative `stream_end` components (including multi-component bundles `list_message` + `cta_message` + `quick_replies` or differing counts/labels) to override hints cleanly. |
| `SC-004`: When all content is received, completion reaches the widget immediately with authoritative components and zero extra queue delay (`FR-013`, `FR-014`, `NFR-002`, `BD-007`, `BD-008`) | `tests/MessageProcessor.test.js`, `tests/HistoryManager.test.js`, `tests/SessionManager.test.js`, & `tests/service.events.test.js`: proves `stream_end` synchronously emits `message:updated` with `status: 'delivered'`, `streamPhase: 'completed'`, `componentHints` omitted from `StateManager`, and all validated components (`quick_replies`, `list_message` with optional `item_count`, `cta_message`); proves no-hint streams (`BD-008`) emit delivered components on `stream_end` (both with and without prior deltas); proves `SessionManager` never persists `componentHints`/`streamPhase`/`status: 'streaming'` and `HistoryManager.processHistory` restores `cta_message`, `list_message` (`item_count`), and `quick_replies` with `streamPhase === undefined` and `componentHints === undefined` (`FR-029`, `FR-034`). |

**Flow coverage**:

- Complete early-hint quick-reply stream (`stream_start` → `stream_component_hint` → `delta`s → `stream_end`) through `WeniWebchatService` (`message:received`, `message:updated`, `state:changed`, `SessionManager` persistence).
- Delayed CTA URL stream (`stream_start` → `stream_component_hint` → `delta`s → `stream_text_end` (`awaiting_components`) → `stream_component` (CTA with valid `https://` URL) → `stream_end` (`completed`)).
- Multi-component stream (`list_message` with `item_count` + `cta_message` + `quick_replies`) verifying fixed preservation of all three components and `item_count` omitted when absent (`AD-006`).
- Mid-stream hint (after delta 2), hint without `labels`, no-hint fallback (`BD-008`), textless component response (`FR-028`), and `stream_start` → `stream_end` without deltas or hints.
- Continuity flow: `SessionManager` save/restore strips `componentHints`, `streamPhase`, and `status: 'streaming'`; `HistoryManager.processHistory` + `merge` restores `cta_message` and `list_message.item_count` with no transient fields; `simulateMessageReceived` replays full `socket-stream-frames.schema.json` sequences end to end.

**Failure paths covered**:

- WebSocket `disconnected` and `closed` mid-stream: `handleConnectionLost()` emits `message:updated` with `status: 'delivered'`, `streamPhase: 'completed'`, `componentHints: undefined`, preserves partial text, stops thinking/typing, and cleans up `streams` (`FR-012`); unemitted stream (`stream_start` only) cleans up silently without creating an empty bubble.
- Hinted component never delivered in `stream_end`: `componentHints` cleared, text preserved, no error emitted (`FR-012`).
- Malformed `stream_component_hint` (missing `id`, unknown `component_type`, non-object) and accidental `url` property on a hint: invalid hint discarded with PII-free `console.warn`, accidental `url` stripped, text stream unaffected.
- Malformed `stream_component` / `stream_end` component / history `cta_message` (partial URL `"https://"`, `javascript:alert(1)`, missing `display_text`, empty `list_items`, empty `quick_replies`): discarded with PII-free `console.warn` (asserting warning arguments never contain input text, labels, or URLs), sibling valid components and text still delivered.
- Duplicate `stream_component_hint` / `stream_component` for same `(id, componentType)` replaces idempotently without duplicating entries.
- Late `stream_component_hint` / `stream_component` / `stream_text_end` after `stream_end` or disconnect is ignored without creating a duplicate bubble.
- Leaked JSON object string in `stream_text_end.content` or `stream_end.content` falls back to accumulated text (or ignores unemitted `stream_end` with no valid components).

**Stubbed at the boundary**:

- WebSocket transport via the existing `WebSocketManager` EventEmitter mock (`tests/_helpers/serviceMocks.js`, `tests/HistoryManager.test.js`).
- Browser `localStorage` / `sessionStorage` via Jest's `jsdom` environment and `StorageManager` mocks.
- `console.warn` via `jest.spyOn(console, 'warn')` to verify structured PII-free warnings.
- Jest fake timers (`jest.useFakeTimers()`) for typing/thinking timeouts. Zero live WebSocket or network calls.

## Rollout and Rollback

Following the Architecture Document *Delivery Sequence*:

1. **Step 1 (`flows` and `weni-webchat-socket`)**: can deploy in parallel with or before `@weni/webchat-service` (all wire additions are backward compatible).
2. **Step 2 (`@weni/webchat-service` `1.22.0` MINOR release)**: merge PR with updated `CHANGELOG.md`, `README.md`, and `src/types/index.d.ts`; tag `1.22.0` (`npm version minor -m "chore: release %s"`) so `npm-publish.yaml` publishes `@weni/webchat-service@1.22.0` to npm.
3. **Step 3 (`webchat-react`)**: [webchat-react#177](https://github.com/weni-ai/webchat-react/pull/177) bumps its `@weni/webchat-service` dependency to `1.22.0`, waits for Crowdin `pt.json`/`es.json` translations (`NFR-005`), and ships the widget bundle.
4. **Step 4 (QA)**: QA executes baseline and post-change validation of `SC-001`–`SC-004` in staging across all layouts and locales (`BD-011`).
5. **Step 5 (`nexus-ai`)**: enables gRPC component streaming globally for `use_components=True` Shopping Assistant channels (`BD-010`).

**Rollback**:

- No feature flag is required in `@weni/webchat-service`; `nexus-ai` is the single global activation/rollback switch (rolling back `nexus-ai` returns traffic to `/whatsapp_broadcasts` with zero impact on `1.22.0`).
- Consumers can also pin back to `@weni/webchat-service@1.21.0` independently at any time: sessions stored by `1.22.0` contain no transient streaming fields (`componentHints`/`streamPhase`) and stay 100% compatible with `1.21.0` (and `1.21.0` ignores unknown WebSocket frames via `MESSAGE_UNKNOWN` without throwing).

## Constitution Alignment

| Principle | How this spec complies | Exception + justification |
|-----------|------------------------|---------------------------|
| I. Version Control and Review | Delivered via PR to `main` passing `npm run lint`, `npm run typecheck`, `npm test` (Jest >=80% coverage gate), and peer review. | none |
| II. Specification Traceability | Opens with `## Inheritance from Product Spec` in exact constitution format, pinning `019-sa-components-streaming-v1` (commit `e0f8e7ec9b5645681534645dc182a070b2d38e15`) and `019-sa-components-streaming/arch-v1` (commit `148d5ee704f49fb3cf47df26df20d3ac124cd3b8`), explicitly naming the `weni-webchat-socket → @weni/webchat-service → webchat-react` slice. | none |
| III. No Silent Divergence | All requirements align with `BD-001`..`BD-011` and `AD-002`, `AD-005`, `AD-006`; `Divergences: none`. | none |
| IV. Versioned Public Contracts | All changes to `Message`, `src/types/index.d.ts`, `constants.js`, and consumed WebSocket frames are strictly additive and backward compatible; ships as MINOR `1.22.0`. | Legacy component fields (`quick_replies`, `list_message`, `cta_message`, `item_count`) remain `snake_case` per `AD-005` and Constitution IV/XIV to avoid a breaking change for consumers. |
| V. Release & Changelog Maintenance | `CHANGELOG.md` updated under `Added` / `Fixed` in the same PR; `README.md` updated; release requires MINOR npm publish (`1.22.0`) and `webchat-react` dependency bump, documented in Rollout. | none |
| VI. Commit Messages | Atomic Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore: release 1.22.0`) <=50 chars. | none |
| VII. Security & Secrets | No secrets or new runtime dependencies added; CTA URLs validated to strict `http(s)` with non-empty hostname; hints never carry URLs; tokens untouched. | none |
| VIII. Observability | Structured `console.warn` with module prefix (`MessageProcessor:` / `HistoryManager:`), operation, `messageId` correlation, `componentType`, and `reason`; zero PII/content/URLs logged. | none |
| IX. Code as Documentation | All new code, JSDoc/TSDoc, and comments written in English explaining invariants (why `componentHints` persist across `stream_component` until `stream_end`, why storage strips transient fields without mutating live references). | none |
| X. Type Safety | New module `src/utils/streamComponents.ts` and its colocated test `src/utils/tests/streamComponents.test.ts` are strict TypeScript with explicit types and zero `any`; `src/types/index.d.ts` updated in the same PR; Rollup/Babel/Jest/ESLint TS toolchain already configured (`jest.config.js` adds `!src/**/*.test.ts` coverage exclusion). | none |
| XI. Single Responsibility | Boundary validation, normalization, hint upsert, and storage sanitization are extracted to focused `src/utils/streamComponents.ts` (<350 lines). | `src/core/MessageProcessor.js` (880 lines) and `src/index.js` (1462 lines) already exceed 500 lines (acknowledged in Constitution XI). Only thin orchestration/wiring is added there; all validation/normalization logic lives in `src/utils/streamComponents.ts`. |
| XII. Naming Conventions | `camelCase` for functions, variables, and new emitted fields (`componentHints`, `componentType`, `itemCount`, `streamPhase`); lowercase filename `streamComponents.ts` (multi-export utility module); `UPPER_SNAKE_CASE` constant maps (`STREAM_PHASES`, `COMPONENT_TYPES`). | none |
| XIII. Module & Public API Architecture | `src/index.js` remains a thin facade (wiring `handleConnectionLost()` and exporting constants); stream orchestration stays in `MessageProcessor`, history parsing in `HistoryManager`, storage sanitization in `SessionManager`, and pure normalization in `src/utils/streamComponents.ts`. | none |
| XIV. WebSocket Contract & Data Boundaries | All incoming streaming component frames and history CTA payloads are validated and normalized at the boundary; new emitted fields use `camelCase`; existing `snake_case` component fields preserved per `AD-005` / Constitution IV. | none |
| XV. State Management & Async Correctness | `StateManager` remains the single source of truth for live message streaming state; `SessionManager` owns persisted storage without transient streaming state; disconnect/close finalization prevents stuck `streaming` states; `stream_component_hint` / `stream_component` are idempotent. | none |
| XVI. Resilience & Error Handling | Malformed frames are treated as permanent contract errors (discarded with structured warning, never retried, never crashing text delivery); disconnects cleanly finalize active streams without silent hangs. | none |
| Testing | Colocated TypeScript unit tests in `src/utils/tests/streamComponents.test.ts` plus updated flow/regression tests in existing `tests/*.test.js` covering happy paths, edge cases, and failure paths with >=80% coverage and zero live network calls. | Existing legacy test suites (`tests/MessageProcessor.test.js`, `tests/HistoryManager.test.js`, etc.) are extended in place because those JS modules receive targeted changes rather than full rewrites. |
| Performance & Maintainability | Zero new runtime dependencies, O(k) validation per frame, bounded `completedStreamIds` (20), and single centralized module `src/utils/streamComponents.ts` shared by `MessageProcessor`, `HistoryManager`, and `SessionManager`. | none |

## Implementation Decisions

- **New TypeScript helper module `src/utils/streamComponents.ts`**: Centralizing all component schema validation, camelCase hint normalization, CTA URL checking, hint idempotency, and transient-field stripping into one strict TypeScript module satisfies Constitution X and XI, prevents drift between `MessageProcessor`, `HistoryManager`, and `SessionManager`, and keeps `MessageProcessor.js` focused on stream state transitions.
- **Keep `componentHints` populated across `stream_component` until `stream_end` or disconnect**: Verified directly against `useComponentStreamLifecycle.ts` in [webchat-react#177](https://github.com/weni-ai/webchat-react/pull/177), which derives `pendingHintedTypes` by filtering `componentHints` against delivered components. Keeping `componentHints` until `stream_end` (or disconnect) ensures multi-component responses hold remaining skeletons while waiting for a delayed sibling (e.g., CTA URL) and cleanly dismiss all skeletons on completion.
- **Emit `componentHints: undefined` on `message:updated` while omitting the key in `StateManager`**: `AD-005` specifies emitting `componentHints=undefined` in the `message:updated` delta payload, while `webchat-service-message.schema.json` specifies `componentHints` is omitted on completed messages. Deleting `componentHints` inside `StateManager.updateMessage` when `updates.componentHints === undefined` satisfies both contracts simultaneously.
- **Non-mutating storage sanitization in `SessionManager._save()`**: Because `SessionManager.appendToConversation` stores the same message object reference that lives in `StateManager`, `_save()` maps each message through `stripTransientStreamingFields` onto a shallow copy (stripping `componentHints` and `streamPhase`, and normalizing persisted `status: 'streaming'` to `'delivered'`) without mutating the active in-memory message.
- **Track `emitted` per stream entry and bounded `completedStreamIds` (20)**: Tracking `emitted` fixes the edge case where `stream_start` is followed directly by `stream_end` (or `stream_text_end` / `stream_component`) without a prior `delta` (`FR-028`, `BD-008`), ensuring the message is added via `MESSAGE_PROCESSED` instead of firing an orphaned `MESSAGE_UPDATED`. Bounded `completedStreamIds` prevents late post-completion frames from opening duplicate empty bubbles.
- **Whitelist contract fields while tolerating simulator envelope metadata**: `normalizeComponentHint` and `normalizeStreamComponent` read only contract-defined keys (never forwarding unknown fields such as an accidental `url` on a hint), while ignoring transport/simulator envelope keys like `persisted: true` injected by `WeniWebchatService.simulateMessageReceived()`.
- **Gate typing/rationale indicators on `streamMessageEmitted`**: Once an early `stream_component_hint` opens the assistant bubble with a skeleton before the first text `delta`, subsequent `typing_start` or `stream_rationale` frames are ignored so the thinking indicator does not reappear over an already-visible streaming bubble.

## Divergences

none

