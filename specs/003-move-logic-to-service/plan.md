# Implementation Plan: Move logic to service

**Branch**: `003-move-logic-to-service` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-move-logic-to-service/spec.md`

## Summary

`@weni/webchat-service` takes the storefront, cart, starter-trigger, and voice-session rules that still live in `webchat-react`. New modules under `src/modules/` own the rules. `src/index.js` only delegates. The first pull request adds the TypeScript toolchain and the storefront contract. Voice is a second minor after that slice is in production. `getStarters(productData)` stays.

## Technical Context

**Language/Version**: TypeScript 5 for new modules (`strict` already in `tsconfig.json`, target ES2020). Existing facade stays JavaScript.
**Primary Dependencies**: `eventemitter3` (existing). Dev: `@rollup/plugin-typescript`, `@babel/preset-typescript`, `typescript-eslint`. `typescript` is already installed.
**Storage**: `StorageManager` key `weni:webchat:storefront` for the snapshot and pending cart. Session conversation blob unchanged. Voice is not persisted.
**Testing**: Jest 29 with `babel-jest` and the TypeScript preset. New tests are `src/modules/<area>/tests/*.test.ts`. Browser APIs and `fetch` are mocked.
**Target Platform**: Browser library (CJS, ESM, UMD) consumed by the widget.
**Project Type**: Single headless library.
**Performance Goals**: One instance per page. One starters round-trip, one cart flush, and one streaming reply in the same second during a Black Friday weekend peak.
**Constraints**: No new runtime dependency. Do not grow `src/index.js` with rule bodies. Do not change `buildStartersRequest` or existing event names. Logs omit shopper content. HTTP timeout 10s. Cart flush is not retried. The voice port is one TypeScript file per current module under `src/modules/voice/`. Do not merge `TTSPlayer` and `VoiceService`.
**Scale/Scope**: Storefront module, `StarterSession`, voice module, facade delegations, `SERVICE_EVENTS`, `index.d.ts`, changelog, README.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Spec origin** — PASS. `spec.md` opens with Origin Without Product Spec. Nothing inherited to diverge from.
2. **Public contract and SemVer** — PASS. Methods and events in the contracts are additive. Minor after `1.19.2`. `getStarters(productData)` is unchanged.
3. **Security** — PASS. No new secret. Voice tokens stay inside the voice module. Product JSON is checked before `getStarters`.
4. **Observability** — PASS. Structured warn/error with module prefix, `operation`, `connectionState`, channel UUID, session id, and starters fingerprint or message id. No message text.
5. **Type safety and toolchain** — PASS. First PR adds Rollup, Jest, and ESLint support for `.ts` before feature modules. `index.d.ts` updates with the public API.
6. **File size and naming** — PASS. New files are focused modules under `src/modules/`. Class files use PascalCase. The facade only delegates.
7. **Transport and data boundaries** — PASS. Host-page HTTP and DOM reads sit in `src/modules/storefront/`. Wire builders stay in `messageBuilder.js`.
8. **Async state** — PASS. Pending, success, and failure are events in `data-model.md`. A failed flush does not mark the item flushed.
9. **Tests and coverage** — PASS. Quickstart names the suites. Global coverage stays at or above 80%.
10. **Changelog** — PASS. `CHANGELOG.md` and README ship in the same pull request as each minor.

No unjustified MUST departure. Re-checked after Phase 1: contracts add optional methods only, and the new storage key is ignored by `1.19.2`. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/003-move-logic-to-service/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── storefront-api.md
│   └── voice-session.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── index.js                         # delegate only
├── types/index.d.ts                 # new method and event types
├── utils/constants.js               # SERVICE_EVENTS additions
├── core/StorageManager.js           # read/write the new key only
└── modules/
    ├── storefront/                  # new, TypeScript
    ├── conversation/StarterSession.ts
    └── voice/                       # second slice, TypeScript
rollup.config.js                     # @rollup/plugin-typescript
jest.config.js                       # .ts transform and coverage
eslint.config.mjs                    # lint .ts
CHANGELOG.md
README.md
```

**Structure Decision**: Single library. New behavior is TypeScript modules. Existing JavaScript stays. Top-level `tests/` is not reorganized. Colocated tests live under `src/modules/<area>/tests/`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | The TypeScript toolchain is the constitution's required companion to the first new file, not an extra pattern. | Shipping the modules as `.js` would violate Principle X. |

## Inherited Context

- Product Spec: none
- Engineering Spec: `specs/003-move-logic-to-service/spec.md`

## Delivery Sequence

1. Toolchain — Rollup, Jest, and ESLint accept `.ts`, with one smoke test, before feature code.
2. Storefront module and `StarterSession` — snapshot, starters trigger, checkout signal, pending cart, availability notify, storage key.
3. Facade delegations, `SERVICE_EVENTS`, and `index.d.ts` for the storefront contract.
4. Storefront tests from the quickstart, then changelog and README. Publish the minor.
5. Voice module, its events, and its tests. Publish a second minor. Do not start step 5 before step 4 is in production.

**Cross-repository coordination**: `webchat-react` `specs/010-move-logic-to-service` deletes its copies only after the matching minor is on npm. This plan does not edit the widget.

## Peak Load Plan

- Declared peak: one in-page instance, Black Friday weekend, one streaming reply plus one starters round-trip plus one cart flush in the same second.
- How this plan sustains it: no extra socket, no extra shopper session, and no conversation rewrite. The snapshot is one small JSON key. Starters still use the existing socket send.
- How it is verified: Jest covers one snapshot, one starters send, and one flush in a single test process. No multi-user load harness. The library never hosts concurrent shoppers.

## Observability Plan

- Structured logs added: `console.warn` / `console.error` from the storefront and voice modules with `{ operation, connectionState }` and a module prefix.
- Correlation identifier: channel UUID and session id from the existing session, plus the starters fingerprint or message id when the operation has one.
- Error reports: `cart:failed` and `voice:error` carry `operation` and, for STT retries, `attempt`. They do not carry product JSON, cart lines, transcript text, or tokens.
- Signals watched after rollout: widget reports of starters and cart still succeeding on a product page, and absence of logs that contain message text. There is no new server metric in this library.

## Rollout and Rollback Plan

- Rollout: minor publish of `@weni/webchat-service` for the storefront slice, then a later minor for voice. No flag. The widget pins the peer afterward.
- Backward compatibility window: `1.19.2` consumers keep working. New methods are unused until the widget bump.
- Rollback: republish `1.19.2` only after the widget peer is back on `1.19.2`. The widget plan restores the deleted modules in that revert.
- Migration reversibility: `weni:webchat:storefront` can remain after rollback. `1.19.2` does not read it. The session blob is untouched.

## Divergence Gate

Removed. This spec has no Product Spec.
