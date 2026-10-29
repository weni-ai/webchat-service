# Implementation Plan: Persist uploaded media

**Branch**: `002-persist-uploaded-media` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-persist-uploaded-media/spec.md`

## Summary

Outgoing image, video, audio, and file messages must stay playable while the upload is in progress, and must not be written to browser storage until the socket ack carries the official `http(s)` link. The in-memory `media` is a `blob:` URL from `URL.createObjectURL`. The base64 body stays only on the send queue. `SessionManager` omits `data:` and `blob:` media on every save. `MessageProcessor` consumes `type: "ack"` and the facade swaps the blob URL for `message.media_url`, then revokes the blob.

## Technical Context

**Language/Version**: JavaScript (ES2020+), existing sources. No new source file, so the TypeScript toolchain stays out of this change.
**Primary Dependencies**: `eventemitter3`. Browser `URL.createObjectURL` / `URL.revokeObjectURL`. No new npm dependency.
**Storage**: `localStorage` or `sessionStorage` through `StorageManager` (`weni:webchat:` prefix). Stored `media` is only an official `http:` or `https:` URL.
**Testing**: Jest. Extend `tests/MessageProcessor.test.js`, `tests/service.sendPaths.test.js`, and the SessionManager tests. Mock `localStorage` and `URL.createObjectURL`.
**Target Platform**: Browser library consumed by the widget (`@weni/webchat-service`).
**Project Type**: Single headless library.
**Performance Goals**: One shopper tab, 5 media sends in one minute, files up to the existing 32MB limit. A stored message adds one short URL, not the file.
**Constraints**: Do not persist base64 or blob URLs. Do not add a source file. Do not grow `MessageProcessor` with matching logic. The wire payload stays `{ type, media }` with the base64 data URL.
**Scale/Scope**: `SessionManager`, `messageBuilder`, `AudioRecorder`, `MessageProcessor` (ack route only), `index.js` (preview + queue + ack apply), `constants.js`, changelog, and the tests above.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Clean Code & Readability** — PASS. Preview URL, upload body, and stored URL are three different values with one owner each. Matching and payload selection live in `messageBuilder.js`.
2. **Code Style Standards** — PASS. No new dependencies. Ack type dispatch is a `switch` case that already exists in `MessageProcessor.process`; the new work is one case, not a new map of handlers.
3. **Naming Conventions** — PASS. New helpers use `camelCase` in existing modules. The event name follows `domain:action` (`message:media-ack`).
4. **Testing & Quality Assurance** — PASS. Regression tests cover preview, storage omit, ack apply, invalid ack, duplicate ack, and send failure. Coverage gate stays at 80%.
5. **Semantic HTML & Unnnic** — N/A. This library renders no UI.
6. **Pre-Commit Compliance** — PASS. `npm run lint` and `npm test` before the pull request. Changelog Fixed entry in the same change.

No unjustified MUST departure. Re-checked after Phase 1: the contracts do not add a public required field or a storage migration that the previous version cannot read. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/002-persist-uploaded-media/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── media-ack.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── index.js                      # blob preview, queue upload body, apply ack
├── core/
│   ├── SessionManager.js         # omit data: and blob: on save
│   ├── MessageProcessor.js       # route type "ack"
│   └── StorageManager.js         # unchanged eviction
├── modules/
│   └── AudioRecorder.js          # expose the recording Blob on the stop result
└── utils/
    ├── messageBuilder.js         # upload body vs preview; pending-blob matcher
    └── constants.js              # MESSAGE_MEDIA_ACK event
tests/
├── MessageProcessor.test.js
├── service.sendPaths.test.js
└── SessionManager.test.js
CHANGELOG.md
```

**Structure Decision**: Single library. No new source file. Tests stay in the existing top-level `tests/` files that already cover these modules. Moving those files under `src/` is out of scope for this bug fix.

## Complexity Tracking

No constitution violation that needs a new pattern. `src/index.js` and `MessageProcessor.js` are already over the file-size guidance; this plan adds a short ack branch and a queue-item shape, and keeps the matcher in `messageBuilder.js`.

## Inherited Context

- Product Spec: none
- Engineering Spec: `specs/002-persist-uploaded-media/spec.md`

## Delivery Sequence

1. `SessionManager` omit rule — every later path is safe even if a caller still appends a preview.
2. `messageBuilder` helpers — payload reads an explicit upload body; matcher finds the oldest outgoing `blob:` message of the ack type (`document` matches `file`).
3. `AudioRecorder` stop result includes the `Blob` it already created, plus the existing `base64`.
4. `sendAttachment` / `sendAudio` — state message `media` is `URL.createObjectURL`; the queue entry is `{ message, uploadMedia }` where `uploadMedia` is the data URL. `runQueue` sends `uploadMedia` and emits `MESSAGE_SENT` for `message`.
5. `MessageProcessor` ack route and the facade apply step — revoke the blob, set `media` to the official link, then persist.
6. Tests, then the changelog Fixed entry.

**Cross-repository coordination**: `webchat-react` `specs/008-video-message-media` teaches `MessageVideo` to read `media`. This library can ship first. The widget plays the blob URL only after it is pinned to this patch. This plan does not bump the widget.

## Peak Load Plan

- Declared peak: one shopper tab on a campaign day, 5 media sends in one minute, each file up to 32MB.
- How this plan sustains it: storage receives one short official URL per message after its ack. The file bytes stay in the blob and in the queue item until send completes. Five in-flight blob URLs are revoked as each ack lands.
- How it is verified: Jest asserts the stored JSON has no `data:` or `blob:` media and that the state message's `media` is the object URL returned by the mock. No load harness; the quota failure mode is a single-tab storage write.

## Observability Plan

- Structured logs added: `console.warn` on an unusable or unmatched ack, with `{ operation: 'media-ack', messageType }` and, when unmatched, `reason: 'no-pending-media'`.
- Correlation identifier: the local message `id` used for `updateMessage`. It is not logged together with the URL.
- Error reports: existing `error` event on send failure. No media string, data URL, or message text in the warn context.
- Signals watched after rollout: the quota warning `StorageManager: Quota exceeded, clearing old data` stops appearing on a media send. `message:unknown` stops firing for `type: "ack"`.

## Rollout and Rollback Plan

- Rollout: patch release of `@weni/webchat-service`. No flag. Direct publish after the changelog entry.
- Backward compatibility window: `media` remains a string. Outbound wire shape is unchanged. Stored sessions that already contain official URLs still load. `data:` values already stored are dropped on the next save.
- Rollback: publish the previous library version. Sessions already rewritten without data URLs stay valid. The previous version will persist data URLs again on the next media send.
- Migration reversibility: no schema version and no new key. Rollback does not restore omitted data URLs. That is the intended loss; those values are the quota overflow.

## Divergence Gate

Removed. This spec has no Product Spec.
