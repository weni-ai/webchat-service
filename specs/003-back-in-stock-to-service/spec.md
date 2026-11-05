# Engineering Specification: Back-in-stock logic and request in the service

**Repository**: webchat-service — frontend-platform

**Feature Branch**: `003-back-in-stock-to-service`

**Created**: 2026-11-05

**Status**: Draft

## Origin Without Product Spec

- Product Spec: none
- Problem: The back-in-stock rules and the subscribe request live in webchat-react: the "selected SKU is unavailable" decision and seller choice (`src/utils/vtex.js`), the contact validation (`src/utils/phoneCountry.js`), and the payload rules and HTTP call (`src/utils/availabilityNotify.js`). The interface should only render, so the headless service must own that logic and that request. Today the service has no back-in-stock API.
- Acceptance criteria:
  - The service exposes a synchronous method that receives the product the widget already resolved and the selected SKU, and returns whether the back-in-stock offer applies, plus the normalized SKU and the seller. The results match today's `isSelectedSkuAvailable` and `getSellerIdForSku` for the same inputs. That includes leading-zero SKU matching, and treating an unknown or unmatched quantity as available.
  - The service exposes a synchronous contact validator. It reports a missing name and an invalid international phone number, with the same verdicts `isValidInternationalNumber` gives today.
  - The service exposes `subscribeBackInStock`. It validates the input, builds the same JSON body webchat-react sends today, and POSTs it to `/_v/private/availability-notify/subscribe` by default. That body is `sku_id`, `phone`, `name`, `seller`, `sales_channel`, and `locale`, with the same defaults and the same locale fallback.
  - `subscribeBackInStock` resolves `{ accepted: true }` on 2xx and `{ accepted: false }` when the route answers `accepted: false`. It rejects with a structured error for invalid input, 4xx, exhausted retries, or timeout. It never throws an unhandled exception and never swallows a failure without an error event.
  - Calling `subscribeBackInStock` again for the same SKU and phone while a request is in flight does not send a second request.
  - The service reads no VTEX page globals. Sales channel, store locale, and widget language arrive as input.

## Scope in This Repository

**This repository implements**:

- The back-in-stock domain rules: offer decision, seller choice, SKU normalization, contact validation, locale and default resolution, and payload building.
- The HTTP transport for the subscribe route: timeout, retry, and in-flight deduplication.
- Public facade methods, init options, emitted events, and the matching TypeScript types.
- The TypeScript toolchain setup that Principle X requires, because these are the first new source files since that rule was adopted.

**Out of scope here**:

- Reading the host page: selected SKU detection, sales channel from the segment token or FastStore session, store locale from `__RUNTIME__.culture.locale` or `<html lang>`, and store country for the default calling code. webchat-react keeps that, and passes the raw values in (spec `010-back-in-stock-to-service` in webchat-react).
- Product resolution (`resolveProductData`, `normalizeForContext`). It is shared with conversation starters and stays in webchat-react.
- The form, as-you-type phone formatting, the offer bubble, page navigation, the `unavailableProductNotify` init flag, and i18n strings. These stay in webchat-react.
- The subscribe route itself (agentic-cx `node/middlewares/subscribeAvailabilityNotify.ts`) and the waiter persistence (retail-setup). No change there.

**Depends on**: the existing agentic-cx route `POST /_v/private/availability-notify/subscribe`, served same-origin on the storefront and authenticated by the forwarded `vtex_session` cookie. It answers 400 when required fields are missing, 403 on an account mismatch, `200 { accepted: false }` when the back-in-stock agent is inactive, and the upstream status otherwise. retail-setup deduplicates waiters with `get_or_create` under a unique constraint, so a repeated subscription is safe.

## Current State

- `src/index.js` (1408 lines, already over the Principle XI limit) is the facade. `getStarters`, `clearStarters`, and `setContext` are the nearest analogous PDP features: validation in `src/utils/validators.js`, the outbound builder in `src/utils/messageBuilder.js`, and events in `SERVICE_EVENTS` (`src/utils/constants.js`).
- The library has no HTTP integration today. All network I/O goes through `src/core/WebSocketManager.js`. `src/network/RetryStrategy.js` holds the reconnection backoff.
- `rollup.config.js` bundles everything except `eventemitter3` into CJS, ESM, and UMD. It compiles `.js` only.
- `jest.config.js` collects coverage from `src/**/*.js`. ESLint lints `src --ext .js`. `tsconfig.json` is strict, but no `.ts` source exists, and `typescript` is a devDependency only.
- `src/types/index.d.ts` holds the public types.
- The logic being moved currently lives in webchat-react: `isSelectedSkuAvailable`, `getSellerIdForSku`, `findSelectedSkuItem`, and `stripLeadingZeros` in `src/utils/vtex.js`; `buildAvailabilityNotifyBody`, `getNotifyLocale`, `digitsOnlyPhone`, and `subscribeAvailabilityNotify` in `src/utils/availabilityNotify.js`; `isValidInternationalNumber` in `src/utils/phoneCountry.js`.

## Technical Approach

### Components Affected

| Component | Change | Why |
|-----------|--------|-----|
| `src/modules/backInStock/offer.ts` | new | Pure offer decision and seller choice from the VTEX product shape, normalized at entry. |
| `src/modules/backInStock/contact.ts` | new | Name and phone validation (`libphonenumber-js/max`) and phone digit normalization. |
| `src/modules/backInStock/subscription.ts` | new | Resolves defaults and locale, guards against double submission, maps transport outcomes to results, errors, and events. |
| `src/network/BackInStockClient.ts` | new | `fetch` POST with explicit timeout (`AbortController`), retry and backoff, and status classification. The only place that touches HTTP. |
| `src/utils/backInStockRequestBuilder.ts` | new | Wire-format builder (snake_case allowed for outbound builders, Principle XIV). |
| `src/index.js` | modified | Three thin facade methods that delegate to the module. Init option defaults. No logic in the facade. |
| `src/utils/constants.js` | modified | `BACK_IN_STOCK_SUBSCRIBED` and `BACK_IN_STOCK_ERROR` in `SERVICE_EVENTS`, plus the default route and timing constants. |
| `src/types/index.d.ts` | modified | Types for the new methods, inputs, results, error, events, and options. |
| `rollup.config.js`, `jest.config.js`, `babel.config.js`, `eslint.config.mjs`, `package.json` | modified | TypeScript build, test, and lint support (Principle X). `libphonenumber-js` as a runtime dependency. |
| `tests/backInStock.*.test.ts` | new | Unit and facade flow tests. |
| `CHANGELOG.md`, `README.md` | modified | Added entries, plus API and option documentation. |

### Flow

**Offer decision** — `service.evaluateBackInStockOffer({ product, selectedSkuId })`

1. The input is the product webchat-react already holds after `normalizeForContext`: VTEX catalog shape with `items[].itemId`, `items[].sellers[].sellerId` / `sellerDefault` / `commertialOffer.AvailableQuantity`. `offer.ts` normalizes it at entry to internal camelCase (`skuId`, `sellers[].sellerId`, `isDefault`, `availableQuantity`). PascalCase and misspelled VTEX fields do not leak past that function.
2. It finds the item whose SKU equals `selectedSkuId`, comparing as strings first and then after stripping leading zeros from numeric IDs.
3. It returns `{ isUnavailable, skuId, seller }`. `isUnavailable` is true only when a matched item has `availableQuantity === 0` or lower. An unmatched SKU, missing sellers, or an unknown quantity give `false`, which avoids false "notify me" prompts. `skuId` is the selected SKU with leading zeros stripped (empty string when absent). `seller` is the default seller, otherwise the first seller, otherwise `'1'`.
4. Pure and synchronous: no state, no event, no network. A malformed product (not an object, or no `items` array) returns `isUnavailable: false` and never throws, so a bad input can only fall back to starters on the widget side.

**Contact validation** — `service.validateBackInStockContact({ name, phone })`

1. `name` is valid when it is non-empty after trimming. `phone` is the international number as typed: calling code plus national number, with any separators and an optional `+`. It is valid when its digits, prefixed by `+`, pass `isValidPhoneNumber` from `libphonenumber-js/max`.
2. Returns `{ isValid, errors: { name?: 'required', phone?: 'invalid' } }`. Error codes are stable strings. The widget maps them to its own i18n keys.

**Subscribe** — `service.subscribeBackInStock({ name, phone, skuId, seller, salesChannel, storeLocales, language })`

1. Runs `validateBackInStockContact`. It also requires a non-empty `skuId` after normalization. Today an empty `sku_id` is sent and the route answers 400; now it is caught locally. On failure it rejects with `BackInStockError { code: 'VALIDATION', fields }`, emits `backInStock:error`, and sends nothing.
2. Resolves values: SKU with leading zeros stripped; phone as digits only; name trimmed; `seller` or `'1'`; `salesChannel` or `'1'`. For `locale`, `storeLocales` is the ordered list of raw host candidates the widget read (today `__RUNTIME__.culture.locale`, then `<html lang>`). The first regional value (one containing `-`) among `storeLocales`, then `language`, wins. Otherwise `language` maps through `{ pt: 'pt-BR', en: 'en-US', es: 'es-ES', ro: 'ro-RO' }`, then the raw `language`, then `'pt-BR'`. This is the same chain `getNotifyLocale` applies today, with the page reads replaced by `storeLocales`.
3. In-flight guard: the key is `skuId:phoneDigits`. If a request with that key is pending, it returns the same promise.
4. `backInStockRequestBuilder` builds `{ sku_id, phone, name, seller, sales_channel, locale }`.
5. `BackInStockClient.post(path, body)` sends `POST` with `Content-Type: application/json` and `credentials: 'same-origin'`. Each attempt has its own timeout. Retriable outcomes are a network error, a timeout, 429, and 5xx. Non-retriable outcomes are any other 4xx and any malformed request.
6. On 2xx, it reads `accepted` from the JSON body (absent means `true`), resolves `{ accepted }`, and emits `backInStock:subscribed { skuId, accepted }`.
7. On a non-retriable status or exhausted retries, it rejects with `BackInStockError { code: 'HTTP' | 'TIMEOUT' | 'NETWORK', status?, attempt }` and emits `backInStock:error` with the same context.
8. The pending key is cleared in `finally`.

### Rejected Alternatives

- Reading VTEX globals (`__RUNTIME__`, segment token, FastStore session, ld+json) inside the service: it makes behavior depend on hidden page state instead of input and configuration (Principle XIV), and ties the headless library to one storefront family. webchat-react already reads the page for product detection.
- Moving product resolution (`resolveProductData` and the starters waterfall) here as well: it serves conversation starters and PDP context too, so it is a separate refactor. The offer decision only needs its output.
- Sending the subscription over the WebSocket: the route is a VTEX IO storefront endpoint that authenticates the shopper's `vtex_session` cookie. The socket server has no such handler.
- Keeping validation in webchat-react with only a non-empty check here: two sources of truth for the same rule. The widget asks the service instead (`validateBackInStockContact`).
- Accepting a pre-mapped camelCase product from the widget: the widget would need a mapping adapter just to call the service. Normalizing the VTEX shape at the service's entry keeps that logic here.
- Resolving `{ accepted: false }` as an error: an inactive agent is a valid outcome, not a failure. The caller decides what to show.

## Contracts

| Interface | Change | Version impact | Backward compatible |
|-----------|--------|----------------|---------------------|
| `WeniWebchatService#evaluateBackInStockOffer(input): { isUnavailable, skuId, seller }` | added | minor | yes |
| `WeniWebchatService#validateBackInStockContact(input): { isValid, errors }` | added | minor | yes |
| `WeniWebchatService#subscribeBackInStock(input): Promise<{ accepted: boolean }>`, rejecting with `BackInStockError` | added | minor | yes |
| `SERVICE_EVENTS.BACK_IN_STOCK_SUBSCRIBED` = `backInStock:subscribed`, payload `{ skuId, accepted }` | added | minor | yes |
| `SERVICE_EVENTS.BACK_IN_STOCK_ERROR` = `backInStock:error`, payload `{ code, skuId, status?, attempt?, fields? }` | added | minor | yes |
| Init option `backInStock: { subscribePath = '/_v/private/availability-notify/subscribe', timeoutMs = 10000, maxRetries = 2, retryBaseDelayMs = 500 }` | added | minor | yes — every field defaults |
| `src/types/index.d.ts` | modified (additive types) | minor | yes |
| Runtime dependency `libphonenumber-js` | added | minor | yes — CJS and ESM keep it external so the consumer's bundler deduplicates it with webchat-react's own copy; UMD bundles it |

Release: `1.20.0`.

**Consumers affected**: webchat-react adopts the new methods in spec `010-back-in-stock-to-service` through `npm link` to this checkout's `dist/`. That spec keeps its declared pin at `1.19.2` and does not wait for this release. Other consumers (Vue, vanilla) are unaffected because nothing existing changes. The changelog lists all of this under Added.

## Non-Functional Requirements

### Peak Load

The library runs in the shopper's browser, so the load is per client. The peak is one shopper submitting the form once on a campaign-day product page: at most one in-flight subscribe per SKU and phone, and at most `1 + maxRetries` = 3 POSTs when the route is failing. Aggregate traffic on the agentic-cx route stays at today's one POST per submit. Retries add at most two more, only for 5xx, 429, or network failures, during the same window. The offer decision and validation are in-memory and run once per product resolution or submit.

### Observability

- `backInStock:subscribed` and `backInStock:error` events carry `{ operation: 'subscribeBackInStock', skuId, status, attempt, code }`.
- Failures also log `console.warn('[WebChatService:BackInStock]', context)` with the same object.
- Correlation: `skuId` plus `attempt` on the client side. The route logs the VTEX account and the request, and the SKU joins them, because the HTTP protocol carries no request ID.
- Name and phone are personal data. They never appear in events, logs, or error messages, and validation errors report field codes only.

### Failure Handling

| Dependency / failure | Timeout | Caller sees | Retry |
|----------------------|---------|-------------|-------|
| Invalid input (name, phone, empty SKU) | n/a | rejection with `code: 'VALIDATION'` and `fields`, plus an error event; no request | none (permanent) |
| Network error | `timeoutMs` (10 s) per attempt | rejection with `code: 'NETWORK'` after the last attempt | up to `maxRetries` (2), exponential backoff `retryBaseDelayMs × 2^n` (500 ms, 1 s) |
| Timeout | 10 s per attempt, via `AbortController` | rejection with `code: 'TIMEOUT'` | same as network |
| 429 or 5xx | same | rejection with `code: 'HTTP'` and `status` | same as network |
| 400, 403, other 4xx | same | rejection with `code: 'HTTP'` and `status` | none (permanent) |
| `200 { accepted: false }` | same | resolves `{ accepted: false }` | none |
| Malformed or empty 2xx body | same | resolves `{ accepted: true }` | none |

Idempotency: retries are safe because retail-setup deduplicates waiters. The in-flight guard prevents double submission from the same client. No exception escapes as unhandled: every rejection is a `BackInStockError` and also emits an event, so no failure is swallowed (Principle XVI).

### Security and Authorization

- Input crosses the trust boundary at the facade. The service validates the name and phone and normalizes all values before building the body. The route validates again on the server (`parseBackInStockSubscribeBody`, `cleanPhoneNumber`).
- Authorization is server-side. The private VTEX route requires the shopper's `vtex_session`, which the edge forwards on a same-origin request (`credentials: 'same-origin'`). agentic-cx mints the Retail JWT, and it never comes from the browser. The service sends no token and stores no secret.
- The path is configurable, but the default is relative and same-origin. A consumer that overrides it to another origin takes on CORS and session handling themselves; the README documents this.
- Nothing is persisted. No `localStorage` key is added.

## Test Strategy

| Success / acceptance criterion | How this repository proves it |
|--------------------------------|-------------------------------|
| Offer decision matches today's rules | `tests/backInStock.offer.test.ts`: table tests ported from webchat-react's `vtex.test.js` cases for `isSelectedSkuAvailable` and `getSellerIdForSku`. They cover quantity 0, quantity above 0, unknown quantity, an unmatched SKU, a leading-zero match (`"000326125867"` vs `"326125867"`), an alphanumeric SKU, `sellerDefault` preference, first-seller fallback, and `'1'` fallback. Malformed products (`null`, no `items`, non-array `sellers`) return `isUnavailable: false` without throwing. |
| Contact validator matches today's verdicts | `tests/backInStock.contact.test.ts`: cases ported from webchat-react's `phoneCountry.test.js`, covering BR mobile valid, too short, an empty calling code, an empty national number, separators, and a leading `+`. Also a blank and whitespace-only name. |
| Same body, defaults, and locale chain | `tests/backInStock.subscription.test.ts`: the body for full input; `seller` and `salesChannel` defaults; leading zeros stripped; phone digits only; name trimmed. Every locale branch: first regional entry of `storeLocales` (including a non-regional first entry followed by a regional one), regional `language`, mapped `pt`/`en`/`es`/`ro`, an unmapped language passed through, and the `pt-BR` default. Cases are ported from `availabilityNotify.test.js`. |
| Resolve, reject, and event outcomes | Subscription test with a stubbed `fetch`: 2xx with no body resolves `accepted: true`; `200 { accepted: false }` resolves `false`; 400 rejects `HTTP` with no retry; 503 then 200 resolves after one retry; 503 three times rejects with `attempt: 3`; a never-resolving fetch rejects `TIMEOUT` (fake timers); a thrown fetch rejects `NETWORK`. Each case asserts the emitted event, and that its payload has no name or phone. |
| No duplicate in-flight request | Two concurrent calls with the same SKU and phone produce one `fetch` and the same resolved value. A call after settlement sends again. |
| Validation blocks the request | Invalid phone, blank name, and empty SKU each reject `VALIDATION` with field codes, and `fetch` is never called. |
| No VTEX globals read | The subscription and offer tests run with `window.__RUNTIME__`, `faststore_sdk_stores`, and the `document` ld+json absent, and outputs depend only on input. A lint rule or grep check in the module test asserts that `src/modules/backInStock` does not reference `window.`. |
| Facade wiring and options | `tests/service.backInStock.test.ts`: the methods exist on an instance and delegate; a custom `backInStock.subscribePath`, `timeoutMs`, and `maxRetries` are honored; `service.exports.test.js` asserts the new `SERVICE_EVENTS` keys. |
| TypeScript toolchain | `npm run build` emits CJS, ESM, and UMD containing the `.ts` modules; `npm test` runs the `.ts` tests with coverage; `npm run lint` covers `.ts`. |

**Flow coverage**: the product and selected SKU yield an offer verdict; a contact yields a validation verdict; a subscribe goes through validation, normalization, the body, the POST, and the outcome to the resolved value and event, including the retry path.

**Failure paths covered**: invalid input; 4xx with no retry; retriable statuses until exhaustion; timeout; network error; malformed 2xx body; concurrent double submission.

**Stubbed at the boundary**: global `fetch`, stubbed in `BackInStockClient` tests and through the facade. Timers are fake for timeout and backoff. `libphonenumber-js` runs for real.

## Rollout and Rollback

1. Merge here and publish `1.20.0-staging*` (staging tag), then `1.20.0` (latest) through `npm-publish.yaml`.
2. webchat-react spec `010` consumes this checkout with `npm link` and does not bump its declared pin. Publishing `1.20.0` is not a prerequisite for that work. Until a later release chooses to bump the pin, a widget installed from the registry keeps its own copy of the logic.
3. No feature flag: the methods are additive and inert until called.

Rollback: webchat-react pins back to `1.19.x`, which is safe because `1.20.0` changes nothing existing. If the service release must be pulled, deprecate `1.20.0` on npm. Nothing is persisted on the client or the server by this repository.

## Constitution Alignment

| Principle | How this spec complies | Exception + justification |
|-----------|------------------------|---------------------------|
| I. Version Control and Review | Lands by PR with lint, tests, and coverage. | none |
| II. Specification Traceability | Opens with Origin Without Product Spec; the problem and acceptance criteria are stated there. | none |
| IV. Versioned Public Contracts | All additions are listed in Contracts as minor (`1.20.0`). `index.d.ts` is updated in the same PR. | none |
| V. Release & Changelog | Changelog entries under Added. The consumer follow-up is named (webchat-react spec `010`). The build tooling change (TypeScript) includes verification steps: build output, tests, and lint. | none |
| VII. Security & Secrets | No token or secret. Authorization stays on the server, through the session cookie and the route. `libphonenumber-js` is a deliberate data-validation dependency from npm, checked with `npm audit`. | none |
| VIII. Observability | Structured events and `console.warn` with a module prefix and a context object. The name and phone are never logged. | No protocol request ID exists for this HTTP route; `skuId` plus `attempt` is the correlation. |
| IX. Code as Documentation | JSDoc/TSDoc on the facade methods and module exports. Comments explain why an unknown quantity means available, and why retries are safe. | none |
| X. Type Safety | All new modules and tests are TypeScript under strict mode. This PR makes Rollup, Jest, and ESLint TypeScript-capable. `index.js` changes are limited to thin delegation. | none |
| XI. Single Responsibility | The logic lives in focused modules; `index.js` gains only delegating methods. | `src/index.js` grows by about 30 lines of delegation. Extracting the facade is out of scope. |
| XIII. Module & Public API Architecture | Headless facade delegates to `modules/backInStock` and `network/BackInStockClient`. Event names follow `domain:action`. | none |
| XIV. WebSocket Contract & Data Boundaries | HTTP lives only in `network/BackInStockClient.ts`. The VTEX product shape is normalized at entry. snake_case appears only in the outbound builder. Configuration comes from options with documented defaults. Timeout and retries are explicit. | none |
| XV. State Management & Async Correctness | The only state is a module-local pending-request map, which is not shared and needs no `StateManager`. Pending, success, and error states are exposed through the promise and events. Double submission is guarded. | none |
| XVI. Resilience & Error Handling | Retriable failures are separated from permanent ones. Retry and backoff are configurable with documented defaults. No swallowed exceptions. | none |
| Testing | Unit tests per module, a facade flow test, and failure paths, all within the coverage gate. | none |
| Internationalization | The service returns error codes, not strings; locale resolution only selects the `locale` sent to the route. | none |
| Accessibility / UI and Styling | No UI is shipped. | none |

## Implementation Decisions

- **The service receives the VTEX product shape**: the widget passes the result of `normalizeForContext` unchanged, and the service normalizes it at entry. This keeps mapping logic out of the widget.
- **Unknown means available**: unmatched SKUs and unknown quantities do not trigger the offer. This keeps today's behavior and avoids prompting for a product that may be in stock.
- **Error codes, not messages**: `validateBackInStockContact` returns `'required'` / `'invalid'`, so the widget keeps its translation keys (`back_in_stock.name_required`, `back_in_stock.invalid_phone`).
- **Empty SKU is a validation error**: previously the route rejected it with 400. Catching it locally saves a request and gives a clear error code.
- **`accepted: false` resolves**: an inactive agent is a valid business outcome, and the caller decides how to present it.
- **Retries on by default (2)**: they are safe because the backend deduplicates, and they improve delivery on flaky mobile networks. They stay bounded and configurable.
- **`libphonenumber-js/max` is external in CJS/ESM and bundled in UMD**: webchat-react still needs it for as-you-type formatting, so its bundler resolves one copy. The UMD bundle must stay self-contained for script-tag consumers.
- **TypeScript setup ships in this PR**: Principle X requires the first new file to bring it. `@rollup/plugin-typescript` (or Babel's TypeScript preset, to be decided in the plan), Jest `ts` transform and coverage, and `--ext .js,.ts` in lint.
