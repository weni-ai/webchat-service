<!--
  SYNC IMPACT REPORT
  ==================
  Version change: 1.0.0 → 2.0.0 (MAJOR: principles redefined and renumbered
  to adopt the VTEX CX engineering + frontend base constitutions)

  Modified principles:
    - I. Clear, Idiomatic JavaScript Modules → split into IX. Code as
      Documentation, X. Type Safety (TypeScript-first, redefined),
      XI. Single Responsibility (350-line SHOULD added; 500-line MUST kept)
    - II. WebSocket Contract & Configuration Discipline → XIV. WebSocket
      Contract & Data Boundaries (adds camelCase normalization at adapters)
    - III. Security & Least Privilege → VII. Security & Secrets (adds
      runtime injection and dependency vulnerability checks)
    - IV. Test-First Quality Gates → Quality Standards / Testing (adds
      colocation and behavior-focused rules)
    - V. Resilience & Error Handling → VIII. Observability +
      XVI. Resilience & Error Handling
    - VI. Release & Package Distribution → IV. Versioned Public Contracts +
      V. Release & Changelog Maintenance
  Added principles:
    - I. Version Control and Review
    - II. Specification Traceability
    - III. No Silent Divergence
    - VI. Commit Messages
    - XII. Naming Conventions
    - XIII. Module & Public API Architecture
    - XV. State Management & Async Correctness
  Added sections:
    - Quality Standards (Testing, Accessibility, Performance,
      Internationalization, Defensive Programming, Maintainability)
    - UI and Styling Standards (Styling Standards, BEM Methodology)
  Removed sections: None (Engineering Standards, Delivery Workflow and
    Governance retained and updated)

  Project exceptions (approved by maintainer on 2026-10-01):
    - X. Type Safety: base MUST kept; the first change that adds a source
      file MUST also add TypeScript support to the toolchain.
    - XII. Naming Conventions: files exporting a single class keep
      PascalCase file names.
    - Testing: new tests colocated under src/<area>/tests/; the legacy
      top-level tests/ directory migrates incrementally.

  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ Constitution Check present
    - .specify/templates/spec-template.md ⚠ lacks the mandatory
      "Inheritance from Product Spec" section (template not modified by
      this amendment; add the section manually in each new spec)
    - .specify/templates/tasks-template.md ✅ phased structure compatible

  Follow-up TODOs:
    - TODO(BRANCH_PROTECTION): confirm GitHub branch protection on the main
      branch requires one approval and green CI (not verifiable from repo).
    - TODO(PR_CI_LINT): linting-on-push.yaml runs on push only; add a
      pull_request trigger so lint is a required PR check.
    - TODO(DEPENDENCY_AUDIT): no vulnerability scan in CI (e.g. npm audit
      or Dependabot); add one to satisfy VII.
    - TODO(TS_TOOLCHAIN): Rollup input is src/index.js without a TS plugin,
      Babel has no TS preset, Jest matches *.test.js only, ESLint lints .js
      only. Must be resolved by the first change that adds a source file.
    - TODO(CHANGELOG_BACKFILL): CHANGELOG.md stops at 1.10.3 while
      package.json is 1.17.2; backfill 1.11.0–1.17.2.
    - TODO(RELEASE_COMMITS): npm version commits use bare "1.x.y" messages;
      switch to `npm version <bump> -m "chore: release %s"`.
    - TODO(SPEC_001_INHERITANCE): specs/001-pdp-starters-bridge/spec.md
      lacks the "Inheritance from Product Spec" section.
    - TODO(SNAKE_CASE_PAYLOADS): emitted message payloads expose
      snake_case fields (e.g. product_items); normalizing them is a breaking
      change and needs a deprecation path per IV.
    - TODO(CONSOLE_LOGGING): StorageManager logs free-text console.error /
      console.warn; migrate to structured context per VIII.

  Provenance:
    - Source: weni-ai/vtex-cx-engineering-constitutions (main)
    - Bases: base-constitution.md, frontend/base-constitution.md
    - Domains: frontend
    - Precedence: root > frontend > project layer
-->

# Weni WebChat Service Constitution

## Core Principles

### I. Version Control and Review

All code MUST enter the main branch through a pull request. A merge MUST
require at least one approved review and a green CI run (`unit-tests.yaml`
with the coverage gate, and `linting-on-push.yaml`). Direct pushes to the
main branch MUST be blocked via GitHub branch protection.

**Rationale:** the policy is only real when enforced by the platform, not by
trust. Peer review and a protected main branch keep history auditable and
prevent unreviewed changes from reaching the published NPM package.

### II. Specification Traceability

Every engineering spec under `specs/<feature>/` MUST derive from exactly one
approved product spec and MUST reference it through an immutable, pinned
version (commit or tag); a mutable URL or ID alone MUST NOT be used. The
product spec MUST exist and be tagged before its engineering spec is created.
An engineering spec MUST NOT redefine the "what" it inherits: problem, scope,
success criteria, and binding decisions belong to the product spec. A
technical architecture document SHOULD be produced for non-trivial features;
when it exists it MUST be linked from the engineering spec, pinned by
commit/tag, but its absence MUST NOT block the engineering spec.

Every engineering spec MUST open with an inheritance section in exactly this
format:

```
## Inheritance from Product Spec
- Product Spec: <title> — <URL>
- Pinned version: <commit/tag>
- Architecture doc: <none | URL + commit/tag>
- Inherited binding decisions: <short list>
- Scope of this spec: <slice implemented by this repo>
- Divergences: <none | link to amendment>
```

For this repository, "Scope of this spec" MUST state which slice of the
cross-repo flow (e.g. webchat-react ↔ webchat-service ↔ weni-webchat-socket)
the library implements.

**Rationale:** traceability from product intent to technical execution keeps
decisions auditable. Pinning the version guarantees every repository in the
flow implements the same version of the feature. A single inheritance format
keeps the link machine-checkable across repositories.

### III. No Silent Divergence

When a technical need contradicts something inherited from the product spec —
scope, success criteria, or a binding decision — the divergence MUST NOT be
implemented silently in code. It MUST be raised as an amendment in the product
repository and recorded in the `Divergences` field of the engineering spec's
inheritance section, linking to that amendment. Once the amendment is approved
and produces a new tag, the engineering spec's `Pinned version` MUST be
updated to it. A technical difference that contradicts nothing inherited is an
implementation decision and MUST live in the engineering spec.

**Rationale:** with the product spec as single source of truth, a silent code
deviation makes intent and implementation drift apart with no audit trail.

### IV. Versioned Public Contracts

The public contract of `@weni/webchat-service` comprises: the exported API
(`src/index.js` and `src/types/index.d.ts`), initialization options and their
defaults, emitted event names and payload shapes (`SERVICE_EVENTS` in
`src/utils/constants.js`), WebSocket message formats, and browser storage
keys. Any change to it MUST be versioned following SemVer. Changes MUST be
backward compatible or ship with an announced deprecation path. Silent
breaking changes MUST NOT be introduced; a breaking change MUST trigger a
MAJOR version discussion before merge.

**Rationale:** the package is consumed by multiple Weni frontends (React, Vue,
vanilla JS); explicit versioning and deprecation give them a predictable path
to adapt without outages.

### V. Release & Changelog Maintenance

`CHANGELOG.md` MUST follow Keep a Changelog. Every user-facing change MUST
appear under the appropriate category (Added, Changed, Deprecated, Removed,
Fixed, Security) in the same pull request that introduces it. Version bumps
MUST follow SemVer and be published through the tag-driven
`npm-publish.yaml` workflow (`x.y.z` → `latest`, `x.y.z-staging*` →
`staging`).

- Release-impacting changes MUST state whether they require a new NPM
  version, a consumer update, or a coordinated rollout.
- Required follow-up in consumer applications MUST be captured in the plan,
  README, or pull request notes.
- Changes to the Node.js version, build tooling (Rollup, Babel, TypeScript),
  or runtime dependencies MUST include compatibility verification steps.

**Rationale:** a maintained changelog communicates impact to consumers and
serves as release documentation; SemVer alignment keeps upgrades predictable.

### VI. Commit Messages

Commits MUST follow Conventional Commits: `<type>: <description>`. Allowed
types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`. The description
MUST be imperative, specific, and no longer than 50 characters. Commits MUST
be atomic: one logical change per commit. Release commits produced by
`npm version` MUST also conform (e.g. `npm version minor -m "chore: release %s"`).

**Rationale:** conventional commits enable automated changelog generation and
semantic versioning; atomic commits simplify bisecting, reverting, and review.

### VII. Security & Secrets

Secrets MUST never be committed to the repository. Library credentials and
session tokens MUST be supplied at runtime by the consumer through
initialization options, never hardcoded; CI secrets MUST come from GitHub
secrets or OIDC (as `npm-publish.yaml` does). Access MUST follow least
privilege by default. Dependencies MUST come only from the npm registry or
other trusted sources and MUST be checked for known vulnerabilities.

- Tokens and credentials MUST flow through `SessionManager` /
  `StorageManager` and MUST NOT be written to console output or events.
- Permission assumptions (microphone, camera) MUST be documented when a
  feature requires new browser API access.
- Dependencies affecting authentication, transport, or data encoding MUST be
  introduced deliberately and justified in the plan or research.

**Rationale:** the library handles session tokens, user messages, audio/video
streams, and file uploads; leaked credentials and untrusted dependencies are
among the most damaging breaches.

### VIII. Observability

Diagnostic output MUST be structured and MUST never contain secrets or
sensitive personal data (tokens, message content, media, contact data).
Errors MUST be surfaced through error events or rejected promises carrying a
structured context object (operation, connection state, message type, retry
attempt). Errors MUST carry the correlation identifiers available in the
protocol (e.g. message ID, request type) so consumer, library, and socket
server logs can be joined. Console output MUST be limited to `console.warn` /
`console.error` with a module prefix and a structured context argument.

**Rationale:** structured, privacy-safe telemetry makes incidents across
consumer apps diagnosable without creating new data-exposure risks.

### IX. Code as Documentation

All code MUST be written in English, including identifiers, comments, and
documentation; domain terms or acronyms meaningful only in the original
language MAY remain untranslated. Code MUST prioritize readability over
brevity. Every non-trivial decision MUST be documented with comments that
explain the "why" (intent, trade-offs, browser caveats for WebSocket,
MediaRecorder, `localStorage`), not the "what". Exported functions and types
MUST have JSDoc (or TSDoc) describing behavior, parameters, and return
values. Debug code, dead branches, and commented-out implementations MUST
NOT be committed.

**Rationale:** a library debugged across diverse consumer environments needs
globally readable code; comments that explain reasoning stop future
developers from breaking invariants they cannot see.

### X. Type Safety

All new files (source and tests) MUST be written in TypeScript. Existing
JavaScript files SHOULD only be modified for bug fixes or small changes;
substantial modifications SHOULD include migration to TypeScript. Type
definitions MUST be explicit; `any` SHOULD be avoided except when
interfacing with untyped external libraries. `strict` MUST remain enabled in
`tsconfig.json`.

- The first change that adds a new file MUST also make the toolchain
  TypeScript-capable: Rollup MUST compile `.ts` sources into the CJS, ESM,
  and UMD bundles; Jest MUST transform and match `.ts` tests and include
  them in coverage; ESLint MUST lint `.ts` files.
- While JavaScript sources remain, `src/types/index.d.ts` MUST be updated in
  the same pull request as any public API change.

**Rationale:** static typing catches errors at compile time and documents the
public contract inline; gradual migration allows adoption without blocking
delivery, and coupling it to the first new file avoids an indefinite delay.

### XI. Single Responsibility

Each file SHOULD contain no more than 350 lines of code; production modules
in `src/` exceeding 500 lines MUST be justified in the plan or refactored.
Each function MUST have only one responsibility. Complex conditionals MUST be
abstracted into descriptive boolean variables. When UI templates exist,
template logic MUST be extracted to computed properties or methods.
`src/index.js`, `src/core/WebSocketManager.js`, and
`src/core/MessageProcessor.js` already exceed these limits; changes to them
SHOULD extract new responsibilities into focused modules instead of growing
them.

**Rationale:** small, focused units are easier to test, review, and refactor;
large multi-purpose files hide bugs.

### XII. Naming Conventions

Variables and functions MUST use `camelCase`. Classes and components MUST use
`PascalCase`. Directory names MUST be lowercase. File names MUST be
lowercase, with one exception: a file whose primary export is a single class
MUST be named after that class in `PascalCase` (e.g. `SessionManager.js`,
`RetryStrategy.js`). Module-level constant maps MAY use `UPPER_SNAKE_CASE` as
established in `src/utils/constants.js`. Abbreviations MUST be avoided unless
universally understood; clarity MUST take precedence over conciseness.

**Rationale:** consistent naming reduces cognitive load and keeps the codebase
searchable. The class-file exception matches the established structure of
`src/core`, `src/modules`, and `src/network`, where renaming would add churn
without benefit.

### XIII. Module & Public API Architecture

The library is a headless service: `src/index.js` is a facade that MUST
delegate non-trivial logic to focused modules grouped by concern (`core/`,
`modules/`, `network/`, `utils/`, `types/`). Modules MUST be named
descriptively for their purpose. Initialization options and method
parameters MUST have descriptive names (e.g. `sessionToken`, not `tk`).
Callback options supplied by consumers MUST be prefixed with `on`. Methods
that react to events or update state SHOULD be prefixed with `handle` (e.g.
`handleDisconnect`). State variables MUST clearly reflect what they represent
(e.g. `isConnected`, `isRecordingAudio`).

Exception: emitted event names follow the `domain:action` pattern declared in
`SERVICE_EVENTS` (e.g. `message:received`) instead of an `on` prefix,
because they are part of the published contract (IV) and the `on` prefix is
the consumer-side listener convention.

**Rationale:** a predictable module structure keeps the codebase navigable;
clear naming of options, handlers, and state makes the integration surface
self-documenting.

### XIV. WebSocket Contract & Data Boundaries

Network I/O MUST be encapsulated in dedicated transport modules
(`WebSocketManager`, `network/`, or a dedicated adapter for any future HTTP
integration), never in the facade or utilities. Message behavior MUST be
deterministic from the incoming payload, configuration, and documented
defaults.

- Incoming messages MUST be validated and normalized at the boundary before
  reaching internal logic; business logic MUST live outside handler bodies
  (`MessageProcessor`, `SessionManager`, utilities).
- Internal code MUST use camelCase. Backend snake_case fields MUST be
  normalized at the adapter layer and MUST NOT leak into state, business
  logic, or emitted payloads. Outbound wire-format builders
  (`src/utils/messageBuilder.js`) MAY use the backend naming convention.
  Existing snake_case fields in emitted payloads MUST change only through
  the deprecation path in IV.
- Configuration MUST come from initialization options or documented
  defaults, never hardcoded values.
- Connection lifecycle operations (connect, disconnect, reconnect,
  ping/pong) MUST be documented with their event shapes and state
  transitions.
- Network operations MUST set explicit timeouts and retries appropriate to
  their context; transport errors MUST NOT surface as unhandled exceptions.

**Rationale:** separating transport from logic enables reuse and mocking;
normalizing at the edge decouples the library from backend implementation
details and keeps the codebase consistent.

### XV. State Management & Async Correctness

Shared runtime state MUST be managed through `StateManager`; persisted state
MUST go through `SessionManager` / `StorageManager`. State MUST NOT be
duplicated across modules. Related state SHOULD be grouped in logical
objects; module-local state SHOULD be preferred when it is not shared.

Async operations (connect, send, upload, recording, history, starters) MUST
track pending, success, and error states consistently and expose them via
promises, events, or state. Silent failures MUST NOT occur. Contradictory
states (e.g. connected and reconnecting simultaneously) MUST be prevented.
Double submissions MUST be guarded against. When an optimistic update (e.g.
`message:added` before server acknowledgment) fails, state MUST be rolled
back or marked failed and the change emitted.

**Rationale:** incorrect async state is among the most common sources of bugs
and broken UX in consumers; a single source of truth keeps data flow
traceable.

### XVI. Resilience & Error Handling

Library behavior MUST be diagnosable from events, error callbacks, and
explicit failure paths.

- Error handling MUST distinguish retriable failures (disconnects, timeouts)
  from permanent validation or contract errors.
- Reconnection, retry, and backoff strategies MUST be configurable and
  documented with their defaults.
- Features affecting connection lifecycle, queueing, or persistence MUST
  document failure modes and recovery behavior.
- Exception swallowing is forbidden unless explicit recovery behavior and
  error event emission are present.

**Rationale:** the library maintains persistent connections over unstable
networks; weak error handling makes message loss and state corruption hard
to reproduce.

## Quality Standards

### Testing

Every behavior change MUST be backed by automated tests before review. New
behavior MUST include tests that fail before implementation and pass
afterward; bug fixes MUST include a regression test whenever feasible.
Modules with business logic MUST have unit tests; WebSocket message flow and
connection lifecycle tests MUST exist when message contracts, external
interactions, or state management change.

- New tests MUST be colocated with the code they test in `src/<area>/tests/`
  (precedent: `src/utils/tests/helpers.test.js`). Tests in the top-level
  `tests/` directory SHOULD move next to their module when that module is
  substantially changed; shared fixtures move with them or to
  `src/<area>/tests/_helpers/`.
- Tests MUST verify behavior and outcomes, not implementation details. Tests
  MUST NOT be added solely to raise coverage. A test that would still pass
  after a regression MUST be fixed or removed.
- Tests MUST NOT hit live WebSocket servers or network; transports and
  browser APIs MUST be mocked.
- Global coverage (statements, branches, functions, lines) MUST stay at or
  above the CI `COVERAGE_THRESHOLD` (default 80%); changed modules SHOULD
  reach 80% line and branch coverage unless the plan records an exception.
- ESLint (with Prettier) and Jest MUST pass locally before review and in CI
  before merge.

**Rationale:** colocated, behavior-focused tests survive refactors and are
easy to discover; regressions in a shared library are cheap to introduce and
expensive to detect across consumers.

### Accessibility

The library ships no rendered UI today. Any UI it ships MUST make interactive
elements keyboard accessible, give form inputs associated labels, never use
color as the only means of conveying information, give images meaningful
`alt` text (or `alt=""` when decorative), and keep focus states visible.
Data the library emits for rendering (e.g. file names, media metadata) MUST
be sufficient for consumers to meet these rules.

**Rationale:** accessibility is a legal requirement in many jurisdictions and
improves usability for all users.

### Performance

Unused dependencies MUST be removed; runtime dependencies MUST be minimal and
justified (currently only `eventemitter3`). Heavy computations (e.g. MP3
encoding, message stream processing) MUST be memoized, debounced, or kept
off hot paths when triggered by frequent events. Bundled assets MUST be
optimized. Bundle size impact SHOULD be measured against the current
`dist/` output before adding a dependency. Initial load SHOULD prioritize
what consumers need above the fold (e.g. defer recorder and converter work
until used).

**Rationale:** the library runs inside storefronts where bundle size and main
thread time directly affect conversion.

### Internationalization

User-facing strings MUST NOT be hardcoded; they MUST be externalized to
locale files, and locale files SHOULD keep parity across supported languages.
New user-facing strings introduced in a PR MUST be localized before merge.
Developer-facing error and log messages are not user-facing strings and MUST
be in English (IX). The library MUST respect the configured language when it
formats dates, numbers, or currency for display; otherwise it MUST emit raw
values (ISO timestamps, numbers) for consumers to format.

**Rationale:** externalized strings enable translation without code changes;
leaving display formatting to the locale-aware layer prevents inconsistent
output.

### Defensive Programming

Defensive guards (null checks, fallback branches, runtime assertions) SHOULD
only be added when the invalid state is realistically reachable — for
example, at the WebSocket and browser API boundaries. Root causes MUST be
fixed rather than masked. Guards MUST follow the patterns already established
in the surrounding code (e.g. `src/utils/validators.js`).

**Rationale:** unnecessary guards obscure real logic; fixing root causes
yields more robust code than layers of protection.

### Maintainability

Business rules (allowed file types, size limits, message type mapping,
retry policy) MUST NOT be duplicated; they MUST be centralized in a single
source of truth such as `src/utils/constants.js`. Local duplication of
utility code MAY exist when extraction would create unnecessary coupling.
Abstractions SHOULD only be created when a clear pattern exists across
multiple use cases.

**Rationale:** premature abstraction creates coupling worse than the
duplication it removes; centralize rules, tolerate incidental duplication.

## UI and Styling Standards

The library ships no markup or CSS today. These rules apply to any styles the
repository introduces.

### Styling Standards

CSS selectors MUST use classes only; IDs MUST be reserved for JavaScript
targeting when no alternative exists. Nested selectors SHOULD be avoided.
Design system tokens (colors, spacing, typography) MUST be used instead of
hardcoded values whenever available.

**Rationale:** avoiding IDs and deep nesting prevents specificity wars;
tokens are the single source of truth for the visual language.

### BEM Methodology

CSS class names MUST follow BEM. Blocks MUST be independent components
(`.button`). Elements MUST use double underscores (`.button__text`).
Modifiers MUST use double hyphens (`.button--large`). Elements MUST NOT be
nested in class names (`.block__elem`, not `.block__elem1__elem2`).

**Rationale:** BEM provides scoped, collision-free CSS that does not clash
with the host storefront's styles.

## Engineering Standards

- Runtime code targets ES2020 and MUST stay compatible with the build
  targets in `rollup.config.js` and `tsconfig.json`.
- The build MUST produce valid CJS, ESM, and UMD bundles plus TypeScript
  declarations.
- CI runs on Node.js 24; dependencies MUST be added through `npm` with the
  lockfile updated in the same pull request.
- Formatting and linting MUST follow `eslint.config.mjs` (Prettier rules:
  2 spaces, single quotes, semicolons, trailing commas, 80 columns, LF).
- External integrations (WebSocket, browser media and storage APIs) MUST sit
  behind thin, event-driven adapters so logic stays testable with mocks.
- README documentation for new initialization options, events, lifecycle
  changes, and migration steps MUST be updated alongside code.

## Delivery Workflow

- Specs MUST open with the "Inheritance from Product Spec" section (II) and
  capture user scenarios, edge cases, functional and non-functional
  requirements, and measurable success criteria before planning.
- Plans MUST include a Constitution Check covering: spec traceability and
  divergences, public contract and SemVer impact, security, observability,
  type safety and toolchain, file size and naming, transport and data
  boundaries, async state correctness, tests and coverage, and changelog.
- Tasks MUST include test work, security or configuration work, changelog
  and README updates, and any consumer-facing follow-up required for release.
- Pull requests MUST explain behavioral impact, breaking changes, and
  required consumer migration.
- Complexity exceptions MUST be documented in the plan with the simpler
  alternative that was rejected.

## Governance

This constitution is the authoritative engineering policy for the Weni
WebChat Service repository and supersedes other practices. It is derived from
the VTEX CX engineering base and frontend base constitutions; on conflict,
engineering base rules prevail over frontend rules, which prevail over
project-specific adaptations. All specifications, plans, tasks, and reviews
MUST enforce it.

**Amendment Process**:
1. Propose changes in a pull request that updates
   `.specify/memory/constitution.md` and any affected templates.
2. Record the version bump rationale and provenance in the Sync Impact
   Report.
3. Obtain approval from the maintainers responsible for the library and its
   package distribution.
4. Re-sync with the base constitutions when they change; a project
   exception to a base MUST be stated in the affected article with its
   justification.

**Versioning Policy**:
- MAJOR: remove or materially redefine a principle or governance rule.
- MINOR: add a principle or section, or materially expand guidance.
- PATCH: clarify wording, examples, or non-semantic guidance.

**Compliance Review**:
- Every plan MUST pass the Constitution Check before design and after
  design is complete; `/speckit.analyze` MUST treat a violated MUST as
  CRITICAL.
- Every pull request MUST show how tests, error handling, contract impact,
  and the changelog were addressed.
- Reviewers MUST reject changes that bypass required tests, security rules,
  or release coordination.
- Open exceptions MUST be documented in the plan or pull request and
  approved explicitly.

**Version**: 2.0.0 | **Ratified**: 2026-03-09 | **Last Amended**: 2026-10-01
