# Research: Move logic to service

## TypeScript toolchain

- **Decision**: Add `@rollup/plugin-typescript` and `@babel/preset-typescript`. Point Rollup at `src/index.js` still, and let the plugin compile imported `.ts` modules. Extend Babel (already used by `babel-jest`) with the TypeScript preset so Jest can transform `.ts`. Add `typescript-eslint` and include `.ts` in `lint`. `typescript` and `tsconfig.json` (`strict: true`, `ES2020`, `DOM`) are already in the repo. New source and tests are `.ts`. `src/types/index.d.ts` stays the published contract and is updated by hand in the same pull request; Rollup does not replace it with a generated bundle of the whole facade, because the facade remains JavaScript.
- **Rationale**: Principle X requires the first new file to make Rollup, Jest, and ESLint accept TypeScript. Reusing Babel and the existing `tsconfig.json` avoids a second compiler (`ts-jest`) beside `babel-jest`.
- **Alternatives considered**: Leaving new modules as `.js` until a later toolchain PR — rejected, the constitution ties the toolchain to the first new file. Migrating `src/index.js` to TypeScript in this change — rejected, the spec limits the facade to delegations.

## Where the moved rules live

- **Decision**: `src/modules/storefront/` for page resolution, order form, custom fields, UTM, and availability notify. `src/modules/conversation/StarterSession.ts` for when to call the existing `getStarters` / `clearStarters`. `src/modules/voice/` for the pipeline now in `webchat-react/src/services/voice`. The facade in `src/index.js` only constructs these modules and re-emits their events.
- **Rationale**: Principle XI forbids growing `src/index.js` with the rule bodies. The widget files named in the spec are the behavior source; this library does not redesign the rules.
- **Alternatives considered**: One `StorefrontManager` class for cart, PDP, and voice — rejected, those are separate failure domains. Putting DOM reads in `src/utils/` — rejected, Principle XIV puts host-page I/O behind a module boundary.

## Public API shape

- **Decision**: Add `watchStorefront`, cart methods, and voice-session methods. Keep `getStarters(productData)` unchanged. New events are added to `SERVICE_EVENTS` with `domain:action` names from the spec. Version bump is minor after `1.19.2`.
- **Rationale**: Current consumers pass product data themselves. A required-argument change would be a major. The widget spec adopts the new methods and stops scraping.
- **Alternatives considered**: Replacing `getStarters` with a no-arg call — rejected in the spec.

## Persistence

- **Decision**: Persist the storefront snapshot and pending cart under `weni:webchat:storefront` via `StorageManager`. Do not add fields to the session blob. Voice state is memory only.
- **Rationale**: Rollback to `1.19.2` never reads that key. The session conversation format stays compatible with `specs/002-persist-uploaded-media`.
- **Alternatives considered**: Extra fields on the session object — rejected, a future session rewrite could drop unknown fields and a rollback story is harder to explain.

## Test file extension

- **Decision**: Colocated tests are `src/modules/<area>/tests/*.test.ts`, not `.test.js`. Jest `testMatch` and `collectCoverageFrom` gain the `.ts` patterns. `tsconfig.json` `exclude` of `tests` is narrowed so `src/**/tests` is typechecked and the top-level `tests/` directory can stay out.
- **Rationale**: The spec names the suites; Principle X requires new test files to be TypeScript. The top-level `tests/` tree is not moved in this plan.
- **Alternatives considered**: Adding `.test.js` beside `.ts` sources — rejected, new files must be TypeScript.

## Widget coordination

- **Decision**: Publish the storefront minor before any `webchat-react` deletion. Voice is a second minor on this same spec, after the storefront slice is in production. This plan does not edit the widget.
- **Rationale**: The widget peer is pinned at `1.19.2`. Deleting `vtex.js` before the new methods exist breaks the bundle.
- **Alternatives considered**: A feature flag inside the widget that keeps both implementations — rejected by the widget spec.
