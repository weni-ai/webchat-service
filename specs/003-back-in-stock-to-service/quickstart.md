# Quickstart: Back-in-stock logic and request in the service

Proves the library side of `spec.md`. The widget side is `webchat-react` `specs/010-back-in-stock-to-service/quickstart.md`. Request and response shapes are in [contracts/back-in-stock-api.md](./contracts/back-in-stock-api.md). Field rules are in [data-model.md](./data-model.md).

## Prerequisites

- Node and npm, as this repo already uses.
- No storefront and no published npm release.

## Setup

```bash
npm install
```

The implementation adds `libphonenumber-js`, `@babel/preset-typescript`, `@rollup/plugin-babel`, and `typescript-eslint`. Re-run `npm install` after that change.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Expected:

- `typecheck` reports no errors under `strict`.
- `lint` covers `src/**/*.ts` and `tests/**/*.ts`.
- `npm test` runs `tests/backInStock.offer.test.ts`, `tests/backInStock.contact.test.ts`, `tests/backInStock.subscription.test.ts`, and `tests/service.backInStock.test.ts`, and the coverage gate stays green.
- `dist/index.cjs.js`, `dist/index.esm.js`, and `dist/index.umd.js` exist. The CJS and ESM files contain an import of `libphonenumber-js/max`. The UMD file does not.

## Scenarios the tests cover

1. Quantity `0` returns `isUnavailable: true` and the default seller. An unknown quantity and a product with no `items` return `false` and do not throw.
2. A Brazilian mobile number passes `validateBackInStockContact`. A blank name returns `errors.name === 'required'` and does not throw.
3. `subscribeBackInStock` with a stubbed `fetch` sends one POST whose JSON has `sku_id`, `phone`, `name`, `seller`, `sales_channel`, and `locale`. A 503 followed by 200 sends a second POST and resolves `{ accepted: true }`.
4. Two overlapping calls with the same SKU and phone call `fetch` once.
5. A 400 rejects `BackInStockError` with `code: 'HTTP'` and emits `backInStock:error`. The event payload has no `name` and no `phone`.

## Link for the widget

From this repo, after `npm run build`:

```bash
npm link
```

Then follow the widget quickstart. Rebuild this repo after each service change. The link serves `dist/`.
