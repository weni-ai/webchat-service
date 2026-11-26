# Engineering Specification: Visible Human Support Status in Shopping Assistant

**Repository**: `@weni/webchat-service` — frontend

**Feature Branch**: `005-human-support-status`

**Created**: 2026-11-26

**Status**: Draft

## Inheritance from Product Spec

- Product Spec: Atendimento humano visível no Shopping Assistant (tag, marcos, horário, status de leitura e nome do atendente) — https://github.com/weni-ai/vtex-cx-experience-specs/blob/5dbf6b398115c695326e59d65ce7113a8acaa97d/specs/009-sa-human-support-status/spec.md
- Pinned version: commit `5dbf6b398115c695326e59d65ce7113a8acaa97d` (2026-11-24 Live Desk read-confirmation amendment, merged on `main`; no tag exists yet, so the pin is the commit SHA, the same one pinned by [webchat-react#179](https://github.com/weni-ai/webchat-react/pull/179))
- Architecture doc: https://github.com/weni-ai/vtex-cx-experience-specs/blob/4f2c4b4906e7a53c53bdbb89dd75a0cedb492b27/specs/009-sa-human-support-status/architecture.md — commit `4f2c4b4906e7a53c53bdbb89dd75a0cedb492b27` (merged via [vtex-cx-experience-specs#36](https://github.com/weni-ai/vtex-cx-experience-specs/pull/36); tag `009-sa-human-support-status/arch-v1` pending approval)
- Inherited binding decisions: `BD-001`–`BD-009`; Architecture `AD-001`–`AD-007` and `AD-009` (`binding`) and `AD-008` (`guidance`, followed as written); contracts `human-support-shared.schema.json`, `messages/socket-frames.schema.json` and `messages/webchat-service-message.schema.json` at version 1.0.0 (pinned at the architecture commit)
- Scope of this spec: the `weni-webchat-socket` ↔ `@weni/webchat-service` ↔ `webchat-react` slice — declaring the fixed `register.data.features.humanSupportStatus` capability, sending a validated `message.id` on every shopper message, consuming `message_saved`, `message_status`, `human_support_event`, `human_support_state` and the extended `message`, `typing_start`, `ready_for_message` and `history` payloads, normalizing them at the boundary to camelCase (`author`, `orderKey`, `humanSupportEvent`, `occurredAt`, `typingAuthor`, `humanSupport`, `features.humanSupportStatus`), ordering items by server `orderKey`, enforcing monotonic shopper statuses, deriving and confirming `state.humanSupport.active`, expiring `state.typingAuthor` after 10 s, emitting `human_support:changed`, and shipping the MINOR release `1.23.0`
- Divergences: none

## Scope in This Repository

**This repository implements**:

- **Capability declaration**: `WebSocketManager.register()` always sends `data.features.humanSupportStatus: true` next to the existing `voiceMode` flag. It is never read from the widget configuration (`BD-005`, `AD-008` item 2).
- **Feature gate per connection**: `ready_for_message.data.human_support_enabled === true` becomes `state.features.humanSupportStatus`; absent means `false` (`AD-008` item 3).
- **Shopper message id**: every outgoing `text`, media (`image`, `video`, `audio`, `file`) and `order` message sends its local id as `message.id` on `message` and `message_with_fields` frames, after validation against `^[A-Za-z0-9_-]{1,64}$`. An invalid id is omitted, never sent (`AD-003` items 1–2).
- **Boundary normalization** in new TypeScript modules for:
  - author, milestone, `order_key`, `message_saved`, `message_status`, `human_support_state` and `typing_start` author payloads;
  - history items, including milestone items (`message.type = 'human_support_event'`), `message.id`, `author`, `status` and `order_key`.
- **Server ordering**: `state.messages`, history merges and the persisted session conversation are ordered by `orderKey`. Items without `orderKey` fall back to `timestamp` in ms (history) or arrival order (live). Local `pending`/`error`/awaiting-save shopper messages stay at the end in local order (`AD-002` item 4).
- **Monotonic shopper statuses** (`sent` < `delivered` < `read`) from `message_saved`, `message_status` and history. `pending`/`error` stay local. While `humanSupport.active` is true, `pending` is kept until `message_saved`; in AI mode the clock is cleared on local send. Status is never derived from milestone positions (`AD-003` items 6–7).
- **Human support state**:
  - deduplicates milestones by `eventId`;
  - deduces `state.humanSupport.active` from the latest milestone in `ready_for_message.data.history`;
  - sends `get_human_support_state` once per (re)connection and applies `human_support_state.active` when present;
  - keeps the deduced value, with no error event, when `active` is absent or the request times out (`AD-002` item 5, `FR-035`, `FR-045`, `FR-046`).
- **Typing author**: `state.typingAuthor` (`{ type: 'human_agent', name?: string } | null`) and `isTyping` are driven by `typing_start` heartbeats with `from: 'human_agent'`. A dedicated 10-second expiry timer is renewed per heartbeat. The indicator is cleared when a message from that agent arrives, when an `ended` milestone arrives, or on disconnect (`AD-004`, `NFR-002`). The optimistic "typing after send" indicator is suppressed while human support is active (`FR-031`, `FR-045`).
- **Events**: new `human_support:changed` (payload `state.humanSupport`), alongside the existing `state:changed`, `message:received`, `message:updated` and `history:loaded`.
- **Release**: `src/types/index.d.ts`, `src/utils/constants.js`, named exports, `README.md` and `CHANGELOG.md` for MINOR `1.23.0`.

**Out of scope here**:

- `chats-engine` and the Live Desk front-end (Engage):
  - `typing.start`, `msg.read`, `room.update` on every close path;
  - the read-confirmation setting and its eligibility rule (`AD-009`). This service only applies whatever `read` statuses reach it; the setting state never reaches the browser (`FR-051`).
- `mailroom` (Engine): milestone emission, `delivered`, `author` with HMAC id (`AD-002`, `AD-003`, `AD-005`).
- `courier`: new actions, `author` forwarding, `message.id` → `external_id` (`AD-001`, `AD-006`).
- `weni-webchat-socket`:
  - persistence and `order_key` assignment;
  - the decision of whether a shopper message belongs to human support (`AD-003` item 7);
  - the channel allowlist (`AD-007`);
  - stripping new fields for widgets without the capability (`AD-008` item 1);
  - the 2 s Flows timeout behind `get_human_support_state`.
- `webchat-react` ([webchat-react#179](https://github.com/weni-ai/webchat-react/pull/179), spec `016-human-support-status`):
  - header tag, milestone badges, time formatting and author/minute grouping (`FR-010`–`FR-016`);
  - status icons and accessibility labels, agent name rendering and ellipsis;
  - `"[name] está digitando"` copy, hiding the AI "thinking" indicator during human support (`FR-033`);
  - scroll and focus stability (`FR-038`, `FR-039`), screen-reader announcements (`NFR-004`), i18n strings.
- WhatsApp and every non-WWC channel (`BD-001`).

**Depends on**:

- `weni-webchat-socket` emitting and accepting frames as defined in [`socket-frames.schema.json`](https://github.com/weni-ai/vtex-cx-experience-specs/blob/4f2c4b4906e7a53c53bdbb89dd75a0cedb492b27/specs/009-sa-human-support-status/contracts/messages/socket-frames.schema.json) and [`human-support-shared.schema.json`](https://github.com/weni-ai/vtex-cx-experience-specs/blob/4f2c4b4906e7a53c53bdbb89dd75a0cedb492b27/specs/009-sa-human-support-status/contracts/human-support-shared.schema.json):
  - `ready_for_message.data.human_support_enabled` and `data.history` (already sent today with the last 20 items, `pkg/websocket/client.go` `Register`);
  - `message_saved`, `message_status`, `human_support_event` and `human_support_state`;
  - `order_key` on `message`, `human_support_event`, `message_saved` and history items;
  - `author` on `message`, `typing_start` and history items.
- `webchat-react` consuming [`webchat-service-message.schema.json`](https://github.com/weni-ai/vtex-cx-experience-specs/blob/4f2c4b4906e7a53c53bdbb89dd75a0cedb492b27/specs/009-sa-human-support-status/contracts/messages/webchat-service-message.schema.json) through `state:changed` (`features`, `humanSupport`, `typingAuthor`, ordered `messages`), `message:received`, `message:updated`, `history:loaded` and `human_support:changed`. Its mock (`test/__mocks__/@weni/webchat-service.js` in [webchat-react#179](https://github.com/weni-ai/webchat-react/pull/179)) assumes these initial values: `features: { humanSupportStatus: false }`, `humanSupport: { active: false }`, `typingAuthor: null`; milestone ids `hs_<eventId>`; and `MESSAGE_TYPES.HUMAN_SUPPORT_EVENT`.
- Development and tests in this repository use the schema `examples` as fixtures. There is no build-time dependency on the socket being deployed first.

## Current State

- `src/core/WebSocketManager.js` (876 lines):
  - `register()` builds the frame through `buildRegistrationMessage` with `data.features = { voiceMode }` only.
  - `_handleReadyForMessage(data)` reads only `data.data?.voice_enabled` and drops `data.data.history`.
  - `_handleMessage` intercepts transport-level frames (`voice_tokens`, `utm_sent`, `cart_updated`, `error`, …) and forwards every other frame as `SERVICE_EVENTS.MESSAGE`.
  - Server `error` frames are generic (`{ type: 'error', error }`, no message id, per `weni-webchat-socket` `Client.Redirect`). They are emitted as `SERVICE_EVENTS.ERROR`.
- `src/core/MessageProcessor.js` (1235 lines):
  - `process()` routes `message`, `stream_*`, `delta`, `typing_start` and `ack`. Anything else (including `message_saved`, `message_status`, `human_support_event`) becomes `SERVICE_EVENTS.MESSAGE_UNKNOWN`.
  - `_normalizeMessage()` sets `timestamp: raw.timestamp || Date.now()` (browser clock) and ignores `message.author` and `order_key`.
  - `_handleTypingIndicator()` treats every `from` other than `ai-assistant` as anonymous typing, with one shared `typingTimer` (`typingTimeout`, default 50 s) for typing and thinking.
  - `startTypingOnMessageSent()` shows typing 2 s after every shopper send.
- `src/utils/messageBuilder.js`:
  - `buildTextMessage`, `buildMediaMessage` and `buildOrderMessage` already assign a local `id` via `generateMessageId()` (`src/utils/helpers.js`, `msg_<ms>_<base36>`, which already matches `^[A-Za-z0-9_-]{1,64}$`).
  - `buildMessagePayload()` never puts that id on the wire.
- `src/index.js` (1470 lines):
  - The `MESSAGE_SENT` listener sets `status: 'sent'` on local send and calls `startTypingOnMessageSent()`.
  - `init()` re-enqueues every stored message with `status === 'pending'`.
  - `_handleWebSocketConnected()` loads history page 1, then removes local `msg_*` messages (incoming non-persisted, and outgoing `sent`). The assumption is that history copies replace them under different (MongoDB `ID`) ids.
  - The `MESSAGE_PROCESSED` handler appends with `state.addMessage` and `session.appendToConversation`.
- `src/core/StateManager.js` (249 lines):
  - `addMessage()` appends.
  - `updateMessage()` shallow-merges and only deletes `componentHints` when it is set to `undefined`.
  - The state has no `features`, `humanSupport` or `typingAuthor`.
- `src/modules/HistoryManager.js` (379 lines):
  - `processHistory()` maps `item.ID` to `id` for every item, uses `item.timestamp * 1e3`, and ignores `order_key`, `author`, `status`, `message.id` and milestone items.
  - `merge()` keeps the cached copy over the history copy, backfilling only `customData` and `cta_message`, then sorts by `timestamp`.
- `src/core/SessionManager.js` (469 lines):
  - `appendToConversation()` appends, `updateConversation()` merges in place (deleting only `componentHints: undefined`), and `_save()` persists the conversation minus ephemeral media and transient streaming fields.
- `src/types/index.d.ts` (677 lines): `Message` has no `author`, `orderKey` or `humanSupportEvent`. `MessageType` has no `'human_support_event'`. `ChatState` has no `features`, `humanSupport` or `typingAuthor`.
- `src/utils/constants.js`: no `human_support:changed` event, no `MESSAGE_TYPES.HUMAN_SUPPORT_EVENT`, no human-support frame types or timeouts.
- **Nearest analogous feature**: `004-components-streaming`. It used a TypeScript boundary module (`src/utils/streamComponents.ts`), thin routing in `MessageProcessor`, `undefined`-key deletion in `StateManager`/`SessionManager`, and colocated TS tests (`src/utils/tests/streamComponents.test.ts`). Voice mode is the precedent for `register.data.features` and the `ready_for_message` flag.
- **Test seams**:
  - Socket and browser mocks in `tests/_helpers/serviceMocks.js`.
  - `tests/WebSocketManager.test.js`, `tests/MessageProcessor.test.js`, `tests/HistoryManager.test.js`, `tests/StateManager.test.js`, `tests/SessionManager.test.js`, `tests/messageBuilder.test.js`, `tests/service.sendPaths.test.js`, `tests/service.events.test.js` and `tests/service.simulators.test.js`.

## Technical Approach

### Components Affected

| Component | Change | Why |
|-----------|--------|-----|
| `src/utils/humanSupportWire.ts` | new | Strict-TS boundary validators and normalizers (Constitution X, XIV): `isValidClientMessageId`, `normalizeAuthor`, `normalizeOrderKey`, `normalizeHumanSupportEvent` (wire `snake_case` + RFC 3339 → `{ eventId, event, occurredAt: ms }`), `buildMilestoneMessage`, `normalizeMessageSavedFrame`, `normalizeMessageStatusFrame`, `readHumanSupportStateActive`, `toTypingAuthor`, `unixSecondsToMs`, and the PII-free `warnHumanSupportContract` helper. Owns `MESSAGE_AUTHOR_TYPES`, `HUMAN_SUPPORT_EVENTS` and `MILESTONE_ID_PREFIX`, re-exported by `constants.js`. Whitelists contract keys only. |
| `src/utils/humanSupportHistory.ts` | new | History-side helpers: `buildHistoryMilestone`, `readHistoryHumanSupportFields`, `findLatestMilestone` (deduction), and `mergeServerOwnedFields` (merge precedence). |
| `src/utils/messageStatus.ts` | new | Single source of the status rank (`pending`/`error`/`streaming`/absent = 0, `sent` = 1, `delivered` = 2, `read` = 3) and `resolveForwardStatus(current, next)`. Shared by the tracker and `HistoryManager.merge` (Constitution Maintainability). |
| `src/utils/messageOrdering.ts` | new | `isLocalTail`, `getSortKey`, `sortMessages` (history merge), `insertMessage` (live insert) and `repositionMessage` (after `message_saved`), implementing `AD-002` item 4 (see *Ordering rules*). |
| `src/modules/HumanSupportTracker.ts` | new | `EventEmitter` class and the facade's single entry point. It owns the feature gate, history deduction, `get_human_support_state` confirmation with an epoch guard, and live milestone application and dedupe. It writes `features`/`humanSupport` through `StateManager` setters and emits message updates for the facade to apply. |
| `src/modules/ShopperMessageStatus.ts` | new | Computes shopper status changes: local-send decision, `message_saved`, `message_status`, and reconnect reconciliation. Returns `MessageUpdate[]`; never mutates state. |
| `src/modules/HumanAgentTyping.ts` | new | Agent typing indicator with its own 10 s heartbeat timer, the internal agent id used for matching, and `typingAuthor`/`isTyping` updates. |
| `src/modules/humanSupportTypes.ts` | new | Shared types: state and transport ports, `TrackedMessage`, `MessageUpdate`. Lets the TS modules depend on `StateManager`/`WebSocketManager` without importing JS (`allowJs: false`). |
| `src/utils/helpers.js` | modified | `mergeMessageUpdates()`: single source of the clearable fields (`componentHints`, `status`, `__awaitingSave`) used by `StateManager` and `SessionManager`. |
| `src/core/WebSocketManager.js` | modified | `register()` adds `humanSupportStatus: true`. `_handleReadyForMessage()` emits `INTERNAL_EVENTS.READY_FOR_MESSAGE` with `data.data` before `CONNECTION_STATUS_CHANGED('connected')`. New `requestHumanSupportState(timeoutMs)` sends `get_human_support_state` and resolves on `human_support_state`, intercepted in `_handleMessage` like `voice_tokens`. |
| `src/core/MessageProcessor.js` | modified | Thin routing only (Constitution XI):<br>• `human_support_event` → `buildMilestoneMessage` → existing queue.<br>• `message_saved` / `message_status` → `INTERNAL_EVENTS.MESSAGE_SAVED` / `MESSAGE_STATUS`.<br>• `typing_start` with `from: 'human_agent'` → `INTERNAL_EVENTS.HUMAN_AGENT_TYPING` while `humanSupportEnabled`; legacy path otherwise.<br>• `_normalizeMessage()` adds `author` and `orderKey` (and server `timestamp` for keyed frames). |
| `src/modules/HistoryManager.js` | modified | `processHistory()`:<br>• milestone items → `buildMilestoneMessage`;<br>• outgoing items use a valid `message.id` as `id`;<br>• adds `author`, `orderKey` and shopper `status`.<br>`merge()`:<br>• history wins for `orderKey`, `author`, `humanSupportEvent`;<br>• status via `resolveForwardStatus`;<br>• clears `__awaitingSave`;<br>• sorts with `sortMessages`. |
| `src/core/StateManager.js` | modified | Initial and `reset()` state gain `features: { humanSupportStatus: false }`, `humanSupport: { active: false }` and `typingAuthor: null`, with setters `setFeatures`, `setHumanSupport` and `setTypingAuthor`. `addMessage()` uses `insertMessage`. `updateMessage()` repositions on an `orderKey` change and deletes `status`/`__awaitingSave` keys set to `undefined` (like `componentHints`). New `updateMessages(updatesById)` applies a batch with one `setState`. |
| `src/core/SessionManager.js` | modified | `updateConversation()` deletes `status`/`__awaitingSave` keys set to `undefined`. The facade mirrors state order with `setConversation(state.getMessages())` whenever an insert or reposition is not an append, so reloads restore the displayed order (`FR-034`). |
| `src/utils/messageBuilder.js` | modified | `buildMessagePayload()` adds `id` to the wire `message` for `text`, media and `order` when `isValidClientMessageId(outbound.id)`. `set_custom_field` is unchanged. |
| `src/index.js` | modified | Wiring only:<br>• instantiate the tracker;<br>• decorate outgoing messages in `sendMessage` / `sendAttachment` / `sendAudio` / `sendOrder`;<br>• delegate local-send status in `MESSAGE_SENT` and skip `startTypingOnMessageSent()` while active;<br>• `acceptProcessedMessage()` gate in `MESSAGE_PROCESSED`;<br>• forward `human_support:changed`;<br>• exclude `__awaitingSave` from the `init()` re-enqueue;<br>• fix the `_handleWebSocketConnected()` removal to keep ids present in the history response;<br>• call reconcile;<br>• export new constants. |
| `src/utils/constants.js` | modified | Adds:<br>• `SERVICE_EVENTS.HUMAN_SUPPORT_CHANGED: 'human_support:changed'`;<br>• `MESSAGE_TYPES.HUMAN_SUPPORT_EVENT`;<br>• `MESSAGE_AUTHOR_TYPES`, `HUMAN_SUPPORT_EVENTS`;<br>• `WS_MESSAGE_TYPES` entries (`READY_FOR_MESSAGE`, `GET_HUMAN_SUPPORT_STATE`, `HUMAN_SUPPORT_STATE`, `HUMAN_SUPPORT_EVENT`, `MESSAGE_SAVED`, `MESSAGE_STATUS`);<br>• `DEFAULTS.HUMAN_AGENT_TYPING_TIMEOUT: 10000`, `DEFAULTS.HUMAN_SUPPORT_STATE_TIMEOUT: 10000`;<br>• `MILESTONE_ID_PREFIX: 'hs_'`;<br>• a non-exported `INTERNAL_EVENTS` map. |
| `src/types/index.d.ts` | modified | Adds:<br>• `MessageAuthor`, `HumanSupportEvent`, `HumanSupportState`, `TypingAuthor`, `ServiceFeatures`;<br>• `Message.author` / `orderKey` / `humanSupportEvent`;<br>• `MessageType` `'human_support_event'`;<br>• `ChatState.features` / `humanSupport` / `typingAuthor`;<br>• wire frame interfaces;<br>• `ServiceConfig` untouched;<br>• declarations for new constants. |
| `src/utils/tests/humanSupportWire.test.ts`, `src/utils/tests/humanSupportHistory.test.ts`, `src/utils/tests/messageStatus.test.ts`, `src/utils/tests/messageOrdering.test.ts`, `src/modules/tests/HumanSupportTracker.test.ts` | new | Colocated TS unit tests (Constitution Testing, X). |
| `tests/service.humanSupport.test.ts` | new | End-to-end facade flow tests. They live in `tests/`, as `tests/service.backInStock.test.ts` does, because they import the JS facade, which `tsc` cannot type under `allowJs: false` inside `src/`. |
| `tests/WebSocketManager.test.js`, `tests/MessageProcessor.test.js`, `tests/HistoryManager.test.js`, `tests/StateManager.test.js`, `tests/SessionManager.test.js`, `tests/messageBuilder.test.js`, `tests/service.sendPaths.test.js`, `tests/service.simulators.test.js` | modified | Regression coverage for the changed behavior of these legacy JS modules. |
| `package.json`, `CHANGELOG.md`, `README.md` | modified | `1.23.0`. Changelog entries under `Added`/`Changed`/`Fixed`. README documents the new state fields, event, `Message` fields, ordering and the AI-mode status semantics on enabled channels. |

### Flow

#### 1. Connection, capability and human support state (`AD-002` item 5, `AD-008`)

1. `connect()` → `WebSocketManager.register()` sends `{ type: 'register', …, data: { features: { voiceMode, humanSupportStatus: true } } }`.
2. On `ready_for_message`, `WebSocketManager._handleReadyForMessage(data)` sets `status = 'connected'` and then emits `INTERNAL_EVENTS.READY_FOR_MESSAGE` with `data.data`. It does this **before** `CONNECTION_STATUS_CHANGED('connected')`, so the feature gate is known when the facade runs `runQueue()`.
3. `HumanSupportTracker.handleReady(readyData)`:
   - Increments `connectionEpoch` and calls `state.setFeatures({ humanSupportStatus: readyData?.human_support_enabled === true })`. It also sets `messageProcessor.humanSupportEnabled`.
   - **Feature OFF**: sets `humanSupport = { active: false }` (emitting `human_support:changed` only when the value changes), clears the typing author, and stops. Behavior is then identical to `1.22.0`, except that `message.id` is sent on the wire.
   - **Feature ON, deduction**: `findLatestMilestone(readyData.history)` normalizes only milestone items and picks the one with the highest `order_key`, falling back to `timestamp` and then to history order.
     - If one exists: `active = event === 'started'`, and `lastAppliedMilestoneKey` is recorded.
     - If none exists (an ambiguous page): the in-memory value is kept (`false` after a reload).
   - **Feature ON, confirmation**: calls `websocket.requestHumanSupportState(DEFAULTS.HUMAN_SUPPORT_STATE_TIMEOUT)` and records `{ epoch, liveMilestoneSeqAtRequest }`. On resolve:
     - The answer is applied only if `epoch === connectionEpoch`, the connection did not drop in between, and no live milestone was applied since the request. This avoids a stale Flows answer overriding a newer `ended`/`started`.
     - With a boolean `active`, the tracker sets `humanSupport.active`. That also covers tickets opened before the launch, which have no start milestone (`FR-046`), and an `ended` the socket never received.
     - Without `active`, or on timeout/rejection, the tracker keeps the deduced value, warns once (`reason: 'unconfirmed'`) and emits no `error` (`FR-045`).
4. The facade's existing `_handleWebSocketConnected()` still loads history page 1. Milestones arrive in `state.messages` through `merge()`. History merges never change `humanSupport.active`, because older pages cannot be newer than the deduced or confirmed state.

#### 2. Outgoing shopper message lifecycle (`AD-003`)

1. `sendMessage` / `sendAttachment` / `sendAudio` / `sendOrder` build the local message. Its id comes from `generateMessageId()` or a caller-supplied `options.id`.
   - `humanSupport.decorateOutgoing(message)` adds `author: { type: 'contact' }` when `features.humanSupportStatus` is true. Without an author, `webchat-react` would render the pending message as a pre-launch item, with no time and no clock.
   - The message is added with `status: 'pending'`. Ordering classifies it as local tail (see *Ordering rules*).
2. `runQueue()` → `buildMessagePayload()` puts `message.id` on the frame when the id is valid. Otherwise the id is omitted and `WeniWebchatService: outgoing message id omitted` is warned without the value. That message never gets a server status (`AD-003` item 2).
3. On `websocket.send()` success, the `MESSAGE_SENT` listener calls `humanSupport.resolveLocalSendUpdates(message)`:

   | Gate at local-send time | Status after local send | Internal flag |
   |---|---|---|
   | `features.humanSupportStatus === false` | `'sent'`, as today (`1.22.0` behavior) | none |
   | feature ON, `humanSupport.active === true` | stays `'pending'` (clock until `message_saved`) | `__awaitingSave: true` |
   | feature ON, `humanSupport.active === false` (AI mode) | `status` removed (clock cleared, no icon, `FR-022`) | `__awaitingSave: true` |

   The author is also added here when it is missing (a message queued before the gate was known). On failure the message gets `status: 'error'` as today (`FR-023`). `startTypingOnMessageSent()` is skipped while `humanSupport.active` is true, so no typing indicator appears without a Live Desk heartbeat (`FR-031`, `FR-045`).
4. `message_saved` → `MessageProcessor` emits `INTERNAL_EVENTS.MESSAGE_SAVED` → `HumanSupportTracker.handleMessageSaved()`:
   - `normalizeMessageSavedFrame` requires a valid `id`, a non-negative safe-integer `order_key`, and an optional `status === 'sent'`.
   - Unknown or incoming ids are ignored silently (hidden messages, other tabs).
   - The tracker computes `{ orderKey, author: author ?? { type: 'contact' }, status }`:
     - `status: 'sent'` → `resolveForwardStatus(current, 'sent')`;
     - no status and current `'pending'` → status removed;
     - otherwise the status is unchanged (monotonic; a `delivered` that arrived first wins).
   - It emits `MESSAGE_UPDATED` with those public fields. The facade applies them to state (repositioning by `orderKey`) and session, and emits `message:updated`. `__awaitingSave` is cleared directly in state and session and never appears in emitted payloads.
5. `message_status` → `INTERNAL_EVENTS.MESSAGE_STATUS` → `HumanSupportTracker.handleMessageStatus()`:
   - `normalizeMessageStatusFrame` requires `ids` (1–200 unique valid ids) and `status ∈ { delivered, read }`.
   - For each id present in state with `direction: 'outgoing'`, `next = resolveForwardStatus(current, status)`. A message without `status` receives it (self-healing, `AD-003` item 7).
   - All changes are applied with one `state.updateMessages()` call and one session save. `message:updated(id, { status })` is emitted once per changed id.
   - Equal or lower statuses are no-ops, so `read` never regresses (`FR-020`).
   - The service never synthesizes `read`. With read confirmation off, `chats-engine` emits no `msg.read`, so messages stay `delivered` (`FR-048`, `AD-009`).

#### 3. Incoming messages and milestones

1. `message` → `_normalizeMessage()` adds:
   - `author` via `normalizeAuthor(raw.message.author)`. An invalid author is dropped with a warning, and the message is still delivered.
   - `orderKey` via `normalizeOrderKey(raw.order_key)`.
   - For keyed frames, `timestamp` = `Number(raw.message.timestamp) * 1000` when that value is a valid Unix-seconds value, so the live time equals the history time (`FR-034`). Unkeyed frames keep today's `Date.now()` fallback.
2. `human_support_event` → `normalizeHumanSupportEvent(raw.human_support_event)` → `buildMilestoneMessage`, which produces:

   ```text
   {
     id: 'hs_<eventId>',
     type: 'human_support_event',
     timestamp: occurredAt,
     orderKey,
     direction: 'incoming',
     humanSupportEvent: { eventId, event, occurredAt }
   }
   ```

   The milestone is pushed onto the existing `MessageProcessor` queue, so it is emitted after an announcement that arrived before it (`FR-005`). An invalid frame is discarded with a warning and no `error` event.
3. The facade's `MESSAGE_PROCESSED` handler calls `humanSupport.acceptProcessedMessage(msg)` first:
   - **Duplicate milestone** (`state.getMessage('hs_<eventId>')` exists, live or from history) → return `false`. No add, no event (`FR-007`/`FR-008` idempotency).
   - **New milestone** → `state.addMessage` (ordered insert), session mirror, `message:received`. Then, if `orderKey >= lastAppliedMilestoneKey`, the tracker sets `humanSupport.active = event === 'started'`, increments `liveMilestoneSeq`, emits `human_support:changed` (payload `{ active }`), and on `ended` clears the typing author. Older keys are inserted for display without changing the state.
   - **Message from `author.type === 'human_agent'`** → clears the typing author when the ids match, or when either side has no id (`FR-032`).

#### 4. Typing author (`AD-004`)

- `typing_start` with `from: 'human_agent'`, while `messageProcessor.humanSupportEnabled` is true, routes to `HumanSupportTracker.handleHumanAgentTyping(author)`:
  - `toTypingAuthor(author)` exposes `{ type: 'human_agent', name? }` publicly. The opaque `id` stays module-local, used only for matching.
  - `state.setTypingAuthor(...)` and `state.setTyping(true)`. `typing:start` is emitted on the hidden-to-visible transition only.
  - A dedicated timer of `DEFAULTS.HUMAN_AGENT_TYPING_TIMEOUT` (10 000 ms) is renewed on each heartbeat. On expiry: `typingAuthor = null`, `isTyping = false` and `typing:stop` (`NFR-002`).
- The tracker's timer is separate from `MessageProcessor.typingTimer`, so AI `typing_start`/`stream_rationale` frames cannot clear or extend the agent indicator.
- With the feature off, `from: 'human_agent'` keeps today's anonymous typing path.

#### 5. History, merge and reconnect reconciliation

- `HistoryManager.processHistory()` handles each item as follows:
  - Milestone items → `buildMilestoneMessage` (time shown = `occurredAt`).
  - Outgoing items with a valid `message.id` → `id = message.id`, plus `status` when present.
  - Items with a valid `order_key` → `orderKey`, and `timestamp` from `message.timestamp` (falling back to `item.timestamp * 1e3`).
  - Every item gets `author` when present.
  - Items without `author`/`order_key` (pre-launch) are processed exactly as today (`FR-010`).
- `HistoryManager.merge()`:
  - For a history item matching a cached one, the history copy wins for `orderKey`, `author` and `humanSupportEvent`.
  - `status = resolveForwardStatus(cached.status, history.status)` when history has a status. When history has an `orderKey` but no status and the cached copy is awaiting save, the cached `pending` is removed.
  - `__awaitingSave` is dropped.
  - The result is sorted with `sortMessages`.
- `_handleWebSocketConnected()` cleanup:
  - Local `msg_*` ids are removed only if they are **absent from the history response**. Outgoing client ids now equal history ids, so removing them would delete the merged copy.
  - Then `humanSupport.reconcileAwaitingSave(historyIds, page)` marks each remaining `__awaitingSave` message `status: 'error'` (red icon, no retry, `FR-023`) when the history page proves it was not saved. Proof means the page held fewer items than the requested limit, or a later local outgoing message appears in the page.
  - Ambiguous cases are left unchanged. Awaiting messages are never re-sent automatically; see *Failure Handling*.

#### 6. Disconnect and close

- `HumanSupportTracker.handleConnectionLost()`, wired next to `messageProcessor.handleConnectionLost()`:
  - Clears the typing author and its timer, and invalidates the outstanding state request by bumping the epoch.
  - **Keeps** `features` and `humanSupport.active`, so the tag stays until the real state is confirmed (`FR-035`, `FR-045`).
- Pending messages created offline stay `pending` until sent (`FR-035`).

### Ordering rules (`src/utils/messageOrdering.ts`)

- **Local tail** (`isLocalTail`): `direction === 'outgoing'`, `orderKey` absent, and (`status ∈ { 'pending', 'error' }` or `__awaitingSave`). These items stay at the end, in local order.
- **Live insert** (`StateManager.addMessage` → `insertMessage`):
  - Items without `orderKey` (AI streams, legacy frames, local `conversation_status`) are appended in arrival order, as today. This means no browser clock is compared with the socket clock.
  - Keyed items are placed by scanning backward from the end, skipping local-tail items and keyed items with a greater `orderKey`. The item goes right after the first item that is neither. Equal keys keep arrival order.
- **Reposition** (`message_saved` sets `orderKey` → `repositionMessage`): the item only moves **backward**, past local-tail items and keyed items with a greater `orderKey`. It never moves past a later unkeyed live item. This keeps the shopper's question above an AI reply that started streaming before `message_saved`.
- **History merge** (`sortMessages`): stable sort of non-tail items by `getSortKey` (`orderKey`, else `timestamp` in ms), with local-tail items appended in local order.
  - Pre-launch `timestamp` (doc seconds × 1000) and post-launch `orderKey` share the socket clock: the socket writes `timestamp = floor(order_key / 1000)`.
  - For equal keys, the stable sort keeps the relative order in which the socket returned them. The socket already broke ties by `_id`.
- The session conversation mirrors `state.messages` order, so a reload restores the displayed order without re-sorting by browser time.
- The ordering is never used as the displayed time. `timestamp` stays the bubble time, and `humanSupportEvent.occurredAt` the milestone time.

### Rejected Alternatives

- **Deducing the state from the `get_history` response instead of `ready_for_message.data.history`**: rejected. The socket already returns the same 20 items in `ready_for_message`. Waiting for a second round-trip (up to 30 s timeout in `HistoryManager.request`) would delay the tag, and `AD-002` item 5 names `ready_for_message`.
- **Keeping `status: 'sent'` on local send in AI mode**: rejected on enabled channels. The contract shows the icon *iff* the message received a server status. `webchat-react#179` (`computeMessageDisplayMetadata` → `validateShopperStatus`) renders ✓ for any `sent` on an outgoing message with `author`. A local `sent` would show ✓ in AI mode, violating `FR-022`.
- **Keeping `pending` until `message_saved` in AI mode too**: rejected. `AD-003` item 7 and the service contract require the clock to clear on local send outside human support.
- **Re-sending awaiting-save messages after reconnect**: rejected. `message.id` is not deduplicated by `courier`/Live Desk, so a resend could duplicate the shopper message for the agent. Marking `error` is the safe failure path (Constitution XV).
- **Sorting all live items by `orderKey ?? timestamp`**: rejected. Stream bubbles and local status rows carry the browser clock. Mixed with socket-clock keys, clock skew could put an AI reply above the shopper's question.
- **Reusing `MessageProcessor.typingTimer` for the agent indicator**: rejected. AI `typing_start`/`stream_rationale` would clear or extend it, and the 50 s `typingTimeout` breaks `NFR-002`.
- **Adding all logic to `MessageProcessor.js` / `index.js`**: rejected by Constitution X and XI. Both files already exceed 500 lines. New logic lives in strict-TS modules and the JS files get routing and wiring only.
- **Persisting `features`/`humanSupport` in the session**: rejected. The socket allowlist (`AD-007`) is the only gate and instant rollback switch. A persisted `true` would show human-support UI on a channel that was just disabled.
- **Live dedupe with a module-local `Set` of event ids**: rejected. The deterministic id `hs_<eventId>` makes `state.messages` (live, history and restored session) the single source of truth (Constitution XV).

## Contracts

| Interface | Change | Version impact | Backward compatible |
|-----------|--------|----------------|---------------------|
| `Message` (via `message:received`, `message:updated`, `history:loaded`, `getMessages()`, `state:changed`) | added optional `author` (`{ type: 'contact' \| 'ai_agent' \| 'human_agent', name?, id? }`), `orderKey`, `humanSupportEvent` (`{ eventId, event, occurredAt }`), `type: 'human_support_event'`; outgoing `id` equals the wire `message.id`, and outgoing history items now use it instead of MongoDB `ID` when present | minor | yes — optional fields; pre-launch and feature-off items are unchanged |
| `Message.status` on outgoing messages (feature ON only) | advances `pending` → `sent` → `delivered` → `read` from server frames and history, monotonic; in AI mode `status` is removed on local send instead of set to `'sent'`; `error` stays local | minor | yes for channels with the feature off (identical to `1.22.0`); on enabled channels the AI-mode change is documented under `Changed` in `CHANGELOG.md` and the README, and is gated by the socket allowlist plus the capability |
| State (`getState()`, `state:changed`) | added `features: { humanSupportStatus }`, `humanSupport: { active }`, `typingAuthor: { type: 'human_agent', name? } \| null`; `isTyping` keeps its meaning | minor | yes — additive keys with `false`/`null` defaults |
| Event `human_support:changed` (`SERVICE_EVENTS.HUMAN_SUPPORT_CHANGED`) | added; payload `state.humanSupport`, emitted only on change | minor | yes — new event |
| Constants and named exports | added `MESSAGE_TYPES.HUMAN_SUPPORT_EVENT`, `MESSAGE_AUTHOR_TYPES`, `HUMAN_SUPPORT_EVENTS`, `WS_MESSAGE_TYPES` entries, `DEFAULTS.HUMAN_AGENT_TYPING_TIMEOUT`, `DEFAULTS.HUMAN_SUPPORT_STATE_TIMEOUT` | minor | yes — additive |
| Outbound WebSocket frames | `register.data.features.humanSupportStatus: true` (fixed); `message.id` on `message`/`message_with_fields`; new `get_human_support_state` (only when `human_support_enabled`) | minor | yes — the socket reads an absent capability as false and treats `message.id` as optional (`AD-003` item 2); the new request is never sent to sockets that did not enable the feature |
| Consumed WebSocket frames (`socket-frames.schema.json` 1.0.0) | new `message_saved`, `message_status`, `human_support_event`, `human_support_state`; extended `message`, `typing_start`, `ready_for_message`, `history` | minor | yes — existing frames work identically; unknown keys ignored |
| Stored session (`weni:webchat:session` `conversation[]`) | persists `author`, `orderKey`, `humanSupportEvent`, milestone items and the internal `__awaitingSave`; order mirrors `state.messages` | minor | yes — same key and shape; `1.22.0` reads it without error (see the rollback risk) |
| `src/types/index.d.ts` | new types and optional fields listed in *Components Affected* | minor | yes — additive and widening |

The package version goes from `1.22.0` to `1.23.0` (MINOR), published by the tag-driven `npm-publish.yaml`. The architecture contract is written as a delta over `1.21.0`. Every addition is also additive over `1.22.0`, which already shipped `004-components-streaming`.

**Consumers affected**:

- `webchat-react` ([webchat-react#179](https://github.com/weni-ai/webchat-react/pull/179)) bumps its `@weni/webchat-service` dependency to `1.23.0`, and renders only when `state.features.humanSupportStatus` is true (`BD-006`).
- Custom integrators see no change unless the socket enables the feature for their channel and their bundle runs `1.23.0`. They are notified through `CHANGELOG.md` (`Added`, `Changed`) and the README section on human support status.

## Data Model and Migrations

- **`StateManager` state (in memory, not persisted)**:
  - `features.humanSupportStatus: boolean` (per connection, kept across disconnects until the next `ready_for_message`);
  - `humanSupport: { active: boolean }`;
  - `typingAuthor: { type: 'human_agent', name?: string } | null`.
- **`Message` (in memory and persisted)**:
  - `author?`, `orderKey?: number` (epoch ms, socket clock);
  - `humanSupportEvent?: { eventId: string, event: 'started' | 'ended', occurredAt: number }` on `type: 'human_support_event'` items (`id: 'hs_<eventId>'`, `timestamp: occurredAt`, `direction: 'incoming'`);
  - internal `__awaitingSave?: true` on outgoing messages written to the socket but not yet confirmed. It follows the existing `__customFields` convention.
- **`HumanSupportTracker` module-local state (not shared, Constitution XV)**: `connectionEpoch`, `liveMilestoneSeq`, `lastAppliedMilestoneKey`, the typing timer and the matched agent `id`.
- **Persisted session conversation**: the same `weni:webchat:session` key and structure. New optional fields are persisted, so a reload restores milestones, names, statuses and order before the history merge (`BD-007`, `FR-034`). `typingAuthor`, `humanSupport` and `features` are never persisted.

**Migrations**: none. There is no storage key change and no schema version.

- Sessions written by `1.22.0` restore unchanged. They have no new fields, so items render as pre-launch until the history merge backfills `orderKey`/`author`.
- Sessions written by `1.23.0` are readable by `1.22.0`. The only visible effect after a package rollback is the cached milestone item risk described in *Rollout and Rollback*.

## Non-Functional Requirements

### Peak Load

The window is the platform peak measured in the architecture baseline: production, 5-minute rates over 30 days ending 2026-11-23.

- ≈ 29,900 concurrent socket connections.
- WWC peaks of 154 sends/min and 134.5 shopper messages/min.
- An upper bound of ≈ 700 new actions/min across all connections (milestones ≈ 20/min, `read` ≈ 135/min, `sent`/`delivered` ≈ 135/min each, typing ≈ 370/min).

Per browser tab, which is the unit this library runs in, the peak is one human-support conversation with:

- ≤ 1 `typing_start` every 5 s per typing agent (≤ 12/min);
- ≤ 3 status frames per shopper message (`message_saved`, `delivered`, `read`), with one `read` batch of up to 200 ids when an agent opens the room;
- 2 milestones per ticket;
- exactly 1 `get_human_support_state` per successful (re)connection, bounded by `RetryStrategy` (≥ 3 s base delay, max 30 attempts).

Client cost:

- Live insert and reposition are O(n) over `state.messages`, typically below a few hundred items (history pages of 20).
- A 200-id `read` batch is O(k + n), with one `setState` and one storage write instead of one per id.
- There is one typing timer and one state-request timer per connection, and no polling.

### Observability

- All diagnostics use `console.warn` with a module prefix and a structured context (Constitution VIII), through `warnHumanSupportContract`:

  | Message | Context |
  |---|---|
  | `HumanSupportTracker: invalid frame discarded` | `{ operation: 'normalize-message-saved' \| 'normalize-message-status' \| 'normalize-human-support-state', frameType, messageId?, reason }` |
  | `MessageProcessor: invalid human_support_event discarded` / `HistoryManager: invalid human_support_event discarded` | `{ operation: 'normalize-human-support-event', eventId?, reason }` |
  | `MessageProcessor: invalid author discarded` / `HistoryManager: invalid author discarded` | `{ operation: 'normalize-author', messageId, reason }` |
  | `HumanSupportTracker: human support state unconfirmed` | `{ operation: 'confirm-human-support-state', connectionStatus, reason: 'no_active' \| 'timeout' \| 'send_failed' }` (once per connection) |
  | `HumanSupportTracker: message not confirmed after reconnect` | `{ operation: 'reconcile-awaiting-save', messageId, reason: 'missing_from_history' }` |
  | `WeniWebchatService: outgoing message id omitted` | `{ operation: 'send-message', messageType, reason: 'invalid_client_message_id' }` (the invalid value is never logged) |

- **Correlation identifiers**: `message.id` joins widget, socket, `courier` and Live Desk logs for shopper messages and statuses. `eventId` joins milestone logs with `mailroom` and the socket history.
- **Never logged or emitted in errors**: message text, `author.name`, `typingAuthor.name`, the agent `id` value, tokens, or raw frames (`BD-003`, Constitution VII/VIII).
- Valid frames, unknown ids in `message_status`/`message_saved` (hidden messages, other tabs) and duplicate milestones produce no log noise.

### Failure Handling

There is no new HTTP call. The only new request is the `get_human_support_state` frame, with an explicit client timeout.

- **`get_human_support_state`**:
  - The socket answers within its 2 s Flows timeout, and `DEFAULTS.HUMAN_SUPPORT_STATE_TIMEOUT` (10 000 ms) bounds the wait on the client side.
  - On a missing `active`, a timeout or a send failure, the deduced state is kept and the tracker warns once. No `error` event and no shopper-visible error (`FR-045`).
  - There is no retry within a connection. The next (re)connection asks again (one request per connection, per the contract).
  - Late answers from a previous connection are ignored by the epoch guard.
- **Malformed or out-of-contract frames**: permanent contract errors. They are discarded at the boundary with a warning and never retried. The rest of the frame or flow continues, and `SERVICE_EVENTS.ERROR` is not emitted.
- **Duplicate or out-of-order frames**:
  - Milestones are idempotent by `hs_<eventId>`.
  - Statuses are idempotent and monotonic (`resolveForwardStatus`); `delivered` arriving after `read` is a no-op.
  - Each `typing_start` only renews the expiry.
- **Lost `ended` or missing Live Desk events**: the tag stays until confirmation on the next connection. Statuses stay at the last confirmed value. The typing indicator expires after 10 s and never sticks (`FR-045`, `NFR-002`).
- **Local send failure** (`websocket.send` rejects): `status: 'error'` as today, and no `__awaitingSave` (`FR-023`).
- **Server-side redirect failure** (`courier` non-2xx): the socket sends a generic `error` frame without a message id. The service emits `SERVICE_EVENTS.ERROR` as today. The message stays `pending` (human support) or without an icon (AI mode) until reconnect reconciliation marks it `error` when unconfirmed. There is no live correlation and no heuristic mapping (see *Implementation Decisions*).
- **Disconnect with an awaiting message**: never re-sent automatically, to avoid duplicates. On reconnect, a history merge that contains its id applies the server status. A history page that proves it was not saved marks it `error`. Ambiguous pages leave it unchanged, and it is re-evaluated on the next history load.
- **Reload with an awaiting message**: `init()` re-enqueues only `pending` messages **without** `__awaitingSave`, so a message already written to the socket is not sent twice.
- **Feature disabled during operation** (allowlist rollback): the next `ready_for_message` without `human_support_enabled` sets `features.humanSupportStatus = false` and `humanSupport.active = false` and clears the typing author. The service returns to the `1.22.0` local-send semantics.
- **Reconnection**: the existing configurable `RetryStrategy` is unchanged (`reconnectInterval` 3000 ms, max 30 000 ms, factor 2, jitter ≤ 1000 ms, `maxReconnectAttempts` 30).

### Security and Authorization

- **Trust boundary**: frames from `weni-webchat-socket` enter at three places: `WebSocketManager._handleMessage` (`ready_for_message`, `human_support_state`), `MessageProcessor.process` (`message`, `typing_start`, `human_support_event`, `message_saved`, `message_status`) and `HistoryManager.processHistory` (`history`). Every new field is validated in `src/utils/humanSupportWire.ts` before it reaches state, storage or events:
  - **Client message id**: `^[A-Za-z0-9_-]{1,64}$`. **Event id**: UUID. **`occurred_at`**: RFC 3339, converted to a finite epoch-ms number.
  - **`order_key`**: a non-negative safe integer. **Statuses**: enums. **`ids`**: 1–200 unique entries.
  - **`author`**: matches the closed shared schema. `human_agent.id` is `^ha_[0-9a-f]{32}$`, `name` is trimmed to 1–80 characters, and unknown keys (e.g. a stray `email` or `last_name`) are dropped (`BD-003`).
- **Server-side authorization**: the socket scopes frames and history to the registered session (URN + channel). Only the room's agent generates `msg.read` (`chats-engine`), and the read-confirmation setting is enforced in `chats-engine` (`AD-009`). As defense in depth, the service applies statuses only to ids of outgoing messages in its own state.
- **No secrets and no new browser permissions**. Session tokens keep flowing only through `SessionManager`/`StorageManager` (Constitution VII). `author.name` is passed as data, and rendering as text nodes is the consumer's responsibility (`webchat-react` renders React text nodes).

## Test Strategy

The inherited success criteria are `SC-001` and `SC-002`. Both are measured by QA samples in VTEX test projects. The automated tests below prove the invariants this repository owns in support of them.

| Success / acceptance criterion | How this repository proves it |
|--------------------------------|-------------------------------|
| `SC-001` (tag, start/end milestones and times shown match the Live Desk; validates `FR-001`–`FR-013`, `FR-034`, `NFR-001`) | **`tests/service.humanSupport.test.ts`** (facade with mocked socket, frames from the schema `examples`):<br>• `register` carries `humanSupportStatus: true`.<br>• `ready_for_message` with `human_support_enabled` sets `features.humanSupportStatus`.<br>• History with a trailing `started` sets `humanSupport.active = true` before `get_human_support_state` is answered.<br>• `human_support_state { active }` confirms it; without `active`, or on timeout, the deduced value is kept with no `error`.<br>• A live `human_support_event` emits `message:received` (milestone with `occurredAt` ms, `id: 'hs_<eventId>'`), sets `humanSupport.active` and emits `human_support:changed`.<br>• A duplicate `eventId` emits nothing.<br>• `ended` flips the state and clears `typingAuthor`.<br>• Two tickets produce four ordered milestones.<br>• The milestone sits after the announcement (`order_key`) both live and after `history:loaded` + `merge()`.<br>• Live `message` time equals history time.<br>• An offline `ended` delivered through history restores `active: false` and the milestone at its `orderKey` (`FR-035`).<br>• `human_support_state { active: true }` with no milestone (ticket opened before launch, `FR-046`).<br>**`src/utils/tests/humanSupportWire.test.ts`**: valid/invalid authors, events, keys and frames.<br>**`src/utils/tests/messageOrdering.test.ts`**: tie-breaking, legacy `timestamp` fallback, local tail, backward-only reposition, unkeyed live append.<br>**`tests/HistoryManager.test.js`**: milestone items, `message.id`, `author`/`status`/`orderKey` parity, merge precedence. |
| `SC-002` (with read confirmation off, no shopper message appears as read; with it on, `FR-019` holds; validates `FR-047`–`FR-051`, `NFR-005`) | **`tests/service.humanSupport.test.ts`**:<br>• During human support a sent message stays `pending` until `message_saved { status: 'sent' }`, then becomes `delivered`, and then `read` only from a `message_status` `read` frame.<br>• With no `read` frame (read confirmation off: `chats-engine` emits nothing), messages stay `delivered` across reload, reconnect and history merge.<br>• A 200-id `read` batch updates all matching messages with one storage write and one `message:updated` per id.<br>• `read` never regresses after a later `delivered`, `message_saved` or history copy.<br>• `delivered` messages from a "disabled" window are not upgraded unless a `read` frame for them arrives.<br>• An AI-mode message has no status after local send and none after `message_saved` without status (`FR-022`).<br>• `delivered` for a message without status attaches it (self-healing).<br>**`src/utils/tests/messageStatus.test.ts`**: the full `resolveForwardStatus` matrix.<br>**`src/modules/tests/HumanSupportTracker.test.ts`**: monotonic apply, unknown ids ignored, incoming ids ignored. |

**Flow coverage**:

- **Full lifecycle through `WeniWebchatService`**: connect → capability → deduction → confirmation → AI announcement → `started` → shopper message (`pending` → `sent` → `delivered` → `read`) → agent typing (`typingAuthor` with name, 10 s expiry with fake timers, cleared by the agent's message) → agent message with `author` → `ended` → AI-mode shopper message (status removed on local send, `orderKey` from `message_saved`).
- **Reload continuity**: the session persists milestones, authors, statuses and order. `init()` does not re-send `__awaitingSave` messages. History merge keeps forward statuses and drops `__awaitingSave`.
- **Reconnect**: `_handleWebSocketConnected()` keeps history-matched client ids. A confirmation after reconnect corrects a stale `active`. A late answer from a previous connection is ignored.
- **Feature-off parity**: without `human_support_enabled`, local send sets `'sent'`, no author is attached, `from: 'human_agent'` typing uses the legacy path, no `get_human_support_state` is sent and `humanSupport.active` stays `false`. The existing suites pass unchanged.
- **Simulator**: `simulateMessageReceived()` replays the `message_saved`, `message_status`, `human_support_event` and `typing_start` (`human_agent`) examples (`tests/service.simulators.test.js`).

**Failure paths covered**:

- Malformed `author`, `order_key`, `human_support_event` (bad UUID, bad date, unknown `event`), `message_saved` (missing `order_key`, bad id), `message_status` (0 or 201 ids, unknown status) and history milestone items are discarded with PII-free warnings. The assertions check that warning arguments never contain text, names or agent ids.
- `get_human_support_state` timeout, send failure, and an answer without `active`.
- Local `websocket.send` failure → `error`, without `__awaitingSave`.
- Generic server `error` frame while a message awaits save → `SERVICE_EVENTS.ERROR` and no status change. Reconnect with a non-full history page missing the id → `error`. Ambiguous page → unchanged.
- Disconnect during agent typing → `typingAuthor` cleared, and `humanSupport.active` and `features` kept.
- Allowlist rollback: a `ready_for_message` without the flag after a session with it on.
- An invalid caller-supplied `options.id` is omitted from the wire with a warning.

**Stubbed at the boundary**:

- The WebSocket transport is mocked (`tests/_helpers/serviceMocks.js` and `WebSocketManager` EventEmitter mocks). Frames come from the pinned schema `examples`.
- `localStorage`/`sessionStorage` use jsdom and `StorageManager` mocks.
- `console.warn` is spied with `jest.spyOn`, and timers use `jest.useFakeTimers()` (10 s typing expiry, 10 s state timeout, `messageDelay` queue).
- No live socket or network calls.

## Rollout and Rollback

This follows the architecture *Delivery Sequence*:

1. Receivers first: `weni-webchat-socket` (empty allowlist) and `courier`, then `mailroom`, then `chats-engine` + the Live Desk front-end with the read-confirmation setting.
2. **`@weni/webchat-service` `1.23.0`**:
   - Merge with `CHANGELOG.md`, `README.md` and `src/types/index.d.ts`, then `npm version minor -m "chore: release %s"`. The tag `1.23.0` publishes to `latest`. A `1.23.0-staging*` tag can be published earlier for QA.
   - Publishing before the socket is safe: until a socket answers `human_support_enabled`, the only wire difference is the fixed capability and the optional `message.id`, both ignored by older sockets.
3. **`webchat-react`** ([webchat-react#179](https://github.com/weni-ai/webchat-react/pull/179)) bumps to `1.23.0`, merges `en.json`, and waits for the Crowdin `pt.json`/`es.json` PR.
4. **QA** runs `SC-001`/`SC-002` on VTEX test-project channels added to the socket allowlist, alternating read confirmation for `SC-002`. Channels are enabled only after the new bundle is published and the CDN cache has expired, which keeps old cached bundles without `message.id` out of enabled channels (architecture risk on statusless messages).
5. **General release**: `*` in the socket allowlist.

**Rollback**:

- **Immediate and preferred**: remove the channel from the socket allowlist. On the next `ready_for_message`, this library sets `features.humanSupportStatus = false` and `humanSupport.active = false`, and reverts to `1.22.0` semantics. `webchat-react` stops rendering the feature. Data already stored remains harmless.
- **Package rollback** (consumers pin `@weni/webchat-service@1.22.0`, together with the matching `webchat-react` version):
  - Sessions written by `1.23.0` stay readable.
  - Residual risk: cached `human_support_event` items in `localStorage` are not removed by `1.22.0`'s reconnect cleanup (their ids do not start with `msg_`). They render as empty incoming bubbles in the previous widget until the session cache is cleared (`autoClearCache` timer or a new session).
  - Mitigation: roll back the allowlist first, and roll back the package only together with the widget.

## Constitution Alignment

| Principle | How this spec complies | Exception + justification |
|-----------|------------------------|---------------------------|
| I. Version Control and Review | Delivered through a PR to `main` with review, `unit-tests.yaml` (coverage gate) and `linting-on-push.yaml`. | none |
| II. Specification Traceability | Opens with `## Inheritance from Product Spec` in the exact format. Exactly one Product Spec, pinned by commit SHA. The architecture doc is pinned by commit. The scope names the socket ↔ service ↔ react slice. | The Product Spec is not tagged yet, and II says it "MUST exist and be tagged before its engineering spec is created". The pin is the immutable commit `5dbf6b3…`: an ancestor of `main`, with no later change to `specs/009-sa-human-support-status/`. That is the same version `webchat-react#179` pins, which satisfies the cross-repo alignment II exists for. Follow-up: re-pin `Pinned version` and `Architecture doc` once the PM creates the Product Spec tag and `009-sa-human-support-status/arch-v1` is approved (owners listed in the architecture risks). |
| III. No Silent Divergence | Nothing inherited is contradicted; `Divergences: none`. The gap in correlating server `error` frames was raised with the developer and resolved as an explicit implementation decision; it contradicts no inherited decision. | none |
| IV. Versioned Public Contracts | All changes to `Message`, state, events, constants, frames, storage and types are additive. The release is MINOR `1.23.0`. | On channels where the socket enables the feature, AI-mode outgoing messages no longer get `status: 'sent'` on local send (status removed). This is needed by the contract's "icon iff server status" rule and `FR-022`. It is gated by the allowlist plus the capability, so channels with the feature off are unchanged. It is announced under `Changed` in `CHANGELOG.md` and the README. |
| V. Release & Changelog Maintenance | `CHANGELOG.md` (`Added`, `Changed`, `Fixed`) and the README in the same PR. Requires a new npm MINOR and a consumer update (`webchat-react`), with coordinated rollout through the allowlist. | none |
| VI. Commit Messages | Atomic Conventional Commits, ≤ 50-character descriptions, release commit `chore: release 1.23.0`. | none |
| VII. Security & Secrets | No secrets or dependencies. Closed-schema author normalization drops non-first-name data. Tokens are untouched. | none |
| VIII. Observability | Structured `console.warn` with module prefixes, `operation`, `reason`, `connectionStatus` and correlation ids (`messageId`, `eventId`), with no PII. | none |
| IX. Code as Documentation | English code. JSDoc/TSDoc on exported functions. Comments explain the invariants: backward-only reposition, epoch guard, why `__awaitingSave` blocks resend. | none |
| X. Type Safety | Every new source and test file is strict TypeScript without `any`. `src/types/index.d.ts` is updated in the same PR. The TS toolchain already exists (`.ts` in Rollup, Babel, Jest `testMatch`/`collectCoverageFrom`, ESLint). | Existing JS modules (`MessageProcessor.js`, `WebSocketManager.js`, `StateManager.js`, `SessionManager.js`, `HistoryManager.js`, `messageBuilder.js`, `index.js`) get small routing and wiring changes and are not migrated. Substantive logic lives in the new TS modules. |
| XI. Single Responsibility | New responsibilities live in focused TS modules (`HumanSupportTracker.ts`, `ShopperMessageStatus.ts`, `HumanAgentTyping.ts`, `humanSupportWire.ts`, `humanSupportHistory.ts`, `messageOrdering.ts`, `messageStatus.ts`), each under 350 lines. | `index.js` (1470), `MessageProcessor.js` (1235) and `WebSocketManager.js` (876) already exceed 500 lines (acknowledged in XI). Only thin routing and wiring is added there. `HistoryManager.js` (379) grows by delegation calls only, and normalization lives in `humanSupportWire.ts`. |
| XII. Naming Conventions | `HumanSupportTracker.ts` is PascalCase (single class). Utility modules are lowerCamel (`humanSupportWire.ts`, as with `streamComponents.ts`). camelCase fields. `UPPER_SNAKE_CASE` constant maps. | none |
| XIII. Module & Public API Architecture | The facade only wires. Logic goes to `modules/` and `utils/`, transport to `WebSocketManager`. The new handler-style methods use the `handle` prefix (`handleReady`, `handleMessageSaved`, `handleConnectionLost`). The event name follows `SERVICE_EVENTS` (`human_support:changed`, fixed by the contract). | none |
| XIV. WebSocket Contract & Data Boundaries | Every new wire field is validated and normalized at the boundary. `snake_case` never reaches state, logic or events: `order_key` → `orderKey`, `occurred_at` → `occurredAt`, `event_id` → `eventId`, `human_support_enabled` → `features.humanSupportStatus`. Outbound builders keep wire naming. Enum values keep the producer form, per the contract. The new request has an explicit timeout. | none |
| XV. State Management & Async Correctness | `StateManager` holds `features`, `humanSupport`, `typingAuthor` and ordered messages. `SessionManager` persists the conversation. The tracker keeps only module-local guards. Statuses are monotonic. A failed optimistic send is marked `error`, never silently dropped. Resend is guarded by `__awaitingSave`. Contradictory states are prevented by the epoch guard and the milestone-key precedence. | none |
| XVI. Resilience & Error Handling | Retriable failures (disconnect, state-request timeout) are distinguished from permanent contract errors (malformed frames). The documented timeouts are `DEFAULTS.HUMAN_SUPPORT_STATE_TIMEOUT` and `DEFAULTS.HUMAN_AGENT_TYPING_TIMEOUT`. No exception is swallowed without recovery and a warning. | `HUMAN_AGENT_TYPING_TIMEOUT` is a documented constant, not an init option. Making it configurable would let integrators break the binding `NFR-002`. |
| Testing | Tests are written before the implementation. TS unit tests are colocated in `src/utils/tests/` and `src/modules/tests/`, and facade flow tests in `tests/service.humanSupport.test.ts`. No live network. Coverage stays ≥ `COVERAGE_THRESHOLD`. | The legacy suites under `tests/` (`MessageProcessor`, `HistoryManager`, `StateManager`, `SessionManager`, `WebSocketManager`, `messageBuilder`, `service.*`) are extended in place, because those JS modules receive targeted changes rather than rewrites. This is the same exception as `004-components-streaming`. The facade flow test sits in `tests/` because it imports the JS facade, which the strict TS config (`allowJs: false`) cannot typecheck under `src/`. |
| Accessibility | The service ships no UI. It emits the data consumers need (`humanSupportEvent.event`/`occurredAt`, `author.name`, `status`, `typingAuthor.name`) for `NFR-003`/`NFR-004` labels and announcements in `webchat-react`. | none |
| Internationalization | No user-facing strings. Raw values are emitted (`occurredAt`/`timestamp` in epoch ms), and formatting happens in `webchat-react`. | none |
| Performance & Maintainability | No new runtime dependency. The status rank and ordering rules each have a single source (`messageStatus.ts`, `messageOrdering.ts`) shared by the tracker and `HistoryManager`. Batched status writes. No polling. | none |

## Implementation Decisions

- **Deduce from `ready_for_message.data.history`**: the socket already includes the latest 20 items there. The deduction runs synchronously before `CONNECTION_STATUS_CHANGED('connected')`, so the tag can show without waiting for `get_history`. A page without milestones keeps the in-memory value.
- **Precedence of human support state**: a new live milestone (key ≥ last applied) beats the Flows confirmation, which beats the history deduction. A confirmation is applied only if it belongs to the current connection epoch and no live milestone was applied after it was requested. History merges of older pages never change the state.
- **Feature gate lifetime**: `features.humanSupportStatus` is set on every `ready_for_message` and kept across disconnects until the next one, so the tag and clock survive reconnecting (`FR-035`, `FR-045`). It is reset by `clearSession()`/`state.reset()` and never persisted.
- **AI-mode local send removes `status`**: this is the only representation compatible with the "icon iff server status" rule and with `webchat-react#179`. Feature OFF keeps `'sent'` for backward compatibility.
- **Internal `__awaitingSave` marker**: distinguishes "written to the socket, awaiting `message_saved`" from "never sent" for both `pending` (human support) and status-less (AI mode) messages. It follows the existing `__customFields` convention, is persisted so reloads don't re-send, is cleared on `message_saved` or a history match, and is never included in emitted `message:updated` payloads.
- **Outgoing `author: { type: 'contact' }` is set locally** when the feature is ON at creation or at local send. Without it, `webchat-react` treats the message as pre-launch and hides the clock and time (`FR-010`, `FR-018`).
- **Reuse `generateMessageId()` as the wire id**: the local id already matches the pattern, so state updates by id need no mapping. Caller-supplied `options.id` values are validated, and invalid ones are omitted from the wire (no status) rather than rewritten, so the integrator's local id stays stable.
- **Milestone id `hs_<eventId>` and `timestamp = occurredAt`**: matches the service contract example and the `webchat-react` mock. It enables dedupe through `state.messages` with no extra registry.
- **Milestones go through the existing `MessageProcessor` queue**: emission order follows arrival, so the transfer announcement appears before the milestone (`FR-005`). The queue's `messageDelay` (default 1000 ms) between consecutive queued items is accepted within `NFR-001` (2 s P95), and the latency risk is recorded below.
- **Status frames bypass the queue**: they update existing messages in place, immediately and in batches, with one storage write per frame.
- **Server `message.timestamp` for keyed live messages**: the live time then equals the reloaded time to the minute (`FR-034`). Unkeyed frames keep `Date.now()`, so pre-launch behavior is unchanged.
- **`requestHumanSupportState` follows the `requestVoiceTokens` pattern** in `WebSocketManager` (`once` listeners plus a timeout, cleanup on settle). Transport stays encapsulated (XIV), and late answers are discarded by construction.
- **Separate agent typing timer, and no optimistic typing during human support**: the 10 s expiry is exact per heartbeat. Skipping `startTypingOnMessageSent()` while `humanSupport.active` prevents a typing indicator that no agent produced (`FR-045`).
- **`typingAuthor` hides the agent id**: the public shape follows the contract (`type`, `name?`). The id is kept module-local only to match the clearing message, and a missing id on either side matches any `human_agent` message.
- **Session mirrors state order**: `setConversation(state.getMessages())` runs on non-append inserts and repositions (the same full serialization `_save()` already performs per append), so reloads restore the server order without re-sorting by browser time.
- **Reconnect cleanup keeps history-matched ids**: fixes the existing `_handleWebSocketConnected()` removal, which would otherwise delete merged shopper messages now that outgoing history ids equal client ids.
- **New internal events in a non-exported `INTERNAL_EVENTS` map**: `READY_FOR_MESSAGE`, `MESSAGE_SAVED`, `MESSAGE_STATUS` and `HUMAN_AGENT_TYPING` are wiring between modules, not public contract, so they are kept out of `SERVICE_EVENTS`.
- **Known latency risk**: when several messages are queued, each queued item waits `messageDelay` before the next one, and a milestone behind `n` queued messages is delayed by about `n × messageDelay`. This is validated during QA against `NFR-001`. If it is exceeded, the plan may emit milestones without the inter-message delay while keeping their order.

- **Server-side redirect failures are not correlated live** (decided by the developer on 2026-11-26, option A): the socket's generic `{ type: 'error', error }` frame (`Client.Redirect` in `weni-webchat-socket`) carries no message id.
  - The service keeps emitting `SERVICE_EVENTS.ERROR` as today and changes no message status for it.
  - The awaiting message stays `pending` (human support) or without an icon (AI mode) until reconnect reconciliation marks it `error`, when the history page proves it was not saved (`FR-023`).
  - Rejected: an architecture contract amendment adding `id` to the `error` frame, and mapping the frame to the oldest awaiting message (that heuristic is unsafe with unrelated `error` frames).
  - The contract stays unchanged. Live correlation can be added later through an architecture amendment without changing this library's public API.

## Divergences

none
