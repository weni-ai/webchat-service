# Contract: Media upload acknowledgement

## Inbound ack

The socket server already sends this after it stores the file. This library starts consuming it.

```json
{
  "type": "ack",
  "to": "user",
  "from": "socket",
  "message": {
    "type": "video",
    "timestamp": "1793296215",
    "media_url": "real_uploaded_link",
    "list_message": { "button_text": "", "list_items": null }
  }
}
```

| Field | Rule |
|-------|------|
| `type` | Must be `ack`. Not enqueued as a chat message. No longer emitted as `message:unknown`. |
| `message.type` | `image`, `video`, `audio`, `file`, or `document` (`document` matches local `file`) |
| `message.media_url` | Official address. Accepted only as `http:` or `https:`. Normalized to the local field `media`. |
| `message.timestamp` | Ignored. Must not replace the local message timestamp. |
| `message.list_message` | Ignored. |
| Message id | Absent. The library selects the oldest outgoing in-memory message of that type whose `media` is a `blob:` URL. |

Invalid `media_url` (missing, `data:`, `blob:`, `javascript:`, other schemes): warn `{ operation: 'media-ack', messageType }` and leave state and storage unchanged.

Unmatched ack: warn `{ operation: 'media-ack', messageType, reason: 'no-pending-media' }` and store nothing.

## In-memory preview

Until the ack is applied, consumers read `message.media` and receive a `blob:` URL created in this page. Image, video, audio, and file use the same field. This library does not add `url`.

## Stored session

`conversation[].media` for a newly saved outgoing media message is the official `http(s)` URL. Messages whose `media` is `data:` or `blob:` are omitted on save. The storage key and envelope (`_version`, `_timestamp`, `_data`) are unchanged.

## Outbound upload

Unchanged shape:

```json
{ "type": "message", "message": { "type": "video", "media": "data:video/mp4;base64,..." } }
```

`media` on the wire is the base64 data URL taken from the queue's `uploadMedia`, not from the preview `message.media`. `message_with_fields` wrapping is unchanged when pending custom fields are present.

## Emitted event

`message:media-ack` with `{ type, media }` after normalization, before the facade updates state. Existing `message:updated` still fires when the local message id is patched. SemVer: patch. No new required init option.
