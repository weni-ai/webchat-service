# Tasks: PDP Conversation Starters Bridge

**Input**: Design documents from `/specs/001-pdp-starters-bridge/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/starters-api.md, quickstart.md

**Tests**: Included per Constitution Principle IV (Test-First Quality Gates).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root

---

## Phase 1: Foundational (Shared Infrastructure)

**Purpose**: Constants, types, validator, and payload builder that ALL user stories depend on. No user story work can begin until this phase is complete.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T001 [P] Add `STARTERS_RECEIVED`, `STARTERS_ERROR` to `SERVICE_EVENTS` and `GET_PDP_STARTERS`, `STARTERS` to `WS_MESSAGE_TYPES` in `src/utils/constants.js`
- [x] T002 [P] Add `validateStartersData(productData)` function in `src/utils/validators.js` — must throw `Error('Product data is required')` if falsy, `Error('account is required and must be a non-empty string')` if account missing/empty, `Error('linkText is required and must be a non-empty string')` if linkText missing/empty (see `contracts/starters-api.md` for exact error messages)
- [x] T003 [P] Add `buildStartersRequest(sessionId, productData)` function in `src/utils/messageBuilder.js` — must return `{ type: 'get_pdp_starters', from: sessionId, data: { account, linkText, productName?, description?, brand?, attributes? } }` (see `data-model.md` outgoing payload)
- [x] T004 [P] Add `StartersData` interface, `getStarters(productData: StartersData): void`, `clearStarters(): void` method signatures, and `STARTERS_RECEIVED`/`STARTERS_ERROR` events to `src/types/index.d.ts`

**Checkpoint**: Foundation ready — all constants, types, validators, and builders are in place.

---

## Phase 2: User Story 1 — Request PDP Starters via WebSocket (Priority: P1) 🎯 MVP

**Goal**: A connected client can call `getStarters(productData)` and receive a `starters:received` event with generated questions, or a `starters:error` event on failure.

**Independent Test**: Call `service.getStarters({ account: 'brandless', linkText: 'ipad-10th-gen' })` after connection, verify `starters:received` fires with `{ questions: [...] }`.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T005 [P] [US1] Write test: `getStarters()` with valid data sends `get_pdp_starters` WebSocket message with correct payload shape in `tests/starters.test.js`
- [x] T006 [P] [US1] Write test: incoming `starters` message with `data.questions` emits `starters:received` event with `{ questions: [...] }` in `tests/starters.test.js`
- [x] T007 [P] [US1] Write test: incoming `error` message containing "starters" emits `starters:error` with `{ error: '...' }` in `tests/starters.test.js`
- [x] T008 [P] [US1] Write test: incoming `error` message NOT containing "starters" does NOT emit `starters:error` (passes through existing error pipeline) in `tests/starters.test.js`
- [x] T009 [P] [US1] Write tests for `validateStartersData()`: throws on falsy input, throws on missing/empty `account`, throws on missing/empty `linkText`, passes with valid data in `tests/starters.test.js`
- [x] T010 [P] [US1] Write tests for `buildStartersRequest()`: correct payload shape, optional fields omitted when not provided, all fields included when provided in `tests/messageBuilder.test.js`

### Implementation for User Story 1

- [x] T011 [US1] Add `starters` type handling in `WebSocketManager._handleMessage()` in `src/core/WebSocketManager.js` — intercept `data.type === 'starters'` before the generic `MESSAGE` emit, emit `SERVICE_EVENTS.STARTERS_RECEIVED` with `data.data` (follows same pattern as `project_language` handler at line 334)
- [x] T012 [US1] Add starters-related error discrimination in `WebSocketManager._handleMessage()` in `src/core/WebSocketManager.js` — in the existing `data.type === 'error'` block, check if `data.error` contains "starters", and if so emit `SERVICE_EVENTS.STARTERS_ERROR` with `{ error: data.error }` before the generic error emit (see `research.md` R3 for discrimination strategy)
- [x] T013 [US1] Add `getStarters(productData)` public method to `WeniWebchatService` class in `src/index.js` — validates with `validateStartersData()`, checks `this.isConnected()`, builds payload with `buildStartersRequest()`, sends via `this.websocket.send()` (see `contracts/starters-api.md` for full behavior spec)
- [x] T014 [US1] Wire `STARTERS_RECEIVED` and `STARTERS_ERROR` events from `WebSocketManager` to `WeniWebchatService` in `_setupEventListeners()` in `src/index.js` — forward `this.websocket.on(SERVICE_EVENTS.STARTERS_RECEIVED, ...)` and `this.websocket.on(SERVICE_EVENTS.STARTERS_ERROR, ...)` to `this.emit(...)` (follows same pattern as `LANGUAGE_CHANGED` at line 942)

**Checkpoint**: At this point, the core send/receive flow is functional. `getStarters()` sends the request, and `starters:received`/`starters:error` events are emitted on response.

---

## Phase 3: User Story 2 — Graceful Handling of Connection and Readiness (Priority: P2)

**Goal**: `getStarters()` throws a clear error when called before the WebSocket connection is established.

**Independent Test**: Call `service.getStarters(validData)` before `connect()`, verify it throws `Error('WebSocket not connected')`.

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T015 [P] [US2] Write test: `getStarters()` throws `'WebSocket not connected'` when service is not connected in `tests/starters.test.js`
- [x] T016 [P] [US2] Write test: `getStarters()` throws `'WebSocket not connected'` when service is in `connecting` state in `tests/starters.test.js`
- [x] T017 [P] [US2] Write test: `getStarters()` throws `'WebSocket not connected'` after disconnect in `tests/starters.test.js`

### Implementation for User Story 2

- [x] T018 [US2] Verify the `this.isConnected()` guard in `getStarters()` covers all non-connected states in `src/index.js` — the guard added in T013 should already throw `Error('WebSocket not connected')` when `_connected` is false or WebSocket status is not `'connected'`; verify edge cases (connecting, reconnecting, disconnected) are all covered by the existing `isConnected()` check

**Checkpoint**: At this point, connection-state validation is confirmed. All non-connected states throw clear errors.

---

## Phase 4: User Story 3 — SPA Navigation Clears Stale Starters (Priority: P3)

**Goal**: When the user navigates between product pages, only the latest starters request produces an event. Previous in-flight responses are silently discarded.

**Independent Test**: Call `getStarters({ account: 'a', linkText: 'product-a' })`, then `clearStarters()`, then simulate a `starters` response — verify no `starters:received` is emitted.

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T019 [P] [US3] Write test: `clearStarters()` prevents in-flight `starters` response from emitting `starters:received` in `tests/starters.test.js`
- [x] T020 [P] [US3] Write test: calling `getStarters()` for product B after product A updates the fingerprint, and only product B's response emits `starters:received` in `tests/starters.test.js`
- [x] T021 [P] [US3] Write test: `starters:error` also clears the fingerprint (no stale error events) in `tests/starters.test.js`

### Implementation for User Story 3

- [x] T022 [US3] Add `_latestStartersFingerprint` property (initialized to `null`) and `clearStarters()` public method to `WeniWebchatService` in `src/index.js` — `clearStarters()` sets `_latestStartersFingerprint = null` (see `contracts/starters-api.md` clearStarters behavior)
- [x] T023 [US3] Update `getStarters()` to set `this._latestStartersFingerprint = productData.account + ':' + productData.linkText` before sending in `src/index.js`
- [x] T024 [US3] Add fingerprint check to `STARTERS_RECEIVED` event forwarding in `_setupEventListeners()` in `src/index.js` — only emit `starters:received` if `this._latestStartersFingerprint` is not null; clear fingerprint after emitting
- [x] T025 [US3] Add fingerprint check to `STARTERS_ERROR` event forwarding in `_setupEventListeners()` in `src/index.js` — only emit `starters:error` if `this._latestStartersFingerprint` is not null; clear fingerprint after emitting

**Checkpoint**: All user stories are functional. Stale responses are discarded, navigation is safe.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Ensure all tests pass, verify end-to-end flow, validate quickstart scenarios.

- [x] T026 Run full test suite (`npm test`) and verify all new starters tests pass alongside existing tests
- [x] T027 Run linter (`npm run lint`) and fix any style issues in modified files
- [x] T028 Verify TypeScript declarations in `src/types/index.d.ts` compile without errors
- [x] T029 Validate quickstart.md scenarios manually: basic usage, SPA navigation, error handling, required fields

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: No dependencies — can start immediately. All 4 tasks (T001–T004) run in parallel.
- **US1 (Phase 2)**: Depends on Phase 1 completion. Tests (T005–T010) run in parallel, then implementation (T011–T014) is sequential.
- **US2 (Phase 3)**: Depends on US1 (Phase 2) completion — the `getStarters()` method must exist before connection guards can be verified.
- **US3 (Phase 4)**: Depends on US1 (Phase 2) completion — the `getStarters()` method and event wiring must exist before fingerprinting can be added.
- **Polish (Phase 5)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Phase 1 — core send/receive flow.
- **User Story 2 (P2)**: Depends on US1 — connection guard is inside `getStarters()` which US1 creates.
- **User Story 3 (P3)**: Depends on US1 — fingerprinting augments `getStarters()` and event wiring which US1 creates. Can run in parallel with US2 (different code paths).

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Implementation tasks are sequential (each builds on the previous)

### Parallel Opportunities

- **Phase 1**: All 4 tasks (T001–T004) touch different files — full parallelism
- **Phase 2 tests**: All 6 test tasks (T005–T010) can run in parallel (T005–T009 in same file but different describe blocks, T010 in separate file)
- **Phase 3 + Phase 4**: US2 and US3 can run in parallel after US1 completes (US2 modifies connection guard, US3 adds fingerprinting — different concerns)
- **Phase 4 tests**: All 3 test tasks (T019–T021) can run in parallel

---

## Parallel Example: Phase 1 (Foundation)

```text
# Launch all foundational tasks in parallel (different files):
Task T001: "Add starters constants in src/utils/constants.js"
Task T002: "Add validateStartersData in src/utils/validators.js"
Task T003: "Add buildStartersRequest in src/utils/messageBuilder.js"
Task T004: "Add StartersData types in src/types/index.d.ts"
```

## Parallel Example: Phase 2 Tests (US1)

```text
# Launch all US1 tests in parallel:
Task T005: "Test getStarters sends correct payload"
Task T006: "Test starters:received event"
Task T007: "Test starters:error event"
Task T008: "Test generic error not misattributed"
Task T009: "Test validateStartersData"
Task T010: "Test buildStartersRequest"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Foundational (T001–T004) — 4 tasks, all parallel
2. Complete Phase 2: US1 tests (T005–T010) — 6 tasks, all parallel
3. Complete Phase 2: US1 implementation (T011–T014) — 4 tasks, sequential
4. **STOP and VALIDATE**: Test US1 independently — `getStarters()` sends request, `starters:received` fires
5. Deploy/demo if ready — this alone delivers the full core value

### Incremental Delivery

1. Complete Phase 1 + Phase 2 → MVP: core starters flow works ✅
2. Add Phase 3 (US2) → Connection guards confirmed ✅
3. Add Phase 4 (US3) → SPA navigation is safe ✅
4. Phase 5 → Polish and validate ✅

### Version Impact

- MINOR version bump after all phases complete
- No breaking changes — all additions are purely additive
- Consumer follow-up in webchat-react: replace HTTP starters with `service.getStarters()` + event listeners

---

## Summary

| Metric | Count |
|--------|-------|
| **Total tasks** | 29 |
| **Phase 1 (Foundation)** | 4 |
| **Phase 2 (US1 — MVP)** | 10 (6 tests + 4 implementation) |
| **Phase 3 (US2)** | 4 (3 tests + 1 verification) |
| **Phase 4 (US3)** | 7 (3 tests + 4 implementation) |
| **Phase 5 (Polish)** | 4 |
| **Files modified** | 6 (`constants.js`, `validators.js`, `messageBuilder.js`, `WebSocketManager.js`, `index.js`, `index.d.ts`) |
| **Files created** | 1 (`tests/starters.test.js`) |
| **Parallel opportunities** | Phase 1 (4 tasks), US1 tests (6 tasks), US2 tests (3 tasks), US3 tests (3 tasks), US2+US3 phases |

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Verify tests fail before implementing
- Commit after each phase checkpoint
- The `isConnected()` guard (US2) is structurally part of `getStarters()` created in US1; US2 phase confirms coverage rather than adding new code
