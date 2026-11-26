# Engineering Spec Quality Checklist: Visible Human Support Status in Shopping Assistant

**Purpose**: Validate the engineering spec before planning or implementation
**Created**: 2026-11-26
**Feature**: [spec.md](../spec.md)

## Inheritance

- [x] Exactly one Product Spec is referenced
- [x] Pinned version is an immutable commit or tag, not a bare URL or ID
- [x] The inheritance section matches the format required by the constitution, field for field
- [x] Architecture doc is either `none` or pinned by commit/tag
- [x] Inherited binding decisions are listed
- [x] The spec does not redefine problem, scope rationale, user journeys or success criteria
- [x] Divergences is `none`, or links to an amendment in the product repository

## Technical Completeness

- [x] Scope in this repository is bounded, and what other repos own is named
- [x] Current state references real paths in this codebase
- [x] Technical approach names the components affected and the flow between them
- [x] Every changed public interface appears in Contracts with its SemVer impact
- [x] Backward compatibility or a deprecation path is stated for each breaking change
- [x] Data model and migration reversibility are covered, or the feature persists nothing
- [x] Peak load is declared as a peak, with its window
- [x] Observability states what is logged, with which context, and which correlation identifier
- [x] Failure handling states timeouts, retriable failures, bounds and idempotency
- [x] The trust boundary and the server-side authorization check are identified

## Verifiability

- [x] Every success or acceptance criterion maps to a test in this repository
- [x] Flow coverage covers complete use cases, not only isolated methods
- [x] Failure paths are covered, not only the success path
- [x] Rollout and rollback are described, and rollback is safe

## Constitution

- [x] Every principle this feature touches has a row in Constitution Alignment
- [x] Every departure from a MUST is justified in the spec, not left to the code
- [x] No obligation of the constitution is left as an unfilled placeholder

## Notes

- Validation iteration 1: all items pass.
- The Product Spec and the architecture document are pinned by commit SHA because neither tag exists yet. Constitution II requires the Product Spec to be tagged; the departure is justified in `Constitution Alignment` (row II) with a re-pin follow-up.
- Validation iteration 2 (2026-11-26): the only `[NEEDS CLARIFICATION]` marker, live correlation of server-side redirect failures, was resolved by the developer with option A. Reconnect reconciliation only, no contract change. It is recorded in `Implementation Decisions`, and `## Open Questions` was removed. No markers remain; all items pass.
- The AI-mode status change on enabled channels (`status` removed on local send instead of `'sent'`) is recorded as a justified exception in Constitution IV and announced under `Changed`.
