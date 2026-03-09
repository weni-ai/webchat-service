# Implementation Plan: PDP Conversation Starters Bridge

**Branch**: `001-pdp-starters-bridge` | **Date**: 2026-03-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-pdp-starters-bridge/spec.md`

## Summary

Add a `getStarters(productData)` public method to `WeniWebchatService` that sends a `get_pdp_starters` message over the existing WebSocket connection and handles the asynchronous `starters` response from the server. This bridges webchat-react's product detection layer to the already-implemented `GetPDPStarters` handler in weni-webchat-socket, eliminating the need for a separate HTTP endpoint and extra configuration in the frontend.

## Technical Context

**Language/Version**: JavaScript (ES2020), TypeScript declarations  
**Primary Dependencies**: `eventemitter3` (runtime), Jest (testing), Rollup (build)  
**Storage**: N/A (no persistence needed for starters — fire-and-forget request/response)  
**Testing**: Jest with mocked WebSocket  
**Target Platform**: Browser (all modern browsers via ES2020, Rollup bundles: CJS, ESM, UMD)  
**Project Type**: Library (NPM package `@weni/webchat-service`)  
**Performance Goals**: Zero added latency beyond JSON serialization; starters response passes through without processing  
**Constraints**: No new runtime dependencies; library size increase must be minimal  
**Scale/Scope**: ~5 files modified, ~2 new files, ~150-200 lines of new code

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Clear, Idiomatic JavaScript Modules** | PASS | New code follows existing patterns: JSDoc on exported methods, single-responsibility (starters builder in messageBuilder, handling in WebSocketManager, public API in index.js). No file will exceed 500 lines. |
| **II. WebSocket Contract & Configuration Discipline** | PASS | Outgoing `get_pdp_starters` and incoming `starters` payloads are documented in contracts/. Validation at boundary (FR-002, FR-006). No new configuration needed — reuses existing WebSocket connection. |
| **III. Security & Least Privilege** | PASS | No secrets, tokens, or credentials involved. Product data (account, linkText, productName) is non-sensitive. Error events exclude internal state. |
| **IV. Test-First Quality Gates** | PASS | Plan includes unit tests for: validation, payload construction, starters response handling, stale response filtering, connection-state guards. Tests will be written before implementation. |
| **V. Resilience & Error Handling** | PASS | Explicit error paths: validation errors (throw), connection-state errors (throw), server errors (emitted via `starters:error`). Stale response handling via request fingerprinting. No silent swallowing. |
| **VI. Release & Package Distribution** | PASS | New public method and events are additive (MINOR version bump). No breaking changes. Consumer follow-up documented: webchat-react needs to call `getStarters()` and listen to `starters:received`. |

**Gate Result**: All gates PASS. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/001-pdp-starters-bridge/
├── plan.md              # This file
├── research.md          # Phase 0 output - design decisions
├── data-model.md        # Phase 1 output - entity definitions
├── quickstart.md        # Phase 1 output - usage guide
├── contracts/           # Phase 1 output - public API contract
│   └── starters-api.md  # getStarters() method and events contract
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── index.js                    # [MODIFY] Add getStarters() method, wire starters events
├── core/
│   └── WebSocketManager.js     # [MODIFY] Handle incoming 'starters' message type
├── utils/
│   ├── constants.js            # [MODIFY] Add SERVICE_EVENTS.STARTERS_RECEIVED, STARTERS_ERROR, WS_MESSAGE_TYPES.GET_PDP_STARTERS
│   ├── messageBuilder.js       # [MODIFY] Add buildStartersRequest() function
│   └── validators.js           # [MODIFY] Add validateStartersData() function
└── types/
    └── index.d.ts              # [MODIFY] Add StartersData interface, getStarters() method signature

tests/
├── starters.test.js            # [NEW] Unit tests for starters flow
└── messageBuilder.test.js      # [MODIFY] Add tests for buildStartersRequest()
```

**Structure Decision**: Single project, no new modules. The starters feature is thin enough to integrate into existing modules following established patterns (similar to how `getHistory()` works through `WebSocketManager` and `messageBuilder`).

## Design Decisions

### 1. Starters handling in WebSocketManager vs MessageProcessor

**Decision**: Handle `starters` responses directly in `WebSocketManager._handleMessage()`, not through `MessageProcessor`.

**Rationale**: Starters are metadata responses (like `project_language` or `ready_for_message`), not chat messages. They should not enter the message queue, be normalized, or be stored in state. The existing pattern for non-message WebSocket responses is to intercept them in `_handleMessage()` and emit a dedicated event. This keeps `MessageProcessor` focused on chat message processing.

### 2. Request fingerprinting strategy

**Decision**: Store the latest request fingerprint (`account:linkText`) on the service instance. When a `starters` response arrives, the server does not include the request context in the response, so we cannot match response-to-request directly. Instead, we track only the *latest* request fingerprint. If the service receives a starters response but the user has already navigated away (fingerprint was cleared or changed), the response is silently discarded.

**Rationale**: The socket server's per-client deduplication (`StartersInFlight`) ensures only one starters request is in-flight per client at a time. When a second `getStarters()` is called, the server ignores it (already in-flight). The client-side fingerprint handles the case where the user navigated away before the response arrived — we track whether the response is still relevant based on whether `_latestStartersFingerprint` is still set.

### 3. Error discrimination for starters vs generic errors

**Decision**: Emit `starters:error` only for errors that explicitly contain "conversation starters" in the error message. All other `error` type messages continue through the existing error pipeline.

**Rationale**: The socket server's `GetPDPStarters` handler wraps all starters errors with the prefix "failed to generate conversation starters:". This is a reliable discriminator. Generic errors (registration, connection) should not trigger `starters:error`.

### 4. No queueing of starters requests

**Decision**: `getStarters()` throws immediately if not connected, rather than queueing.

**Rationale**: Unlike chat messages (which users expect to be delivered eventually), starters are ephemeral and page-context-dependent. Queueing a starters request for a product page the user may have already navigated away from would be wasteful. The frontend should re-request after reconnection if still on a PDP.

### 5. Version impact

**Decision**: MINOR version bump (additive change).

**Rationale**: New public method (`getStarters`), new events (`starters:received`, `starters:error`), and new constants are all additive. No existing behavior changes. No breaking changes to existing consumers.

### 6. Consumer follow-up

**Required change in webchat-react**:
- Replace HTTP-based starters fetch (`conversationStartersConfig.endpoint`) with `service.getStarters(productData)`
- Listen to `service.on('starters:received', ({ questions }) => ...)` 
- Listen to `service.on('starters:error', (error) => ...)` for graceful fallback
- Implement client-side debounce before calling `getStarters()`
- Clear starters UI on SPA navigation before re-requesting

## Complexity Tracking

No complexity violations. All changes fit within existing module boundaries with no new dependencies, no new modules, and no architectural changes.
