# Tasks: Back-in-stock logic and request in the service

**Input**: Design documents from `/specs/003-back-in-stock-to-service/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/back-in-stock-api.md, quickstart.md

**Tests**: Included. The spec's test strategy names the test files, and the constitution requires unit tests for this logic. Write each test so it fails before the implementation task that follows it.

**Organization**: The engineering spec has no user-story headings. The stories below are the acceptance slices, in the order a shopper hits them: decide the offer, validate the contact, send the subscription.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Make Rollup, Jest, ESLint, and `tsc` accept the first TypeScript files

- [ ] T001 Add runtime dependency `libphonenumber-js` and devDependencies `@babel/preset-typescript`, `@rollup/plugin-babel`, and `typescript-eslint` in `package.json`, add scripts `typecheck` (`tsc --noEmit`) and `lint` (`eslint src tests --ext .js,.ts`), then run `npm install`
- [ ] T002 [P] Add `@babel/preset-typescript` after `@babel/preset-env` in `babel.config.js` so Babel runs the TypeScript preset first
- [ ] T003 [P] Set `noEmit: true`, `allowJs: false`, and `isolatedModules: true` in `tsconfig.json`, remove `rootDir`, and set `include` to `src/**/*.ts`
- [ ] T004 [P] In `jest.config.js`, match `tests/**/*.test.ts`, transform `^.+\\.(js|ts)$` with `babel-jest`, and add `src/**/*.ts` to `collectCoverageFrom`
- [ ] T005 [P] Parse `src/**/*.ts` and `tests/**/*.ts` with `typescript-eslint` in `eslint.config.mjs`, keeping the existing Prettier rules
- [ ] T006 [P] In `rollup.config.js`, compile `.ts` with `@rollup/plugin-babel` (`extensions: ['.js', '.ts']`). Emit CJS and ESM with `eventemitter3` and `libphonenumber-js/max` external. Emit UMD with only `eventemitter3` external so the phone library is bundled

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared error type, event names, and proof that a `.ts` file survives typecheck, lint, and the three bundles

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T007 Create `src/modules/backInStock/error.ts` exporting `BackInStockError` with `code` of `VALIDATION`, `HTTP`, `TIMEOUT`, or `NETWORK`, plus optional `skuId`, `status`, `attempt`, and `fields`. Constraint from `data-model.md`: `fields` is `{ name?: 'required', phone?: 'invalid', skuId?: 'required' }`
- [ ] T008 [P] Add `BACK_IN_STOCK_SUBSCRIBED: 'backInStock:subscribed'` and `BACK_IN_STOCK_ERROR: 'backInStock:error'` to `SERVICE_EVENTS` in `src/utils/constants.js`, plus defaults `subscribePath` `/_v/private/availability-notify/subscribe`, `timeoutMs` `10000`, `maxRetries` `2`, and `retryBaseDelayMs` `500`
- [ ] T009 Run `npm run typecheck`, `npm run lint`, and `npm run build`, and confirm `dist/index.cjs.js` and `dist/index.esm.js` import `libphonenumber-js/max` only once the contact module exists (this task only checks the bundles emit and the error module typechecks)

**Checkpoint**: Toolchain builds `.ts`. Story work can start

---

## Phase 3: User Story 1 - Decide the offer (Priority: P1) 🎯 MVP

**Goal**: `evaluateBackInStockOffer` returns the same unavailable verdict, SKU, and seller the widget computes today

**Independent Test**: `npm test -- --testPathPattern=backInStock.offer --coverage=false`

### Tests for User Story 1 ⚠️

> **NOTE: Write this test FIRST, ensure it FAILS before T011**

- [ ] T010 [US1] Write `tests/backInStock.offer.test.ts` for quantity `0` (`isUnavailable: true`), quantity above `0`, unknown quantity, unmatched SKU, missing sellers, `null` product, missing `items`, and non-array `sellers` (all `isUnavailable: false` and no throw). Include a leading-zero match (`"000326125867"` vs `"326125867"`) and an alphanumeric SKU that is not stripped. Seller cases: `sellerDefault`, else the first seller, else `'1'`

### Implementation for User Story 1

- [ ] T011 [US1] Implement `evaluateBackInStockOffer` in `src/modules/backInStock/offer.ts`. Constraint from `data-model.md`: `isUnavailable` is `true` only when a matched item has `availableQuantity <= 0`. Unmatched SKU, missing sellers, unknown quantity, or a product that is not an object returns `false` and never throws. `skuId` is `selectedSkuId` with leading zeros stripped when it is all digits, and `''` when absent. `seller` is the `sellerId` of the seller with `sellerDefault`, else the first seller, else `'1'`. SKU match is string equality, then equality after stripping leading zeros from numeric ids. A non-numeric id is not stripped. Read `items[].itemId`, `sellers[].sellerId`, `sellers[].sellerDefault`, and `commertialOffer.AvailableQuantity` only inside this function

**Checkpoint**: Offer verdicts match today's widget rules with no network and no `window` access

---

## Phase 4: User Story 2 - Validate the contact (Priority: P2)

**Goal**: `validateBackInStockContact` reports a missing name and an invalid phone with the same verdicts as today

**Independent Test**: `npm test -- --testPathPattern=backInStock.contact --coverage=false`

### Tests for User Story 2 ⚠️

> **NOTE: Write this test FIRST, ensure it FAILS before T013**

- [ ] T012 [P] [US2] Write `tests/backInStock.contact.test.ts` for a valid BR mobile, a too-short number, an empty calling code, an empty national number, separators, and a leading `+`. A blank name and a whitespace-only name return `errors.name === 'required'`. Valid input returns `isValid: true` and empty `errors`

### Implementation for User Story 2

- [ ] T013 [US2] Implement `validateBackInStockContact` in `src/modules/backInStock/contact.ts` using `isValidPhoneNumber` from `libphonenumber-js/max`. Constraint from `data-model.md`: `name` is valid when trim is non-empty. `phone` is valid when `isValidPhoneNumber('+' + digits)` is true. `errors.name` is `'required'` or absent. `errors.phone` is `'invalid'` or absent. Return no display strings

**Checkpoint**: Contact validation is synchronous and does not read the page

---

## Phase 5: User Story 3 - Send the subscription (Priority: P3)

**Goal**: `subscribeBackInStock` validates, builds today's JSON body, POSTs it with timeout and retry, dedupes an in-flight pair, and emits the two events

**Independent Test**: `npm test -- --testPathPattern='backInStock.subscription|service.backInStock|service.exports' --coverage=false`

### Tests for User Story 3 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before T016**

- [ ] T014 [P] [US3] Write `tests/backInStock.subscription.test.ts` with a stubbed `fetch` and fake timers. Cover the body for full input, `seller` and `salesChannel` defaulting to `'1'`, stripped SKU, digits-only phone, trimmed name, and every locale branch: first regional entry of `storeLocales` (including a non-regional first entry followed by a regional one), regional `language`, mapped `pt`/`en`/`es`/`ro`, an unmapped language passed through, and the `pt-BR` default. Cover 2xx with no body resolving `{ accepted: true }`, `200 { accepted: false }` resolving `false`, 400 rejecting `HTTP` with no retry, 503 then 200 resolving after one retry, 503 three times rejecting with `attempt: 3`, a hung `fetch` rejecting `TIMEOUT`, and a thrown `fetch` rejecting `NETWORK`. Two concurrent calls with the same SKU and phone call `fetch` once. Invalid phone, blank name, and empty SKU reject `VALIDATION` and do not call `fetch`. Event payloads have no `name` and no `phone`. Assert `src/modules/backInStock` has no `window` reference
- [ ] T015 [P] [US3] Write `tests/service.backInStock.test.ts` so the three methods exist on an instance and delegate, and a custom `backInStock.subscribePath`, `timeoutMs`, and `maxRetries` are honored. Extend `tests/service.exports.test.js` so `SERVICE_EVENTS` contains `backInStock:subscribed` and `backInStock:error`

### Implementation for User Story 3

- [ ] T016 [P] [US3] Implement `src/utils/backInStockRequestBuilder.ts`. Constraint from `data-model.md`: the body is `{ sku_id, phone, name, seller, sales_channel, locale }` and this is the only snake_case object. `locale` is the first value containing `-` in `storeLocales`, then in `language`; otherwise `language` maps `{ pt: 'pt-BR', en: 'en-US', es: 'es-ES', ro: 'ro-RO' }`, then the raw `language`, then `pt-BR`. SKU leading zeros stripped when all digits. Phone digits only. Name trimmed. Empty `seller` or `salesChannel` becomes `'1'`
- [ ] T017 [P] [US3] Implement `src/network/BackInStockClient.ts`. `POST` with `Content-Type: application/json` and `credentials: 'same-origin'`. Each attempt times out via `AbortController`. Retry only a network error, a timeout, 429, and 5xx, up to `maxRetries`, waiting `retryBaseDelayMs * 2^attempt` with no jitter. Do not use `src/network/RetryStrategy.js`. Constraint from `data-model.md`: a 2xx body with `accepted: false` is `false`; a 2xx body without `accepted`, or a body that is not JSON, is `true`
- [ ] T018 [US3] Implement `subscribeBackInStock` in `src/modules/backInStock/subscription.ts` on a per-instance pending map. Run contact validation and reject an empty SKU with `BackInStockError` `VALIDATION` and `fields.skuId === 'required'` before any `fetch`. Pending key is `normalizedSkuId + ':' + phoneDigits`; a second call with that key returns the same promise. Clear the key in `finally`. On 2xx resolve `{ accepted }` and emit `backInStock:subscribed` with `{ skuId, accepted }`. On failure reject `BackInStockError` and emit `backInStock:error` with `{ code, skuId, status?, attempt?, fields? }`. `attempt` is 1-based. Warn `console.warn('[WebChatService:BackInStock]', context)` for `HTTP`, `TIMEOUT`, and `NETWORK` only, with `{ operation: 'subscribeBackInStock', code, skuId, status, attempt }` and no name or phone
- [ ] T019 [P] [US3] Add the three methods, `BackInStockError`, the two events, and the optional `backInStock` init object to `src/types/index.d.ts` using the signatures in `specs/003-back-in-stock-to-service/contracts/back-in-stock-api.md`
- [ ] T020 [US3] In `src/index.js`, construct one subscription per instance and add `evaluateBackInStockOffer`, `validateBackInStockContact`, and `subscribeBackInStock` as delegating methods. Do not put offer, phone, or HTTP logic in this file
- [ ] T021 [P] [US3] In `src/utils/validators.js`, reject a `backInStock` option whose `timeoutMs` or `retryBaseDelayMs` is not a finite number `>= 0`, whose `maxRetries` is not an integer `>= 0`, or whose `subscribePath` is not a non-empty string. Constraint from `data-model.md`: those are the only constructor checks; omitting `backInStock` keeps today's construction

**Checkpoint**: A valid subscribe sends one POST. A repeat while in flight does not send a second. Invalid input sends nothing

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Release notes and the quickstart gate

- [ ] T022 Add Added entries to `CHANGELOG.md` for the three methods, the two events, the `backInStock` option, and the `libphonenumber-js` dependency. State that CJS and ESM leave `libphonenumber-js/max` external and UMD bundles it
- [ ] T023 [P] Document the three methods and the `backInStock` defaults in `README.md`, including that an overridden `subscribePath` on another origin is the caller's CORS and session problem
- [ ] T024 Run the commands in `specs/003-back-in-stock-to-service/quickstart.md` (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational only
- **User Story 2 (Phase 4)**: Depends on Foundational only. Independent of User Story 1
- **User Story 3 (Phase 5)**: Depends on Foundational and on `contact.ts` from User Story 2. The offer method is wired in T020 but the subscription does not call it
- **Polish (Phase 6)**: Depends on the stories you intend to ship

### User Story Dependencies

- **User Story 1 (P1)**: No dependency on US2 or US3
- **User Story 2 (P2)**: No dependency on US1 or US3
- **User Story 3 (P3)**: Needs `validateBackInStockContact` from US2. Does not need the offer function

### Within Each User Story

- Tests fail before the implementation task that makes them pass
- US3: T016 and T017 after the failing tests, T018 after T016 and T017, T020 after T018

### Parallel Opportunities

- T002, T003, T004, T005, and T006 touch different files and can run together after T001 starts installing
- T007 and T008 can run together
- After Foundational, US1 and US2 can run together
- T014 and T015 can run together. T016, T017, T019, and T021 can run together once those tests exist. T018 and T020 stay sequential

---

## Parallel Example: User Story 1 and User Story 2

```bash
# After T009, these tests touch different files:
Task: "T010 tests/backInStock.offer.test.ts"
Task: "T012 tests/backInStock.contact.test.ts"

# Then the implementations, still different files:
Task: "T011 src/modules/backInStock/offer.ts"
Task: "T013 src/modules/backInStock/contact.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2
2. Complete User Story 1
3. Stop and run `npm test -- --testPathPattern=backInStock.offer --coverage=false`

### Incremental Delivery

1. Setup and Foundational
2. User Story 1: offer verdicts, no I/O
3. User Story 2: contact verdicts, no I/O
4. User Story 3: the POST, then changelog and README
5. User Story 3 is the first slice that needs `npm link` from webchat-react

### Parallel Team Strategy

1. One person finishes Setup and Foundational
2. Then one person takes the offer and another takes contact
3. The subscription starts only after contact is in

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to the acceptance slice above
- Do not read `window` from `src/modules/backInStock`
- Commit after each task or logical group
- webchat-react spec `010` links `dist/` and does not bump its peer. Publishing `1.20.0` is not a task here
