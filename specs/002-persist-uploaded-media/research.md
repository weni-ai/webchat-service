# Research: Persist uploaded media

## Preview address while the official link is absent

- Decision: `message.media` in `StateManager` is `URL.createObjectURL` of the `File` (`sendAttachment`) or the recording `Blob` (`sendAudio`) until the ack.
- Rationale: A blob URL is a short playable address. The video, image, and audio elements can use it while the upload has not produced `media_url`. The base64 string is the whole file and is what overflows `localStorage` if it is copied onto the saved message.
- Alternatives considered: Leave the data URL on `message.media` (playable, but one save of the message reintroduces the quota bug). Wait for the ack before showing the message (nothing to play during the upload). Persist the blob URL (dead after reload).

## Where the base64 lives

- Decision: The send queue holds `{ message, uploadMedia }`. `uploadMedia` is the data URL. `buildMessagePayload` uses `uploadMedia` for the wire `media` field. `message` in state has only the blob URL. Text messages stay plain message objects on the same queue; `runQueue` treats an entry with `uploadMedia` as the wrapper.
- Rationale: `buildMessagePayload` today reads `message.media`. If that field is the blob URL, the server receives an address it cannot upload. The queue item must not be the same object as the state message, or the data URL would sit on the object `SessionManager` can save.
- Alternatives considered: A `__uploadMedia` field on the state message deleted at save time (easy to miss on a new writer). A second message type on the wire (breaks the current payload contract).

## Audio bytes

- Decision: `AudioRecorder._handleRecordingStop` adds the `mp3Blob` it already builds onto the result, next to `base64`. `sendAudio` calls `createObjectURL` on that blob when present. If a caller passes only `base64`, `sendAudio` builds a `Blob` from those bytes solely to create the object URL and still does not put the data URL on the state message.
- Rationale: The blob already exists before base64 encoding. Re-decoding is only the fallback for the existing `sendAudio({ base64 })` callers.
- Alternatives considered: Change `sendAudio` to require a `Blob` (breaks current callers). Keep audio on a data URL until the ack (the quota bug for recordings).

## Matching the ack

- Decision: Oldest outgoing in-memory message of `message.type` whose `media` starts with `blob:`. `document` matches local `file`. Ignore the ack `timestamp` and `list_message`. Accept `media_url` only when it is `http:` or `https:`.
- Rationale: The sample ack has no local message id. The timestamp is unix seconds and does not equal `Date.now()` on the local message. FIFO matches one in-flight upload of that type. A second ack no longer matches after the preview is replaced.
- Alternatives considered: Match by timestamp. Append the ack as a new message (duplicate bubble).

## Revoke

- Decision: `URL.revokeObjectURL` when the official link replaces the preview, when the send fails, and when the service is destroyed. Do not revoke while the upload is in progress.
- Rationale: The page can play the blob only while the URL is live. Leaving it after the official link or after a failed send leaks the file for the document lifetime.
- Alternatives considered: Never revoke (leak until navigation). Revoke at `MESSAGE_SENT` (player breaks before the ack).

## Persistence boundary

- Decision: `SessionManager` save omits any conversation message whose `media` is `data:` or `blob:`, including `setConversation` from history merge.
- Rationale: `sendAttachment`, `getHistory`, and `simulateMessageSent` all end in `_save`. Filtering at the save is the one place that covers every caller.
- Alternatives considered: Skip `appendToConversation` only in `sendAttachment` (history merge would still persist a preview if it is in the merged array).
