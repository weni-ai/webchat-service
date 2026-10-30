# Quickstart: Persist uploaded media

Validates [spec.md](./spec.md) against [data-model.md](./data-model.md) and [contracts/media-ack.md](./contracts/media-ack.md). No live socket.

## Prerequisites

- Repository root of `webchat-service`
- `npm install`

## Run

```bash
npm test -- --testPathPattern='MessageProcessor|service.sendPaths|SessionManager' --coverage
npm run lint
```

## Outcomes

- A media send puts a `blob:` URL on the in-memory message and the base64 data URL on the socket payload only.
- The saved session conversation has neither `data:` nor `blob:` media, and still contains text messages that were saved with it.
- The sample ack in the contract sets that message's `media` to the official link, revokes the blob URL, and stores one copy.
- An ack with a non-`http(s)` link, a duplicate ack, and a send error do not write the preview and do not clear storage.
- Image, audio, and file, plus a `document` ack for a local `file`, follow the same outcomes.

Manual check after publish, in a storefront tab: send a short video, play it before the ack returns, reload after the ack, and confirm the conversation is still there and the quota warning did not fire. That check needs the widget pin bump and is outside this package's Jest run.
