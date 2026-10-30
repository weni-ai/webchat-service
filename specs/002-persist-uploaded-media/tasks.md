# Tasks: Persist uploaded media

**Input**: Design documents from `/specs/002-persist-uploaded-media/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/media-ack.md, quickstart.md

**Tests**: Included. The spec's test strategy and the constitution require a regression test that fails before the fix.

**Organization**: Tasks are grouped by user story so each slice can be tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm this bug fix stays inside the existing library

- [x] T001 Confirm no new npm dependency and no new source file are required; implementation stays in `src/core/SessionManager.js`, `src/utils/messageBuilder.js`, `src/modules/AudioRecorder.js`, `src/core/MessageProcessor.js`, `src/index.js`, and `src/utils/constants.js`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No save path can persist a preview address

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Write a failing test in `tests/SessionManager.test.js` that saves a conversation containing a text message plus messages whose `media` is a `data:` URL and a `blob:` URL, and expects the stored `conversation` to keep the text message and omit both preview messages
- [x] T003 Implement the omit rule in `src/core/SessionManager.js` so every `_save` from `appendToConversation`, `setConversation`, and `updateConversation` drops messages whose `media` is `data:` or `blob:`. Constraint from `data-model.md`: stored `media` must be `http:` or `https:`; `data:` and `blob:` messages are omitted from the saved `conversation` array

**Checkpoint**: A session save cannot write a data URL or a blob URL

---

## Phase 3: User Story 1 - Play from a blob URL while uploading (Priority: P1) 🎯 MVP

**Goal**: After a shopper sends an image, video, audio, or file, the in-memory `media` is a `blob:` URL the player can use, the socket still sends the base64 data URL, and storage does not contain either address

**Independent Test**: `npm test -- --testPathPattern='service.sendPaths|SessionManager'` — state `media` starts with `blob:`, the socket payload `media` starts with `data:`, and the saved conversation has neither

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T004 [US1] Add failing send-path tests in `tests/service.sendPaths.test.js` for `image`, `video`, `audio`, and `file`: in-memory `message.media` is the `blob:` URL returned by `URL.createObjectURL`, the state message has no `data:` field, the outbound payload `media` is the base64 data URL, and the stored conversation contains neither `data:` nor `blob:`

### Implementation for User Story 1

- [x] T005 [P] [US1] Add helpers in `src/utils/messageBuilder.js` so `buildMessagePayload` sends an explicit upload body (`data:` URL) instead of `message.media` when that upload body is provided
- [x] T006 [P] [US1] Include the existing `mp3Blob` on the stop result in `src/modules/AudioRecorder.js` next to `base64`, without putting the blob or the data URL into session storage
- [x] T007 [US1] In `src/index.js`, set `sendAttachment` state `media` to `URL.createObjectURL(file)` and `sendAudio` state `media` to `URL.createObjectURL` of the recording `Blob` (build a `Blob` from `base64` only when no `Blob` was passed). Queue `{ message, uploadMedia }` for those sends. Leave text entries as plain messages. `runQueue` must read `uploadMedia` for the wire `media` and emit `MESSAGE_SENT` for the state message
- [x] T008 [US1] On socket send failure in `src/index.js`, set `status` to `error`, call `URL.revokeObjectURL` on the preview, and do not store the message

**Checkpoint**: A media send is playable from a blob URL and does not touch storage or the quota handler

---

## Phase 4: User Story 2 - Replace the blob with the official link (Priority: P2)

**Goal**: The socket ack's `media_url` becomes `message.media`, the blob URL is revoked, and the message is stored once

**Independent Test**: `npm test -- --testPathPattern='MessageProcessor|service.sendPaths'` — the sample ack in `contracts/media-ack.md` does not emit `message:processed`, the matched message's `media` becomes `real_uploaded_link`, `revokeObjectURL` is called with the preview, and storage contains that single message

### Tests for User Story 2 ⚠️

- [x] T009 [P] [US2] Add a failing test in `tests/MessageProcessor.test.js` for the sample ack frame in `specs/002-persist-uploaded-media/contracts/media-ack.md`: it emits `message:media-ack` with the normalized official URL and does not emit `message:processed` or `message:unknown`
- [x] T010 [P] [US2] Add failing tests in `tests/service.sendPaths.test.js` for applying that ack: oldest outgoing `blob:` message of the same type is updated, `document` selects local `file`, a second ack does not add a message, a `data:` or `javascript:` `media_url` leaves the preview in place and stores nothing, and a missing pending blob warns without writing storage

### Implementation for User Story 2

- [x] T011 [P] [US2] Add `MESSAGE_MEDIA_ACK: 'message:media-ack'` to `SERVICE_EVENTS` in `src/utils/constants.js` and the public event type in `src/types/index.d.ts` if that event map is declared there
- [x] T012 [P] [US2] Add `findPendingMediaPreview(messages, type)` in `src/utils/messageBuilder.js`: oldest outgoing message whose `media` starts with `blob:`. Constraint from `data-model.md`: `document` on the ack selects a local `file` message; other types match exactly
- [x] T013 [US2] Handle `type: "ack"` in `src/core/MessageProcessor.js`. Read `message.media_url` and `message.type`. Ignore `list_message` and the ack `timestamp`. Emit `message:media-ack` with `{ type, media }` only when `media_url` is `http:` or `https:`. Do not call `_processUserMessage`. Constraint from `data-model.md`: an ack whose link is not `http:` or `https:` does not change the preview and is not stored. Warn with `{ operation: 'media-ack', messageType }` and no media string
- [x] T014 [US2] In `src/index.js`, on `message:media-ack`, update the matched message so `media` is the official link, keep `id`, `timestamp`, `direction`, and `metadata`, call `URL.revokeObjectURL` on the blob, then `updateConversation` or append if the session did not contain it. On no match, warn `{ operation: 'media-ack', messageType, reason: 'no-pending-media' }` and store nothing. Revoke remaining blob URLs when the service is destroyed

**Checkpoint**: Ack stores one official URL and a duplicate or invalid ack does not duplicate the bubble

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Release notes and the quickstart gate

- [x] T015 Add a Fixed entry to `CHANGELOG.md` for the patch: previews use a blob URL, storage keeps only the official `http(s)` link, and the quota clear no longer runs on a media send
- [x] T016 Run the commands in `specs/002-persist-uploaded-media/quickstart.md` (`npm test` for MessageProcessor, service.sendPaths, and SessionManager with coverage, then `npm run lint`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational
- **User Story 2 (Phase 4)**: Depends on User Story 1, because the ack matches a `blob:` preview that Phase 3 creates
- **Polish (Phase 5)**: Depends on User Story 2

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational. No ack handling required
- **User Story 2 (P2)**: Starts after User Story 1. Uses the preview message User Story 1 puts in memory

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- `messageBuilder.js` and `AudioRecorder.js` before `src/index.js` for User Story 1
- Processor route and matcher before the facade apply step for User Story 2

### Parallel Opportunities

- T005 and T006 touch different files and can run together after T004
- T009 and T010 can run together
- T011 and T012 can run together after those tests exist
- T013 and T014 are sequential: the facade listens for the event the processor emits

---

## Parallel Example: User Story 1

```bash
Task: "Add payload helper in src/utils/messageBuilder.js"
Task: "Expose mp3Blob from src/modules/AudioRecorder.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2
2. Complete Phase 3
3. **STOP and VALIDATE**: a media send plays from a blob URL and the saved session has no data URL

### Incremental Delivery

1. Foundational omit rule stops the quota write even before previews change
2. User Story 1 makes the open chat playable during upload
3. User Story 2 stores the official link after the ack

### Parallel Team Strategy

After Phase 2, one developer can own `messageBuilder.js` and another `AudioRecorder.js`. `src/index.js` waits for both. User Story 2 stays with one developer because `MessageProcessor.js` and `src/index.js` are ordered.

---

## Notes

- [P] tasks = different files, no dependencies
- Do not put the base64 string on the state message
- Do not persist a `blob:` URL
- Commit after each phase
