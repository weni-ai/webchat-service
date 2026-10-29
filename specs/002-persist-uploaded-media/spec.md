# Engineering Specification: Persist uploaded media

**Repository**: webchat-service — frontend

**Feature Branch**: `002-persist-uploaded-media`

**Created**: 2026-10-29

**Status**: Draft

## Origin Without Product Spec

- Product Spec: none
- Problem: Sending a video, image, audio, or file writes the base64 data URL into browser storage. That write exceeds the storage quota, the storage layer drops stored data, and the conversation is lost. The socket acknowledgement that carries the uploaded link is ignored.
- Acceptance criteria:
  - After the shopper sends a video, image, audio recording, or other file, the open chat can play that message from a temporary blob URL while the upload is still in progress.
  - The stored conversation does not contain that message's base64 data URL or its blob URL.
  - When the socket acknowledgement arrives with the official uploaded link, the in-memory message and the stored conversation both use that link as the media address, the blob URL is released, and the message is not duplicated.
  - Text messages and every other message already in the conversation are still there after the media send.
  - A media send does not emit the quota-exceeded warning and does not delete stored session data.
  - If the acknowledgement never arrives, that media message is not written to storage, and the rest of the stored conversation is unchanged.
  - The same rules apply to image, audio, and file, not only video.

## Scope in This Repository

**This repository implements**: Persistence of outgoing media in `@weni/webchat-service`. The library still sends the base64 payload on the socket so the upload can happen. Until the acknowledgement carries the official uploaded link, the in-memory message's `media` is a temporary blob URL (`blob:`) created from the file or recording, so the open chat can play it during the upload. That blob URL and the base64 payload are never written to browser storage. Storage receives the message only after `media` is the official `http:` or `https:` link. Image, video, audio, and file follow the same rule.

**Out of scope here**:

- Rendering the video element. `webchat-react` owns that. `MessageVideo` currently reads `message.url`, which this library never sets; the playable address is `message.media`. That widget fix is a separate engineering spec in `webchat-react`.
- The socket server that uploads the file and emits the acknowledgement. This library only consumes the frame the server already sends.
- Changing `StorageManager._handleQuotaExceeded` into a different eviction policy. Media sends must stop reaching it.

**Depends on**: the socket server continuing to send an acknowledgement of this shape after a media upload:

```json
{"type":"ack","to":"user","from":"socket","message":{"type":"video","timestamp":"1793296215","media_url":"real_uploaded_link","list_message":{"button_text":"","list_items":null}}}
```

`message.type` is `image`, `video`, `audio`, or `file` (a `document` type is treated as `file`). `message.media_url` is the official uploaded address. The frame has no local message id. `webchat-react` must render `message.media` as-is: a `blob:` URL while the upload is in progress, then the official link. This library does not add a `url` field.

## Current State

- `src/index.js` `sendAttachment` — `FileHandler.process` returns a base64 data URL. `buildMediaMessage` puts it on `media`. The facade calls `state.addMessage` and `session.appendToConversation` before `enqueueMessages`. The same sequence is in `sendAudio` with `audioData.base64`.
- `src/utils/messageBuilder.js` `buildMessagePayload` — the socket payload for `image`, `video`, `audio`, and `file` sends `media` as that data URL. That wire send stays.
- `src/utils/messageBuilder.js` `buildMediaMessage` — local message field is `media`, not `url`.
- `src/core/SessionManager.js` `appendToConversation`, `setConversation`, and `updateConversation` — each calls `_save`, which `JSON.stringify`s the whole session.
- `src/core/StorageManager.js` `set` — on `QuotaExceededError`, `_handleQuotaExceeded` warns `StorageManager: Quota exceeded, clearing old data` and deletes the oldest 25% of `weni:webchat:` keys. The session is one of those keys, so the conversation disappears. The stack reaches this from `ChatContext.jsx` only because the widget calls `service.sendAttachment`.
- `src/core/MessageProcessor.js` `process` — a frame whose top-level `type` is `ack` is not handled. It falls through to `message:unknown` and is never applied. `media_url` is normalized to `media` only for ordinary messages (`_normalizeMessage` and `HistoryManager`).
- `src/index.js` `MESSAGE_SENT` — marks the local message `sent` and calls `session.updateConversation`. That does not replace `media`.
- `src/index.js` `getHistory` — `history.merge` then `session.setConversation(merged)`. A local data-URL message that is still in memory is written to storage on that path too.
- `src/modules/FileHandler.js` — categories are `image`, `video`, `audio`, and `file`. `DEFAULTS.MAX_FILE_SIZE` is 32MB, far above the browser storage quota once encoded as base64.
- `src/index.js` `simulateMessageSent` — also appends a media message, including a data URL, with no socket acknowledgement.

## Technical Approach

### Components Affected

| Component | Change | Why |
|-----------|--------|-----|
| `src/core/SessionManager.js` | modified | Every save omits conversation messages whose `media` is a `data:` or `blob:` URL. |
| `src/utils/messageBuilder.js` | modified | Builds the socket payload from the upload body, not from the preview URL. Matcher: oldest in-memory outgoing message of the ack type whose `media` is still a `blob:` URL. |
| `src/modules/AudioRecorder.js` | modified | Keeps the recording `Blob` available so `sendAudio` can make an object URL without putting the data URL on the message. |
| `src/core/MessageProcessor.js` | modified | Route `type: "ack"` and emit a normalized acknowledgement. Do not enqueue it as a chat message. |
| `src/index.js` | modified | Preview `media` is a blob URL. On acknowledgement, revoke it, replace `media` with the official link, and then persist. |
| `src/utils/constants.js` | modified | Event name for the normalized acknowledgement. |
| `tests/SessionManager` coverage, `tests/MessageProcessor.test.js`, `tests/service.sendPaths.test.js` | modified | Regression for the quota bug and the ack apply path. |

No new source file. `src/index.js` and `MessageProcessor.js` already exceed the file-size guidance; the match function goes in `messageBuilder.js`, and the processor only classifies the frame and emits.

### Flow

1. `sendAttachment` still runs `FileHandler.process` so the socket can send the base64 data URL. The state message does not carry that data URL. Its `media` is `URL.createObjectURL(file)`, a `blob:` URL the player can use while the upload has not finished. `sendAudio` does the same from the recording `Blob` (`AudioRecorder` already builds that blob before encoding base64). The queue item keeps the data URL beside the message, and `buildMessagePayload` reads that upload body for the wire. The data URL is not a field of the state message.
2. `appendToConversation` may still be called. The session save drops the message while `media` is `blob:` or `data:`. Only an `http:` or `https:` address is stored.
3. `MESSAGE_SENT` still sets `status: "sent"` in memory. The session update does not store the blob URL or the data URL.
4. `MessageProcessor.process` sees `type: "ack"`. It reads `message.media_url` and `message.type`, ignores `list_message` and the ack `timestamp` (a unix-seconds string, not the local `Date.now()` timestamp), and emits `message:media-ack` with `{ type, media }` when `media_url` is an `http:` or `https:` URL. Any other scheme, including `data:` and `blob:`, is discarded and warned. The ack is not passed to `_processUserMessage`.
5. The facade finds the oldest outgoing in-memory message of that type (`document` matches local `file`) whose `media` starts with `blob:`. It revokes that object URL, then `updateMessage`s that id so `media` is the official uploaded link, leaving id, timestamp, direction, and metadata as they are. It then `updateConversation`s that id. If the message was absent from the session, it appends the updated message. The save now includes it, because `media` is the official link.
6. A second ack for the same type does not match again, because the message is no longer a `blob:` URL, so it is not duplicated.
7. `setConversation` (history merge and any other full write) uses the same omit rule, so a merge cannot write a blob URL or a data URL.
8. Send failure revokes the blob URL and does not store the message. `simulateMessageSent` with a `data:` or `blob:` media still shows the message in memory and still does not store it. A simulated message whose `media` is already `http(s)` is stored as today. A caller that only has a data URL and no `File` or `Blob` still gets a blob URL: the library builds a `Blob` from those bytes solely to call `createObjectURL`, and the state message still does not keep the data URL.

### Rejected Alternatives

- Waiting to add the message to memory until the ack: the open chat could not play the file while it is uploading.
- Keeping the data URL on `message.media` for that preview: the player can use it, but the string is the whole file and is what overflows storage if any save copies the message. A blob URL is a short address for the same bytes.
- Persisting the blob URL: it dies with the document, so a reload would show a dead player. Storage waits for the official link.
- Persisting a stub without `media`, then filling it in: a reload before the ack would show a broken bubble, and the stub is unnecessary if the message stays in memory only.
- Matching the ack by `message.timestamp`: that value is unix seconds and does not equal the local message timestamp, and the frame has no message id.
- Adding a new module file for the matcher: the first new source file must also add the TypeScript toolchain. This is a bug fix in existing JavaScript.

## Contracts

| Interface | Change | Version impact | Backward compatible |
|-----------|--------|----------------|---------------------|
| Socket consume `type: "ack"` with `message.media_url` and `message.type` | modified (previously `message:unknown`) | patch | yes — the public message field remains `media`; no new required init option |
| `SERVICE_EVENTS` entry `message:media-ack` | added | patch | yes — new event; existing listeners are unaffected |
| `message:unknown` for this ack frame | modified | patch | yes — consumers that listened for `message:unknown` on acks stop seeing this one frame; it was not a documented ack contract |
| In-memory `message.media` before the ack | modified | patch | yes — still a string the player can use. It is a `blob:` URL until the ack, then the official link. Callers that read `media` for the preview keep working |
| Stored session `conversation[].media` | modified | patch | yes — still a string. New writes store the official `http(s)` URL only. `blob:` and `data:` values are omitted on the next save |
| Outbound media payload `{ type, media }` | unchanged | none | yes — the wire body is still the base64 data URL, taken from the queue's upload body, not from the preview `media` |
| `sendAttachment` / `sendAudio` signatures | unchanged | none | yes |

**Consumers affected**: `webchat-react` (pinned to `@weni/webchat-service` 1.19.2) and any other consumer of the session store. They need a published patch and a dependency bump to pick up persistence. They already read `message.media`. No deprecation window: the stored data URL is the defect, not a supported contract.

## Data Model and Migrations

- **Session conversation message**: `id`, `type` (`image` \| `video` \| `audio` \| `file`), `media` (playable address), `direction`, `status`, `timestamp`, `metadata`. Ownership stays with `SessionManager`. After this change, a stored outgoing media message has the official `http:` or `https:` link. Until that acknowledgement, the in-memory copy holds a `blob:` URL and is not stored.

**Migrations**: No storage version bump and no new key. On every save, messages whose `media` is `data:` or `blob:` are left out of `conversation`. The previously deployed library still reads the stored session: remaining messages keep the same shape, and a stored official URL is valid `media`. Rollback of the code does not restore data URLs that a new save already omitted. That is safe: those values are what overflow the quota, and the server history remains the copy that has the official link. A stored `blob:` URL is never written, so rollback has none to revive.

## Non-Functional Requirements

### Peak Load

One shopper tab during a storefront campaign day. Peak is 5 outgoing media messages in one minute in that tab, each file up to the existing 32MB limit. Each stored message adds one URL (under 2KB), not the file. The browser storage quota is the limit that must hold for that whole session, including the text history already stored.

### Observability

- Unusable ack (missing type, missing link, or a scheme other than `http`/`https`): `console.warn` with a `MessageProcessor` or facade prefix and a structured context `{ operation: 'media-ack', messageType }`. No media string, no data URL, no message text.
- Unmatched ack: same warning with `{ operation: 'media-ack', messageType, reason: 'no-pending-media' }`.
- Matched ack: no info log. The correlation id is the local message `id` used in the state update, not printed with the URL.
- Existing `StorageManager` quota warning stays for genuine quota failures. A media send must not be what triggers it.

### Failure Handling

- Socket send failure already sets the message `status` to `error` and emits `error`. That path revokes the blob URL and must not persist the message. No new retry of the upload.
- Ack never arrives: the message stays in memory on its blob URL so playback still works until the page closes. Reload loses that one outgoing media message. The blob URL is revoked when the service is destroyed. No timeout is added beyond the socket's existing lifetime. The operation is not retried by writing the data URL or the blob URL.
- Duplicate ack: idempotent. The second one finds no `blob:` message of that type.
- History `setConversation` while a blob URL is in memory: storage write omits it; memory keeps the blob URL until the ack or until the page closes.
- `getHistory` failure is unchanged.

### Security and Authorization

The ack crosses the trust boundary at `MessageProcessor`. `media_url` is accepted only as `http:` or `https:` before it replaces the blob URL and enters storage. `data:`, `blob:`, `javascript:`, and other schemes are dropped. The library does not add an authorization check; the socket session is the existing boundary. The base64 payload is still sent on the socket because that is the upload. It lives only on the queue item, not on the state message, and it is not written to storage or logs. The blob URL is created from the shopper's own file in this page.

## Test Strategy

| Success / acceptance criterion | How this repository proves it |
|--------------------------------|-------------------------------|
| The open chat can play the file while the upload is in progress | `sendAttachment` and `sendAudio` tests: the state message's `media` is a `blob:` URL from `createObjectURL`, and the socket payload's `media` is still the base64 data URL. The state message has no data URL. Same for image, video, audio, and file. |
| Stored conversation has no base64 data URL and no blob URL | Storage `set` payload's conversation has neither `data:` nor `blob:` media after the send. |
| Ack stores the official link once and releases the blob | Processor test: the sample ack frame emits `message:media-ack` and does not emit `message:processed`. Facade or session test: `revokeObjectURL` is called with the preview, the matched message's `media` becomes `real_uploaded_link`, and the stored conversation contains that single message. |
| Text and older messages remain | Session save with a text message plus a blob-URL video: stored conversation still has the text message and not the blob URL. Quota handler is not invoked. |
| No quota clear on media send | Storage mock that throws `QuotaExceededError` only when the serialized value contains `data:`: the media send path does not call it. |
| Missing ack does not store the media message | Send with no ack: `append`/`set` result omits that message; the in-memory `media` stays the blob URL; a following text send still stores the text. |
| Image, audio, and file share the rule | Cases parameterized for `image`, `audio`, and `file`, plus `document` ack matching a local `file`. |

**Flow coverage**: send attachment → in-memory `blob:` URL the player can use → socket payload still base64 → storage without the message → ack frame → blob revoked, memory and storage use the official link. History `setConversation` while a blob URL is in memory does not persist it.

**Failure paths covered**: ack with a `data:`, `blob:`, or `javascript:` link is ignored and the preview blob stays; ack with no pending blob message warns and stores nothing; send error revokes the blob and does not persist it; duplicate ack does not add a second message.

**Stubbed at the boundary**: `localStorage` and the WebSocket, as the existing Jest setup does. No live socket.

## Rollout and Rollback

Publish a patch of `@weni/webchat-service` and list it under Fixed in `CHANGELOG.md`. `webchat-react` is pinned to `1.19.2`, so the widget does not pick this up until that dependency is bumped. The widget's video player still needs its own change to read `media`; this patch does not bump that package.

No feature flag. Rollback is redeploying the previous library. Sessions already rewritten without data URLs stay valid. The previous library will again persist data URLs on the next media send.

## Constitution Alignment

| Principle | How this spec complies | Exception + justification |
|-----------|------------------------|---------------------------|
| I. Version Control and Review | Patch ships through a pull request with lint and the coverage gate. | none |
| II. Specification Traceability | Opens with Origin Without Product Spec. | none |
| IV. Versioned Public Contracts | Patch. `media` stays a string. Ack consumption is backward compatible as specified in Contracts. | none |
| V. Release & Changelog Maintenance | Changelog Fixed entry in the same change as the code. | none |
| VIII. Observability | Warn-only, structured context, no media or message content. | none |
| X. Type Safety | Bug fix in existing JavaScript. `src/types/index.d.ts` updated only if the new event is part of the public type surface. No new source file, so the TypeScript toolchain stays out of this change. | none |
| XI. Single Responsibility | Matcher lives in `messageBuilder.js`. Processor only routes the frame. | none |
| XIV. WebSocket Contract & Data Boundaries | `media_url` is normalized to `media` at the processor boundary and rejected unless `http(s)`. | none |
| XV. State Management & Async Correctness | Optimistic message stays in `StateManager` on a blob URL the player can use. Storage follows only after the ack replaces `media` with the official link and the blob is revoked. Send failure revokes the blob and does not persist it. | none |
| XVI. Resilience & Error Handling | Missing, duplicate, and invalid acks are explicit and non-destructive. | none |
| Testing | Regression tests cover the bug and the failure paths. | none |

## Implementation Decisions

- **Preview is a blob URL, not the data URL**: `message.media` is `URL.createObjectURL` of the `File` or recording `Blob` until the ack. The player can play that address while the official link does not exist yet. The base64 string stays on the queue item that `buildMessagePayload` reads, because the wire body cannot be the blob URL.
- **Omit `blob:` and `data:` on save**: `getHistory` → `setConversation` and `simulateMessageSent` can persist a local address even if `sendAttachment` stops calling `appendToConversation`. The rule belongs in `SessionManager` save. A blob URL is not the official upload and is useless after reload.
- **Revoke when the preview is finished**: `revokeObjectURL` runs when the official link replaces the preview, when the send fails, and when the service is destroyed. It does not run while the upload is still in progress.
- **FIFO match without an id**: the ack has no local message id. The oldest outgoing `blob:` message of the same type is the one in flight. `document` matches `file`.
- **Ack timestamp is ignored**: it is unix seconds and must not replace the local timestamp.
- **`http` and `https` only**: the official link is the only address stored. A `data:` or `blob:` value echoed by the server does not replace the preview and is not stored.
