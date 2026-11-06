# Implementation Plan: Back-in-stock logic and request in the service

**Branch**: `003-back-in-stock-to-service` | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-back-in-stock-to-service/spec.md`

## Summary

Move the back-in-stock offer decision, contact validation, payload rules, and subscribe POST into this library. The facade gains three methods and delegates to new TypeScript modules. HTTP lives in one client. This change also turns on TypeScript for Rollup, Jest, and ESLint, because these are the first new source files under Principle X. webchat-react consumes a local `npm link`, not a published version.

## Technical Context

**Language/Version**: New modules and tests in TypeScript, strict. Existing facade and constants stay JavaScript. Target ES2020, as `tsconfig.json` already sets.
**Primary Dependencies**: `eventemitter3` (unchanged, external). New runtime dependency `libphonenumber-js`, imported as `libphonenumber-js/max`. New devDependencies `@babel/preset-typescript`, `@rollup/plugin-babel`, `typescript-eslint`.
**Storage**: None. The in-flight map is per service instance and is not written by `StorageManager`.
**Testing**: Jest 29 with `babel-jest` on `.ts` tests under `tests/`. `tsc --noEmit` for `src/**/*.ts`.
**Target Platform**: Browser library. CJS, ESM, and UMD bundles from Rollup.
**Performance Goals**: One offer evaluation and one contact check per product or submit, in memory. One POST per submit, plus at most two retries when the route is failing.
**Constraints**: Do not read `window` VTEX globals. Do not log name or phone. Do not send a second POST for the same SKU and phone while one is in flight. Empty SKU, blank name, and invalid phone send nothing. Unknown stock is available.
**Scale/Scope**: Six new source files, three facade methods, two events, one init option, the toolchain edits, changelog, and README.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Versioned public contracts** — PASS. Methods, events, and `backInStock` are additive and listed in `contracts/back-in-stock-api.md`. `src/types/index.d.ts` is updated in the same change. No existing signature changes.
2. **Type safety** — PASS. New files are `.ts`. The plan adds the Rollup, Jest, ESLint, and `tsc --noEmit` setup Principle X requires on the first new file. Existing `.js` is not migrated.
3. **Module boundaries** — PASS. `network/BackInStockClient.ts` is the only `fetch`. `backInStockRequestBuilder.ts` is the only snake_case. The facade methods delegate.
4. **Single responsibility and file size** — PASS with a recorded limit. `src/index.js` gains construction of the subscription object and three short methods. The rules do not move into it. See Complexity Tracking.
5. **Async correctness and resilience** — PASS. Validation, HTTP, timeout, and network are distinct error codes. Retries are bounded. The pending map blocks double submit. Failures emit `backInStock:error`.
6. **Observability and secrets** — PASS. Event context is `skuId`, `code`, `status`, `attempt`. No contact fields. No new token.
7. **Testing** — PASS. Offer, contact, subscription, and facade tests are named in the spec and in `quickstart.md`. Coverage collection includes `src/**/*.ts`.

No unjustified MUST departure. Re-checked after Phase 1: the contract is additive, persists nothing, and the TypeScript decision in `research.md` satisfies Principle X. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/003-back-in-stock-to-service/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── back-in-stock-api.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── index.js                              # construct the feature; three delegating methods
├── types/index.d.ts                      # published types for the methods, error, events, option
├── modules/backInStock/
│   ├── offer.ts                          # evaluateBackInStockOffer
│   ├── contact.ts                        # validateBackInStockContact
│   └── subscription.ts                   # subscribeBackInStock, pending map, events
├── network/BackInStockClient.ts          # POST, timeout, retry
└── utils/
    ├── backInStockRequestBuilder.ts      # snake_case body and locale chain
    └── constants.js                      # BACK_IN_STOCK_* events and default numbers
tests/
├── backInStock.offer.test.ts
├── backInStock.contact.test.ts
├── backInStock.subscription.test.ts
└── service.backInStock.test.ts
rollup.config.js                          # babel plugin; UMD bundles libphonenumber, CJS/ESM do not
babel.config.js
jest.config.js
eslint.config.mjs
tsconfig.json                             # noEmit strict check of src/**/*.ts
package.json                              # typecheck script, lint ext, dependencies
CHANGELOG.md
README.md
```

**Structure Decision**: Single headless library. New code goes in `modules/backInStock/` and `network/`, matching `getStarters` (validate, build, send) except the transport is HTTP instead of `WebSocketManager`. Tests stay in the top-level `tests/` directory Jest already matches, extended to `*.test.ts`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `src/index.js` grows past the 500-line guidance it already exceeds | The published methods have to sit on the facade | Moving every existing method out of `index.js` is a separate refactor. This change adds construction plus three delegating methods only. |

## Inherited Context

- Product Spec: none
- Engineering Spec: `specs/003-back-in-stock-to-service/spec.md`

## Delivery Sequence

1. Toolchain — Babel preset, Rollup plugin, Jest `*.test.ts` match and coverage, ESLint parser, `npm run typecheck`. A one-line `.ts` module compiled into the three bundles proves the path before the feature code depends on it.
2. `offer.ts` and `contact.ts` with their tests — pure, no facade, and they lock the verdicts ported from webchat-react.
3. `backInStockRequestBuilder.ts` and `BackInStockClient.ts` — body and transport, tested with a stubbed `fetch` and fake timers.
4. `subscription.ts` — validation gate, defaults, pending map, result mapping, events.
5. Facade, `SERVICE_EVENTS`, `validateConfig` checks for the numeric option, and `src/types/index.d.ts`.
6. Changelog Added entries and a README section for the three methods and the `backInStock` option. `npm run build` is the last local check.

**Cross-repository coordination**: webchat-react spec `010` links this repo's `dist/` and does not bump its peer. Publish `1.20.0` when a release is wanted. That publish is not a step in the widget plan. Rebuild and let the widget re-resolve the link after each change here.

## Peak Load Plan

- Declared peak: one shopper, one submit, on a campaign-day product page. At most three POSTs when the route returns 5xx, 429, or a network error. Offer and contact checks allocate nothing beyond the returned object.
- How this plan sustains it: the client caps retries at `maxRetries` (2). The pending map collapses a double click into one POST. There is no queue and no timer left running after the promise settles.
- How it is verified: `tests/backInStock.subscription.test.ts` asserts one `fetch` for two overlapping calls, and three `fetch` calls then a rejection when every attempt returns 503. No load harness. The work runs in the shopper's browser.

## Observability Plan

- Structured logs added: `console.warn('[WebChatService:BackInStock]', context)` on `HTTP`, `TIMEOUT`, and `NETWORK`. Context is `{ operation: 'subscribeBackInStock', code, skuId, status, attempt }`. Validation failures emit the event and do not warn, because the form shows them.
- Correlation identifier: `skuId` plus `attempt`. The route has no request id. The same `skuId` is what webchat-react already puts on `divert_back_in_stock`.
- Error reports: `backInStock:error` with `code` and `fields` codes only. `name` and `phone` are absent from the warn object and from both events.
- Signals watched after rollout: a failed subscribe produces one warning with `code` and `status`. A success produces `backInStock:subscribed` and no warning.

## Rollout and Rollback Plan

- Rollout: merge on `003-back-in-stock-to-service`. Developers link the local build. Publishing `1.20.0-staging*` and `1.20.0` through `npm-publish.yaml` happens later and is not required for the widget work.
- Backward compatibility window: callers that never use the new methods keep today's behavior on this version and on `1.19.2`. No storage key is added.
- Rollback: unlink the local build, or publish nothing. `1.19.2` remains the last npm release until a tag is pushed. If a tag was pushed and must be pulled, deprecate that version on npm. Nothing on the client was migrated.
- Migration reversibility: no schema.

## Divergence Gate

Removed. This spec has no Product Spec.
