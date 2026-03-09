<!--
  SYNC IMPACT REPORT
  ==================
  Version change: 0.0.0 → 1.0.0 (Initial adoption)
  Modified principles:
    - Added I. Clear, Idiomatic JavaScript Modules
    - Added II. WebSocket Contract & Configuration Discipline
    - Added III. Security & Least Privilege
    - Added IV. Test-First Quality Gates
    - Added V. Resilience & Error Handling
    - Added VI. Release & Package Distribution
  Added sections:
    - Engineering Standards
    - Delivery Workflow
    - Governance
  Removed sections: None
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ verified (Constitution Check present)
    - .specify/templates/spec-template.md ✅ verified (requirements and success criteria present)
    - .specify/templates/tasks-template.md ✅ verified (phased task structure with test-first support)
    - .specify/templates/commands/*.md ⚠ not present in this repository
  Follow-up TODOs: None
-->

# Weni WebChat Service Constitution

## Core Principles

### I. Clear, Idiomatic JavaScript Modules

Production code MUST be readable without extensive commentary. Exported
functions MUST have JSDoc comments, modules MUST have a single
responsibility, and the public API surface MUST delegate non-trivial
logic to focused internal modules (core, modules, utils, network).
Rationale: a client-side library consumed by multiple frameworks is
debugged across diverse environments, so clarity reduces mean time to
resolution.

- JavaScript code MUST favor explicit control flow, descriptive names,
  and small composable functions.
- Exported types and functions MUST include JSDoc comments describing
  behavior, parameters, and return values.
- Comments SHOULD explain intent, trade-offs, or browser-specific
  caveats (WebSocket, MediaRecorder, localStorage), not restate obvious
  code.
- Debug code, dead branches, and commented-out implementations MUST not
  be committed.
- Files exceeding roughly 500 lines MUST be justified in the plan or
  refactored into separate modules.

### II. WebSocket Contract & Configuration Discipline

Message behavior MUST be deterministic from the incoming payload, library
configuration, and approved external sources. Event contracts, connection
options, and lifecycle rules MUST be explicit in specs and documentation.
Rationale: a client-side WebSocket library fails unpredictably when
message contracts drift or configuration is implicit.

- Handlers MUST validate or normalize incoming messages at the boundary
  before dispatching to internal logic.
- Business logic MUST live outside the handler body when it can be tested
  independently (e.g., in MessageProcessor, SessionManager, or utility
  modules).
- Configuration MUST come from initialization options passed by the
  consumer or documented defaults, never from hardcoded values.
- Connection lifecycle operations (connect, disconnect, reconnect,
  ping/pong) MUST be explicitly documented with their expected event
  shapes and state transitions.
- Network calls to external services (WebSocket server, Weni Flows API)
  MUST set explicit timeouts and retries appropriate to the operation
  context.

### III. Security & Least Privilege

Sensitive data MUST be protected across code, logs, and browser storage
interactions. Rationale: this library handles session tokens, user
messages, audio/video streams, and file uploads, so accidental exposure
or over-permissive storage is high risk.

- Secrets and tokens MUST never be hardcoded, committed, or written to
  console logs in production builds.
- Token and credential access MUST flow through dedicated session or
  configuration modules (e.g., SessionManager, StorageManager).
- Permission assumptions (microphone, camera) MUST be documented when a
  feature requires new browser API access.
- External responses MUST be handled defensively, with actionable errors
  that do not leak sensitive payloads or internal state to consumers.
- Dependencies that affect authentication, transport (WebSocket), or
  data encoding MUST be introduced deliberately and documented in the
  plan or research.

### IV. Test-First Quality Gates

Every behavior change MUST be backed by automated tests before review,
and no feature is complete until quality gates pass. Rationale:
regressions in a client-side WebSocket library are cheap to introduce
and expensive to detect across consumer applications.

- New behavior MUST include tests that fail before implementation and
  pass afterward.
- Shared logic MUST have unit tests; WebSocket message flow, connection
  lifecycle, or integration tests MUST exist when message contracts,
  external service interactions, or state management changes.
- Changed modules SHOULD maintain at least 80% line and branch coverage
  unless the plan records an approved exception.
- Linting (ESLint), formatting, and tests (Jest) MUST pass locally
  before code review and in CI before merge.
- Bug fixes MUST include a regression test whenever technically feasible.

### V. Resilience & Error Handling

Library behavior MUST be diagnosable from events, error callbacks, and
explicit failure paths. Rationale: a client-side WebSocket library
maintains persistent connections across unstable network conditions; if
error handling is weak, message loss, connection drops, and state
corruption are difficult to reproduce.

- Error events MUST include enough context to trace the operation
  (connection state, message type, retry attempt) but MUST exclude
  tokens, credentials, and personal data.
- Error handling MUST distinguish retriable upstream failures (WebSocket
  disconnects, network timeouts) from permanent validation or contract
  errors.
- Reconnection, retry, and backoff strategies MUST be configurable and
  documented with their default behaviors.
- Features affecting connection lifecycle, queue management, or state
  persistence MUST document their failure modes and recovery behavior.
- Silent exception swallowing is forbidden unless explicit recovery
  behavior and error event emission are present.

### VI. Release & Package Distribution

Library changes MUST ship in a way that preserves semantic versioning
and downstream consumer compatibility. Rationale: this repo produces an
NPM package consumed by multiple Weni frontend applications across
React, Vue, and vanilla JS environments.

- Release-impacting changes MUST document whether they require a new
  NPM version, a consumer update, or a coordinated rollout.
- Tags and release notes MUST follow the documented semantic version
  workflow via GitHub Actions.
- Breaking API or behavioral changes (event names, initialization
  options, message formats, storage keys) MUST trigger a MAJOR version
  discussion before merge.
- Required follow-up in consumer applications MUST be captured in the
  plan, README, or pull request notes.
- Changes to the Node.js version, build tooling (Rollup, TypeScript),
  or runtime dependencies MUST include compatibility verification steps.

## Engineering Standards

- Runtime code targets ES2020 and MUST remain compatible with the
  browserslist configuration and build targets declared in
  `rollup.config.js`.
- Dependencies MUST be minimal, justified, and added through `npm`.
- External integrations (WebSocket, Weni Flows API, browser APIs) MUST
  prefer thin adapters behind event-driven interfaces so business logic
  remains testable with mocks.
- Documentation for new initialization options, event contracts,
  lifecycle changes, and migration steps MUST be updated alongside code.
- Formatting and linting conventions MUST follow ESLint standards;
  imports MUST be organized consistently.
- The library MUST produce valid CJS, ESM, and UMD bundles with
  TypeScript declarations.

## Delivery Workflow

- Specs MUST capture user scenarios, edge cases, functional requirements,
  non-functional requirements, and measurable success criteria before
  planning.
- Plans MUST include a Constitution Check covering readability, WebSocket
  contract boundaries, security, test coverage, error handling, and
  release impact.
- Tasks MUST include mandatory test work, configuration or security work,
  and any consumer-facing follow-up required for release.
- Pull requests MUST explain behavioral impact, breaking changes, and
  any required consumer migration.
- Complexity exceptions MUST be documented explicitly in the plan with
  the simpler alternative that was rejected.

## Governance

This constitution is the authoritative engineering policy for the Weni
WebChat Service repository. All specifications, plans, tasks, and code
reviews MUST enforce it.

**Amendment Process**:
1. Propose changes in a pull request that updates
   `.specify/memory/constitution.md` and any affected templates or
   command docs.
2. Record the semantic version bump rationale in the Sync Impact Report.
3. Obtain approval from the maintainers responsible for application code
   and package distribution before merge.
4. Update downstream guidance when a principle changes behavior expected
   in specs, plans, tasks, CI, or release operations.

**Versioning Policy**:
- MAJOR: Remove or materially redefine a principle or governance rule.
- MINOR: Add a principle or section, or expand requirements in a way
  that changes expected workflow.
- PATCH: Clarify wording, examples, or non-semantic guidance.

**Compliance Review**:
- Every plan MUST pass the Constitution Check before design begins and
  after design is complete.
- Every pull request MUST show how tests, error handling, and release
  impact were addressed.
- Reviewers MUST reject changes that bypass required tests, security
  rules, or release coordination.
- Open exceptions MUST be documented in the plan or pull request and
  approved explicitly.

**Version**: 1.0.0 | **Ratified**: 2026-03-09 | **Last Amended**: 2026-03-09
