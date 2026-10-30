# Data Model: Persist uploaded media

No new storage key and no version bump. The session document stays the object `SessionManager` already writes under `weni:webchat:`.

## Outgoing media message

| Field | Before ack (memory) | After ack (memory and storage) |
|-------|---------------------|--------------------------------|
| `id` | local id (`msg_` prefix) | unchanged |
| `type` | `image`, `video`, `audio`, or `file` | unchanged |
| `media` | `blob:` URL | official `http:` or `https:` URL from `media_url` |
| `direction` | `outgoing` | unchanged |
| `status` | `pending`, then `sent` or `error` | `sent` on a successful ack |
| `timestamp` | local `Date.now()` | unchanged (ack timestamp is ignored) |
| `metadata` | filename, size, mimeType, and duration for audio | unchanged |

The base64 data URL is not a field of this entity.

## Queue entry

Used only inside `messagesQueue` for a media send. Not persisted.

| Field | Rule |
|-------|------|
| `message` | The state message above, with `media` as a `blob:` URL |
| `uploadMedia` | `data:` URL sent on the socket as `media`. Absent for text and other non-upload messages |

## Ack frame (wire, inbound)

See [contracts/media-ack.md](./contracts/media-ack.md). Normalized result: `{ type, media }` where `media` is the official URL. Not a chat message and not stored as its own row.

## Validation

- Stored `media` must be `http:` or `https:`.
- `data:` and `blob:` messages are omitted from the saved `conversation` array.
- An ack whose link is not `http:` or `https:` does not change the preview and is not stored.
- `document` on the ack selects a local `file` message. Other types match exactly.

## State transitions

1. Created in memory with `media` blob URL and `status` `pending`. Not stored.
2. Socket accept → `status` `sent`. Still not stored. Blob URL stays so playback continues.
3. Official ack → revoke blob, `media` becomes the official URL, then the message is inserted or updated in the session.
4. Send error → `status` `error`, revoke blob, do not store.
5. Duplicate ack → no transition.
6. Page reload before step 3 → the message is absent from storage. Server history is the copy that may restore it with the official URL.

## Relationships

One session conversation contains many messages. At most one unmatched `blob:` preview per in-flight upload. The matcher assumes one oldest preview per type.
