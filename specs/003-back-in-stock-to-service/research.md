# Research: Back-in-stock logic and request in the service

## TypeScript in the existing Rollup and Jest pipeline

**Decision**: Compile `.ts` with Babel, and typecheck with `tsc --noEmit`. Add `@babel/preset-typescript` and `@rollup/plugin-babel`. Do not add `@rollup/plugin-typescript`.

**Rationale**: Jest already transforms `.js` with `babel-jest` and `babel.config.js`. One preset strips types for both Rollup and Jest, so the bundles and the tests run the same output. `typescript` `^5.3.3` is already a devDependency, and `tsconfig.json` already has `strict: true`. `tsc --noEmit` is what actually enforces that strictness; Babel only erases types. A new `npm run typecheck` script runs before lint in the local gate.

**Alternatives considered**:

- `@rollup/plugin-typescript`: typechecks during the bundle, but Jest would still need a second transform, and a mixed `.js` / `.ts` program pulls the existing JavaScript into a project that is not typed. The constitution allows the existing `.js` files to stay.
- `tsc` as the bundler: `tsconfig.json` emits declarations into `dist/`, which would overwrite the hand-written `src/types/index.d.ts` copy step the package publishes. Rollup remains the bundler. The hand-written `src/types/index.d.ts` stays the published types and is updated in the same change. `npm run dev` (`tsc --watch`) is left as it is and is not the release build.

`tsconfig.json` changes for the check: `noEmit: true`, `allowJs: false`, `isolatedModules: true` (Babel compatibility), `rootDir` removed, `include` set to `src/**/*.ts`. Tests stay out of that project. Jest runs them through Babel. New tests are still `.ts`, which satisfies Principle X ("all new files").

## ESLint on TypeScript

**Decision**: Add `typescript-eslint` and parse `src/**/*.ts` and `tests/**/*.ts` with its parser. Change the lint script to `eslint src tests --ext .js,.ts`.

**Rationale**: The flat config in `eslint.config.mjs` parses JavaScript only. A `.ts` file with type syntax fails that parser. The parser does not change the Prettier rules already configured.

**Alternatives considered**: Leave `.ts` out of lint. Principle X says ESLint must lint `.ts` files in the same change that adds the first one.

## Where `libphonenumber-js` sits in the three bundles

**Decision**: Depend on `libphonenumber-js` at runtime. Import `libphonenumber-js/max`. Two Rollup configs share the same input and plugins:

- CJS and ESM: `external` includes `eventemitter3` and `libphonenumber-js/max`.
- UMD: `external` is only `eventemitter3`, so the phone library is bundled.

**Rationale**: webchat-react already depends on `libphonenumber-js` for as-you-type formatting. Keeping the import external in CJS and ESM lets the widget bundler resolve one copy. The UMD bundle is loaded from a script tag and has no bundler to resolve the import. `validateConfig` does not reject unknown keys, so the new init option does not need a validator change to be accepted. Numeric overrides are still checked (see the plan) so a bad timeout fails at construction.

**Alternatives considered**: Bundle `libphonenumber-js` in all three formats. The widget would ship two copies. Import the min metadata build. It disagrees with `isValidPhoneNumber` verdicts the widget gets from `/max` today, and the spec requires those verdicts.

## Retry timing

**Decision**: `BackInStockClient` waits `retryBaseDelayMs * 2^attempt` (500 ms, then 1 s) with no jitter. It does not use `src/network/RetryStrategy.js`.

**Rationale**: `RetryStrategy` is the WebSocket reconnect policy: 1 s base, jitter up to 1 s, and a shared attempt counter. Reusing it would change the delays the spec fixes and would couple a subscribe retry to the socket reconnect counter.

**Alternatives considered**: A `RetryStrategy` instance owned by the client, with jitter disabled. That still pulls a connection policy into an HTTP call. The delay formula is two lines.

## In-flight guard ownership

**Decision**: The pending map lives on the subscription object the facade constructs, one per `WeniWebchatService` instance.

**Rationale**: A module-level map would share in-flight requests across two instances and would leak between tests. The spec's "module-local" wording means the map is not `StateManager` state. Per instance still meets that, and nothing is persisted.

**Alternatives considered**: `StateManager`. The map is an implementation detail of one feature and is not read by the session or the socket.
