# Tasks: Move logic to service

**Input**: Design documents from `/specs/003-move-logic-to-service/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/storefront-api.md, contracts/voice-session.md, quickstart.md

**Tests**: Included. The spec's test strategy and the constitution require the new suites to fail before the behavior exists.

**Organization**: `spec.md` has no user-story headings. Tasks are grouped by the acceptance criteria so each slice can be tested and shipped on its own. US1 and US2 are the first minor. US3 is the second minor.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/` at repository root. New tests are colocated under `src/modules/<area>/tests/*.test.ts`. Existing top-level `tests/` stays.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Make Rollup, Jest, and ESLint accept TypeScript before any feature module

- [x] T001 Add devDependencies `@rollup/plugin-typescript`, `@babel/preset-typescript`, and `typescript-eslint` in `package.json` (`typescript` is already present)
- [x] T002 [P] Register `@rollup/plugin-typescript` in `rollup.config.js` and keep `input` as `src/index.js`
- [x] T003 [P] Add `@babel/preset-typescript` to `babel.config.js` so `babel-jest` transforms `.ts`
- [x] T004 [P] Extend `testMatch` and `collectCoverageFrom` in `jest.config.js` to include `src/**/*.test.ts` and `src/**/*.ts`
- [x] T005 [P] Lint `.ts` from `eslint.config.mjs` and add `.ts` to the `lint` script in `package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Toolchain proof and the storage key both later stories persist through

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Allow `src/**/tests` in `tsconfig.json` and keep the top-level `tests/` directory excluded
- [x] T007 Add a failing smoke test in `src/modules/storefront/tests/toolchain.test.ts` that writes and reads one JSON value through `src/core/StorageManager.js`
- [x] T008 Implement read/write of the key `weni:webchat:storefront` in `src/core/StorageManager.js`. Constraint from `data-model.md`: missing or invalid JSON loads as an empty snapshot and an empty cart. The session conversation blob is not modified

**Checkpoint**: `npm test -- --testPathPattern=toolchain` passes and `npm run build` still emits the three `dist/` bundles

---

## Phase 3: User Story 1 - Resolve the product page and request starters (Priority: P1) 🎯 MVP

**Goal**: A VTEX product document becomes a snapshot, `getStarters` runs only when the fingerprint changes, leaving the PDP clears starters, and checkout emits `storefront:entered-checkout`

**Independent Test**: `npm test -- --testPathPattern='src/modules/(storefront/tests/productResolution|conversation/tests/starterSession)'` — one starters send per fingerprint, no send off a product page, one checkout event

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T009 [P] [US1] Add failing product-resolution tests in `src/modules/storefront/tests/productResolution.test.ts` for account, product path, SKU, seller, and availability. Constraint from `data-model.md`: `account` is required before `getStarters` and an empty string is treated as missing; `skuId` is null off a product page
- [x] T010 [P] [US1] Add failing tests in `src/modules/conversation/tests/starterSession.test.ts`: a new `account:productPath` calls the existing `getStarters`; the same path does not send again; `isProductPage` false calls `clearStarters`; `isCheckout` true emits `storefront:entered-checkout` once per entry and does not call `getStarters`

### Implementation for User Story 1

- [x] T011 [P] [US1] Implement host-document resolution in `src/modules/storefront/VtexPageReader.ts` using the signals `webchat-react/src/utils/vtex.js` uses today (URL, JSON-LD, `__NEXT_DATA__`, VTEX state, FastStore account). Emit the snapshot fields from `data-model.md`
- [x] T012 [P] [US1] Implement `src/modules/conversation/StarterSession.ts` so it calls existing `getStarters` / `clearStarters` from the snapshot fingerprint. Do not change `src/utils/messageBuilder.js` `buildStartersRequest`
- [x] T013 [US1] Add `storefront:changed` and `storefront:entered-checkout` to `SERVICE_EVENTS` in `src/utils/constants.js`. Checkout payload is `{ at: number }` with no cart contents, per `contracts/storefront-api.md`
- [x] T014 [US1] Delegate `watchStorefront`, `unwatchStorefront`, and `getStorefrontSnapshot` from `src/index.js`. `watchStorefront` is idempotent. Do not paste resolution logic into the facade. A VTEX HTTP timeout is 10s with one retry only for a network failure on product resolution; the second failure keeps the previous snapshot
- [x] T015 [US1] Declare the new methods and events in `src/types/index.d.ts`

**Checkpoint**: Starters and checkout work without the cart methods. `getStarters(productData)` still works for a caller that does not call `watchStorefront`

---

## Phase 4: User Story 2 - Pending cart, flush, and availability (Priority: P2)

**Goal**: Pending quantities follow the widget's debounce and flush rules, and back-in-stock notify is a service method

**Independent Test**: `npm test -- --testPathPattern=src/modules/storefront/tests/orderForm` — conversation items wait 5000 ms, a repeated flush does not send twice, a timeout emits `cart:failed`

### Tests for User Story 2 ⚠️

- [x] T016 [US2] Add failing tests in `src/modules/storefront/tests/orderForm.test.ts`. Constraints from `data-model.md`: `quantity` is an integer ≥ 0 and a non-numeric quantity becomes 0; `origin` is `conversation` or `catalog`; conversation origin waits 5000 ms; catalog origin flushes on page leave; a second flush of the same key and quantity does not send again; failure emits `cart:failed` with the key and the item stays pending

### Implementation for User Story 2

- [x] T017 [P] [US2] Implement pending cart, FastStore bootstrap, and the VTEX IO minicart bridge in `src/modules/storefront/OrderForm.ts`. Persist the map in `weni:webchat:storefront` beside the snapshot. Do not retry a cart flush. Custom fields and UTM go out through the existing `setCustomField` and message queue
- [x] T018 [P] [US2] Implement `requestAvailabilityNotify` in `src/modules/storefront/AvailabilityNotify.ts` with the same HTTP call as `webchat-react/src/utils/availabilityNotify.js`, a 10s timeout, and no retry
- [x] T019 [US2] Delegate `setPendingCartItem`, `flushPendingCart`, and `requestAvailabilityNotify` from `src/index.js`, and add `cart:updated` and `cart:failed` to `SERVICE_EVENTS` in `src/utils/constants.js`. `cart:failed` payload is `{ key, operation: "flush" | "notify" }`
- [x] T020 [US2] Add those method and event types in `src/types/index.d.ts`. Warn on failure with `{ operation, connectionState }` and no cart contents

**Checkpoint**: Storefront slice is complete and can be published without the voice module

---

## Phase 5: User Story 3 - Voice session (Priority: P3)

**Goal**: Capture, speech-to-text, echo guarding, and speech synthesis run in this library and emit state the widget can render

**Independent Test**: `npm test -- --testPathPattern=src/modules/voice/tests` — denial emits `voice:error`, a final transcript does not call `sendMessage`, exit ends in `idle`

### Tests for User Story 3 ⚠️

- [x] T021 [US3] Add failing tests in `src/modules/voice/tests/voiceSession.test.ts`. Constraints from `data-model.md`: states are `idle`, `listening`, `speaking`, and `error`; `voice:transcript` carries `{ text }` for a final transcript only and partial transcripts are not emitted; permission denial or a missing capture API emits `voice:error` and does not start capture; playback failure emits `voice:error` and returns to `listening`

### Implementation for User Story 3

- [x] T022 [US3] Port `webchat-react/src/services/voice/` into `src/modules/voice/` as one TypeScript file per current module: `VoiceService.ts`, `AudioCapture.ts`, `STTConnection.ts`, `TTSPlayer.ts`, `TextChunker.ts`, `EchoGuard.ts`, `SessionGuard.ts`, `errors.ts`, and `config.ts`. Do not merge `TTSPlayer` and `VoiceService` into one file. A coordinator, if added, only delegates and stays under 350 lines. Do not persist transcripts or tokens. STT drops use the existing `RetryStrategy` defaults and stop after `maxReconnectAttempts`
- [x] T023 [US3] Delegate `enterVoiceSession`, `exitVoiceSession`, and `speakIncomingText` from `src/index.js`. Add `voice:state`, `voice:transcript`, and `voice:error` to `SERVICE_EVENTS` in `src/utils/constants.js` and `src/types/index.d.ts`. Do not call `sendMessage` from this module. `exitVoiceSession` is safe from `idle`. Log context must not include the transcript or tokens

**Checkpoint**: Voice is a second minor. Push-to-talk `sendAudio` / `startRecording` / `stopRecording` stay as they are

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Release notes and the quickstart gate

- [x] T024 [P] Document the storefront methods and events in `README.md` and add an Added entry to `CHANGELOG.md` for the first minor. Do not list voice methods in that entry
- [ ] T025 Run the storefront commands in `specs/003-move-logic-to-service/quickstart.md`, including `tests/service.sendPaths.test.js` and `tests/MessageProcessor.test.js`, and confirm coverage stays at or above 80%
- [x] T026 [P] After User Story 3, add the voice methods to `README.md` and a second Added entry in `CHANGELOG.md`
- [ ] T027 Run the voice and regression commands in `specs/003-move-logic-to-service/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first. T002–T005 can follow in parallel.
- **Foundational (Phase 2)**: Depends on Setup. Blocks every story.
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on US2 or US3.
- **User Story 2 (Phase 4)**: Depends on Foundational. Uses the same storage key as US1 but is testable with a fixture snapshot.
- **User Story 3 (Phase 5)**: Depends on Foundational only. Do not publish it in the US1+US2 minor.
- **Polish**: T024–T025 after US2. T026–T027 after US3.

### User Story Dependencies

- **User Story 1 (P1)**: First shippable slice of page resolution and starters.
- **User Story 2 (P2)**: Cart and notify. Ships in the same minor as US1.
- **User Story 3 (P3)**: Voice. Starts after the first minor is in production, per `plan.md`.

### Parallel Opportunities

- T002, T003, T004, and T005 touch different config files.
- T009 and T010 are different test files.
- T011 and T012 are different modules.
- T017 and T018 are different modules.
- US3 does not edit the storefront modules.

---

## Parallel Example: User Story 1

```bash
# Tests together, then the two modules together:
Task: "T009 productResolution.test.ts"
Task: "T010 starterSession.test.ts"
Task: "T011 VtexPageReader.ts"
Task: "T012 StarterSession.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3.
3. Stop and run the User Story 1 independent test.

### Incremental Delivery

1. US1 + US2 → T024 and T025 → publish the storefront minor.
2. Widget spec `webchat-react` `specs/010-move-logic-to-service` adopts that minor.
3. US3 → T026 and T027 → publish the voice minor.

### Parallel Team Strategy

After Phase 2, one person can own `VtexPageReader.ts` and another `StarterSession.ts`. Cart (US2) should wait until the snapshot type from US1 is in place. Voice can be developed on a branch that does not publish early.

---

## Notes

- [P] tasks = different files, no dependencies
- Tests fail before the matching implementation task
- Do not grow `src/index.js` with rule bodies
- Commit after each task or logical group
