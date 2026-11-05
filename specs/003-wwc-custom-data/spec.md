# Engineering Specification: customData on Weni Web Channel messages

**Repository**: webchat-service — frontend

**Feature Branch**: `003-wwc-custom-data`

**Created**: 2026-11-04

**Status**: Draft

## Origin Without Product Spec

- Product Spec: none
- Problem: Integrators who build a custom webchat on `@weni/webchat-service` cannot receive their own structured data with the messages the platform sends. When the socket delivers `message.custom_data`, `MessageProcessor._normalizeMessage` and `HistoryManager.processHistory` build the public `Message` field by field and drop it, so it never reaches `message:received`, `history:loaded` or the state messages.
- Acceptance criteria:
  - A live `message` frame whose `message.custom_data` is a JSON object makes `message:received` emit a `Message` with `customData` deep-equal to that object. Nested keys keep their original names (for example `order_id` and `expires_at` are not converted to camelCase), and the emitted message has no `custom_data` property.
  - A `history` frame item whose `message.custom_data` is a JSON object makes `history:loaded` emit the matching `Message` with the same `customData`. For the same wire value, the live and history paths produce deep-equal `customData`.
  - When `message.custom_data` is missing or `null`, the emitted `Message` has no `customData` property and is otherwise identical to what the current release emits.
  - When `message.custom_data` is present but is not a JSON object (an array, string, number or boolean), the message is still emitted without `customData`. One `console.warn` is written with a module prefix and structured context that contains the operation, the message type and the kind of value received, and never the value itself.
  - `customData` is kept on the message in `state.messages` and in the stored session conversation, so it is still on the message after a page reload that restores the session. When `getHistory` merges a history message into a cached copy that has no `customData`, the merged message takes it from history.
  - `src/types/index.d.ts` declares `customData` on `Message`. The change ships as a MINOR release with a `CHANGELOG.md` entry under Added and README documentation of the field.

## Scope in This Repository

**Architecture doc**: Architecture Document `007-wwc-custom-data` (contract-only) — [architecture.md @ `7f2b14e`](https://github.com/weni-ai/vtex-cx-experience-specs/blob/7f2b14e693270db42ff28b1f0727ed7a6854ef28/specs/007-wwc-custom-data/architecture.md). The doc is pinned to a commit because the tag `007-wwc-custom-data/arch-v1` does not exist yet; the doc is still a draft pending approval. Once that tag is created, this line must be updated to point to the tag.

Binding decisions this repository honors:

- **AD-001**: the wire position is `message.custom_data` in the live `message` frame and in each `history[].message`; the public name is `customData`.
- **AD-002**: limits (16 KB, 32 levels, forbidden keys) are enforced only by flows. This library does not revalidate them. It only drops the field when it is not a JSON object.
- **AD-005**: courier sends `custom_data` only on the last payload of a split message. This library exposes it on whichever message it arrives with and does not copy it to sibling parts.
- **AD-006**: the value is exposed both live and in history, with the same content.
- **AD-007**: the public field is `customData` (camelCase), and its inner keys are passed through without conversion.

**This repository implements**: the last hop of the flow (weni-webchat-socket → webchat-service → custom webchats). It reads `message.custom_data` from the socket frames `message` and `history` and exposes it as `Message.customData` in `message:received`, `history:loaded`, `state.messages` and the stored session conversation. It also updates the public type and documentation.

**Out of scope here**:

- Validating size, depth or keys of `custom_data`: flows owns it (AD-002).
- Carrying the value through mailroom, courier and the socket, and persisting it in the socket history: those are the Engineering Specs of each repository in the Impact Map.
- Rendering or interpreting `customData`: it belongs to the integrator's custom webchat. `webchat-react` ignores the field and needs no change.
- Outgoing messages (`sendMessage`, `sendAttachment`, …): they never carry `custom_data`. Streamed responses (`stream_start`/`delta`/`stream_end`) also never carry it, because broadcasts are not streamed.
- `ServiceConfig.customData`: it is an existing initialization option that `src/index.js` never reads, and it is unrelated to this field. It is not changed here.

**Depends on**: weni-webchat-socket sending `message.custom_data` as an optional JSON object in the live `message` frame and in each `history[].message`, as defined in [`socket-to-client.schema.json`](https://github.com/weni-ai/vtex-cx-experience-specs/blob/7f2b14e693270db42ff28b1f0727ed7a6854ef28/specs/007-wwc-custom-data/contracts/messages/socket-to-client.schema.json). The public shape this library produces is defined in [`webchat-service-message.schema.json`](https://github.com/weni-ai/vtex-cx-experience-specs/blob/7f2b14e693270db42ff28b1f0727ed7a6854ef28/specs/007-wwc-custom-data/contracts/messages/webchat-service-message.schema.json). Development and tests use the `examples` in those files as mocks; there is no runtime dependency on the socket change being deployed.

## Current State

- `src/core/MessageProcessor.js` `process` → `_processUserMessage` → `_normalizeMessage` (868-line file) builds a fresh object from `raw.message`. It copies `text`, `media`/`media_url`, `caption`, `quick_replies`, `list_message`, `cta_message`, `interactive.*` and the top-level `raw.metadata`. Any other key in `raw.message`, including `custom_data`, is dropped. `_processQueue` emits `message:processed` for each message.
- `src/index.js` `_setupEventListeners` — on `message:processed` it calls `state.addMessage(msg)` and `session.appendToConversation(msg)`, and then emits `message:received` with the same object. Whatever `_normalizeMessage` returns is what consumers see and what is persisted.
- `src/modules/HistoryManager.js` `processHistory` maps each `history[]` item to a new object (`id`, `type`, `timestamp`, `direction`, `sender`, `text`, `media`, `caption`, `quick_replies`, `list_message`, interactive and order fields) and drops everything else. `request` emits `history:loaded` with that array.
- `src/modules/HistoryManager.js` `merge` — `src/index.js` `getHistory` uses it to combine history with `state.messages`, then calls `state.setState({ messages: merged })` and `session.setConversation(merged)`. A cached copy with the same id wins over the history copy. An uncommitted change in the working tree (not part of this feature) adds one exception: a fresh `media` URL from history replaces the cached one. The `customData` refresh below goes in the same branch of `merge`, so it must be applied on top of that change.
- `src/core/SessionManager.js` `_save` → `StorageManager.set` serializes the whole session, including `conversation[]`, into `localStorage`/`sessionStorage` as JSON. On `QuotaExceededError`, `_handleQuotaExceeded` deletes the oldest 25% of `weni:webchat:` keys.
- `src/types/index.d.ts` `Message` has no `customData` field. `ServiceConfig.customData?: Record<string, any>` exists but is unrelated (see Out of scope).
- `src/utils/helpers.js` already has `isJsonObject` (accepts JSON strings as well as objects, so it does not fit as-is) and `isEmpty`. There is no plain-object guard for wire values.
- Tests: `tests/MessageProcessor.test.js`, `tests/HistoryManager.test.js` and `tests/service.events.test.js` (the `MessageProcessor relays` and `HistoryManager relays` blocks) already cover these paths with a mocked WebSocket. `src/utils/tests/helpers.test.js` covers `helpers.js`.

## Technical Approach

### Components Affected

| Component | Change | Why |
|-----------|--------|-----|
| `src/utils/helpers.js` | modified | One function reads `custom_data` from a wire message body. It returns the object when the value is a plain JSON object and `undefined` otherwise, and reports the kind of a discarded value. Both paths call it, so they cannot drift apart. |
| `src/core/MessageProcessor.js` | modified | `_normalizeMessage` sets `message.customData` from the helper and warns on a discarded value. Only a few lines are added; the logic lives in the helper. |
| `src/modules/HistoryManager.js` | modified | `processHistory` sets `message.customData` from the same helper and warns in the same way. In `merge`, when the cached copy has no `customData` and the history copy has one, the merged message takes it from history. |
| `src/types/index.d.ts` | modified | `Message.customData?: Record<string, unknown>`, with TSDoc that states the inner keys are integrator-owned and not converted. |
| `README.md` | modified | Document `customData` in the `message:received`/`history:loaded` sections and state that it is unrelated to `ServiceConfig.customData`. |
| `CHANGELOG.md` | modified | Entry under `[Unreleased]` → Added. |
| `tests/MessageProcessor.test.js`, `tests/HistoryManager.test.js`, `tests/service.events.test.js`, `src/utils/tests/helpers.test.js` | modified | Cover the acceptance criteria. All are existing files. |

No new source or test file is added, so the TypeScript toolchain obligation in X (TODO_TS_TOOLCHAIN) is not triggered.

### Flow

**Live**

1. The socket frame `{ type: 'message', message: { type, timestamp, text, custom_data } }` reaches `MessageProcessor.process` and is routed to `_processUserMessage`.
2. `_normalizeMessage` builds the message as today. It then calls the helper with `raw.message?.custom_data`:
   - The value is a plain object: set `message.customData` to it, by reference and unchanged. No key renaming, no `unescapeEscapedUrlSlashes`, no deep copy.
   - The value is `undefined` or `null`: do not set the property.
   - The value is anything else: do not set the property, and call `console.warn('MessageProcessor: custom_data discarded', { operation: 'normalize-custom-data', messageType, receivedKind })`.
3. The message is queued. `message:processed` leads to `state.addMessage`, `session.appendToConversation` (which persists `customData` with the message) and `message:received`.

**History**

1. `get_history` is answered by `{ type: 'history', history: [...] }`. `HistoryManager` emits `HISTORY_RESPONSE` and calls `processHistory`.
2. For each item, the same helper runs on `item.message?.custom_data` with the same rules. The warning uses the `HistoryManager:` prefix.
3. `history:loaded` emits the processed array. `getHistory` merges it. When a cached message with the same id has no `customData` and the history message has one, the merged message is `{ ...cached, customData }`. Otherwise the cached copy is kept, as today. `session.setConversation(merged)` persists the result.

### Rejected Alternatives

- **Spreading every unknown `raw.message` key onto the message**: it would leak other snake_case wire fields into the emitted payload and violate XIV.
- **Converting the inner keys to camelCase**: the keys belong to the integrator, and AD-007 forbids converting them.
- **Revalidating size, depth and keys in the library**: AD-002 makes flows the only validator. A second check would have to stay in sync with flows, and the library could not fix a message that is already delivered anyway.
- **Stripping `customData` before writing to browser storage**: a page reload that restores the session would show messages without `customData` until `getHistory` runs. `state.messages` would then disagree with what `message:received` emitted. The storage cost is bounded (see Peak Load).
- **A new `src/utils/customData.ts` module**: the first new source file must also add the TypeScript toolchain to Rollup, Jest and ESLint. That is out of proportion for one guard function; `helpers.js` is 285 lines.
- **Always letting history overwrite the cached `customData`**: the value is immutable per message (AD-004: verbatim, the same for every recipient). Filling it in only when the cached copy has none is enough, and it changes the merge rule as little as possible.

## Contracts

| Interface | Change | Version impact | Backward compatible |
|-----------|--------|----------------|---------------------|
| `Message.customData` in `message:received` payloads | added (optional) | minor | yes: absent unless the wire carries a JSON object; existing fields unchanged |
| `Message.customData` in `history:loaded` payloads | added (optional) | minor | yes: same rule |
| `state.messages` / `getMessages()` entries | added optional `customData` | minor | yes |
| Stored session `conversation[]` entries | added optional `customData` | minor | yes: older library versions keep unknown fields on restored messages and do not read them |
| Socket frames `message` and `history` (consumed) | reads the new optional `message.custom_data` | minor | yes: frames without it behave as today |
| `src/types/index.d.ts` `Message` | added `customData?: Record<string, unknown>` | minor | yes |

The package version goes from 1.19.2 to 1.20.0. The pending `[Unreleased]` Fixed entry ships in the same release.

**Consumers affected**: custom webchats built on `@weni/webchat-service` gain the field once they upgrade to 1.20.0. `webchat-react` (pinned to 1.19.2) ignores it and needs no bump. Integrators learn about the field through the changelog and the API docs that the technical reference publishes after the last deploy of the architecture's Delivery Sequence. This repository's README documents it in the same PR.

## Data Model and Migrations

- **Message (in memory and in the stored session conversation)**: optional `customData`, a plain JSON object owned by the integrator. It has at most 16 KB of compact JSON and at most 32 levels, as guaranteed upstream by flows. `StateManager` owns it in memory and `SessionManager` owns it in storage. The value is never derived or edited by this library.

**Migrations**: none. No storage version bump and no new key. A session stored by an older version has no `customData` and restores as today. A session stored by this version and read by an older one keeps `customData` on the restored message objects, unused and harmless. Rollback is therefore safe in both directions.

## Non-Functional Requirements

### Peak Load

The peak is one shopper tab during a broadcast campaign day (for example Black Friday). Broadcasts reach each contact as single messages, and the peak is 10 broadcast messages with `customData` received by one tab within one hour. Per message, the work is one type check and one property assignment: no traversal, no copy, no parsing beyond the frame's existing `JSON.parse`. The binding limit is browser storage. In the worst case (16 KB per message, 10 messages, stored twice because the live copy keeps its local `msg_…` id and the history copy arrives under the socket `ID`, so the merge does not deduplicate them), the stored conversation grows by about 320 KB. That is about 6% of the usual 5 MB `localStorage` quota per origin, which leaves room for the existing text history. The architecture records the volume risk upstream; this library adds no limit of its own.

### Observability

- A discarded non-object `custom_data` writes `console.warn` with the prefix `MessageProcessor:` or `HistoryManager:` and the context `{ operation: 'normalize-custom-data', messageType, receivedKind }`. `receivedKind` is one of `array`, `string`, `number` or `boolean`. The value and its keys are never logged, because `customData` may hold personal data and is treated as message content (VIII, and the architecture risk "Dado pessoal em conteúdo opaco").
- A missing or `null` value is the normal case and produces no log.
- Correlation: the socket does not send a message id with the live frame (a gap the architecture records and leaves out of scope). The message id the library assigns (`msg_…` live, the socket `ID` in history) is the identifier on the emitted message. The warning context carries `messageType` only, matching the existing `media-ack` warnings.
- `customData` is never added to `error` events or to any diagnostic payload.

### Failure Handling

- Malformed `custom_data` (not an object): this is a permanent contract error, not a retriable one. The field is dropped, a warning is written, and the message is still delivered (architecture: no hop after flows fails a message because of `custom_data`). The library does not retry anything and does not emit `error`.
- An oversized or too-deep value that slipped past flows is not checked here (AD-002). If it ever pushes a session save over the quota, the existing `QuotaExceededError` path in `StorageManager` handles it as it does today. That path is reachable only through an upstream contract violation.
- The `get_history` timeout (30 s), the reconnect behavior and the message queue delays are unchanged. `customData` adds no network operation.

### Security and Authorization

`message.custom_data` crosses the trust boundary at `MessageProcessor._normalizeMessage` and `HistoryManager.processHistory`. There it is accepted only as a plain object (not an array, not `null`, not a primitive). The library never evaluates, renders or interpolates it, and it does not use it as HTML, a URL or a storage key, so it creates no injection surface. The integrator's webchat is responsible for how it renders the value. No authorization check is added: the socket session already scopes frames to the contact, and the architecture states that the value only reaches the message's recipient. No secrets are involved. The value is persisted in browser storage like the message text, with the same session lifetime and the same cleanup (`autoClearCache`, `cacheTimeout`).

## Test Strategy

| Success / acceptance criterion | How this repository proves it |
|--------------------------------|-------------------------------|
| Live `message.custom_data` object becomes `customData` in `message:received`, with keys unchanged and no `custom_data` property | `tests/MessageProcessor.test.js`: process the `LiveMessageFrame` example from `socket-to-client.schema.json` and assert that the `message:processed` payload has `customData` deep-equal to the input (`order_id`, `coupon.expires_at`, `tags`) and no `custom_data`. `tests/service.events.test.js` (MessageProcessor relays): the same payload is emitted as `message:received` and added to state and the session conversation. |
| History `message.custom_data` becomes `customData` in `history:loaded`, and live and history produce the same value | `tests/HistoryManager.test.js` `processHistory`: the `HistoryFrame` example produces `customData` deep-equal to the input. A shared fixture runs through both `_normalizeMessage` and `processHistory`, and the test asserts that both `customData` values are deep-equal. `request` test: `history:loaded` carries it. |
| Missing or `null` gives no `customData` and the output is unchanged | Cases in both test files assert `'customData' in message === false` with no warning. The existing normalization tests stay green without edits, which shows that output for frames without the field is unchanged. |
| Non-object value is dropped, the message is still emitted, and one content-free warning is written | Parameterized cases (`[]`, `'x'`, `42`, `true`) in both files. The message is emitted, it has no `customData`, and `console.warn` is called once with the module prefix and `{ operation: 'normalize-custom-data', messageType, receivedKind }`. A test asserts that no warn argument contains the input value. `src/utils/tests/helpers.test.js` covers the helper directly. |
| `customData` is persisted, survives a session restore, and fills a cached copy on merge | `tests/service.events.test.js`: the session conversation stored after `message:processed` contains `customData`. `tests/HistoryManager.test.js` `merge`: a cached copy without `customData` plus a history copy with it gives `{ ...cached, customData }`. A cached copy that already has it is returned unchanged (same reference). Local-only messages are untouched. |
| Types, MINOR release, changelog, README | `src/types/index.d.ts` diff reviewed in the PR. `CHANGELOG.md` Added entry. `npm run build` emits declarations. Release tag `1.20.0`. |

**Flow coverage**: socket live frame → `MessageProcessor` normalization → queue → `message:received` + state + stored conversation; socket history frame → `processHistory` → `history:loaded` → `getHistory` merge → state + stored conversation.

**Failure paths covered**: non-object `custom_data` of each kind in both paths, with a check that the warning has no content; `null`; missing field; a merge where the history copy has no `customData` and the cached copy keeps its own.

**Stubbed at the boundary**: the WebSocket, through the existing `WebSocketManager` mock and its `emit`; `localStorage`/`sessionStorage`, through the existing Jest environment; `console.warn`, through `jest.spyOn`. No live socket.

## Rollout and Rollback

This repository is step 1 of the architecture's Delivery Sequence. It ships as `1.20.0` on npm, in any order relative to weni-webchat-socket, and before courier, flows and mailroom. Until the upstream hops are deployed, no frame carries `custom_data`, so the release changes nothing at runtime. No feature flag is needed; the deploy order serves as the flag.

Rollback means consumers pin back to 1.19.x. The field then stops reaching their listeners and nothing errors. Sessions stored by 1.20.0 stay readable by 1.19.x (see Migrations). Because consumers upgrade at their own pace, the end-to-end announcement waits for the last deploy of the Delivery Sequence, as the architecture requires.

## Constitution Alignment

| Principle | How this spec complies | Exception + justification |
|-----------|------------------------|---------------------------|
| I. Version Control and Review | Ships through a PR with lint and the coverage gate. | none |
| II. Specification Traceability | Opens with Origin Without Product Spec. The architecture document is linked and pinned to commit `7f2b14e`, to be re-pinned to `007-wwc-custom-data/arch-v1` once that tag exists. | none |
| IV. Versioned Public Contracts | Additive optional field on `Message` (event payloads, state, storage). MINOR, 1.20.0. | none |
| V. Release & Changelog Maintenance | `CHANGELOG.md` Added entry in the same PR. Rollout states that no consumer update is required and that the announcement is coordinated with the other repositories. | none |
| VIII. Observability | One structured warning per discarded value, with the module prefix and no content or keys. `customData` is never logged or attached to `error`. | none |
| IX. Code as Documentation | JSDoc on the new helper. TSDoc on `Message.customData` explains why inner keys are not converted. | none |
| X. Type Safety | `src/types/index.d.ts` updated in the same PR, with `Record<string, unknown>` and not `any`. No new file, so the TypeScript toolchain is not triggered. | none |
| XI. Single Responsibility | The guard lives in `helpers.js`. `MessageProcessor.js` (868 lines) and `HistoryManager.js` only add the call and the assignment. | `MessageProcessor.js` grows by a few lines while it is already over 500. The new responsibility is extracted to `helpers.js`; only the call site remains. |
| XII. Naming Conventions | `customData` and a descriptive helper name in camelCase. | none |
| XIV. WebSocket Contract & Data Boundaries | `custom_data` is validated as a plain object and renamed to `customData` at the two normalization boundaries. The snake_case name never reaches state or emitted payloads. The integrator's inner keys are data, not library fields, so they are not normalized (AD-007). | none |
| XV. State Management & Async Correctness | The value flows through the existing `StateManager`/`SessionManager` paths and is not duplicated. The merge rule keeps state consistent with `history:loaded`. | none |
| XVI. Resilience & Error Handling | A malformed value is treated as a permanent contract error: dropped, warned and never retried. The message is still delivered. | none |
| Testing | Behavior tests in the existing test files for both paths and for merge and persistence, including failure cases. No live socket. | Tests stay in the top-level `tests/` because the modules are not substantially changed (the constitution only says SHOULD move). |
| Defensive Programming | The type guard sits at the WebSocket boundary, where a non-object value can actually arrive (for example from an older or buggy socket). Size and depth are not guarded, because flows guarantees them. | none |
| Maintainability | One helper is the single source of truth for the acceptance rule in both paths. | none |

## Implementation Decisions

- **Plain-object guard**: accept `value !== null && typeof value === 'object' && !Array.isArray(value)`. `isJsonObject` is not reused because it also parses strings, and a string `custom_data` must be dropped, not parsed.
- **`null` is silent**: a Go socket can serialize an unset map as `null`. Warning on it would add log noise to every message, so `null` is treated as absent.
- **An empty object is passed through**: flows treats `{}` as absent, so it should never arrive. If it does, the contract only excludes non-objects, so the library does not invent a stricter rule.
- **By reference, not copied**: each frame is a freshly parsed object that nothing else holds. Copying 16 KB per message would cost time and change nothing for the consumer.
- **The merge fills in, it does not overwrite**: the value is verbatim and immutable per message (AD-004). History only adds `customData` when the cached copy lacks it, which happens for a copy cached by a version before 1.20.0.
- **Split messages are not regrouped**: following AD-005, the library exposes `customData` only on the part that carries it (the last one) and does not copy it to the attachment parts.
