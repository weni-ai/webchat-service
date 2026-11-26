# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Shopping Assistant human support status, active only when the socket answers `human_support_enabled` in `ready_for_message`. The service exposes it as `state.features.humanSupportStatus`.
- Every connection declares the fixed capability `register.data.features.humanSupportStatus: true`. It is not a configuration option.
- Every outgoing shopper message sends its id as `message.id`. Invalid caller-provided ids are omitted with a warning.
- New socket frames `message_saved`, `message_status`, `human_support_event` and `human_support_state`, and the extended `message`, `typing_start` and `history` payloads, normalized to camelCase.
- `Message.author`, `Message.orderKey`, and `type: 'human_support_event'` milestones carrying `humanSupportEvent` (`{ eventId, event, occurredAt }`).
- State fields `humanSupport` (`{ active }`) and `typingAuthor` (`{ type: 'human_agent', name? } | null`), and the `human_support:changed` event.
- `humanSupport.active` is deduced from the last milestone in history on each connection, then confirmed with `get_human_support_state`. When the state cannot be confirmed, the deduced value is kept and no error is emitted.
- Shopper message statuses (`sent`, `delivered`, `read`) only move forward. A Live Desk agent typing indicator expires 10 seconds after the last heartbeat.
- Exported `MESSAGE_AUTHOR_TYPES`, `HUMAN_SUPPORT_EVENTS` and `MESSAGE_TYPES.HUMAN_SUPPORT_EVENT`, plus updated TypeScript declarations.

### Changed

- `state.messages`, history merges and the stored session are ordered by the server `orderKey`. Items without it keep the previous timestamp order or arrival order, and unconfirmed shopper messages stay at the end.
- On channels with human support status enabled:
  - an AI-mode shopper message has no `status` after it is sent, instead of `'sent'`;
  - during human support a shopper message stays `pending` until the server confirms it;
  - sending a message during human support no longer starts the generic typing indicator.

### Fixed

- After a reconnect, a shopper message whose history copy has the same id is no longer removed together with stale local copies.
- A shopper message that already reached the socket is not sent again after a reload. If it is never confirmed, it is marked `error` once history proves it was not saved.

## [1.22.0] - 2026-11-25

### Added

- Support for Shopping Assistant streaming component WebSocket frames (`stream_component_hint`, `stream_component`, `stream_text_end`, and extended `stream_end` with `quick_replies`, `list_message` including optional `item_count`, and `cta_message`), normalized to camelCase `componentHints` and `streamPhase` (`streaming_text` | `awaiting_components` | `completed`) on emitted `Message` objects.
- Exported `COMPONENT_TYPES` and `STREAM_PHASES` constants and updated TypeScript declarations (`src/types/index.d.ts`) for `ComponentHint`, `StreamPhase`, `ListMessage`, `CtaMessage`, and `Message.status` (`'streaming'`).
- Automatic stream finalization on WebSocket `disconnected` and `closed` transitions, clearing active `componentHints` and preserving received text without error UI.
- Transient streaming fields (`componentHints`, `streamPhase`, and `status: 'streaming'`) are stripped before persisting sessions to browser storage and on session restore so reloads never replay skeletons or animations.

### Fixed

- `HistoryManager.processHistory` now restores validated `cta_message` payloads (with unescaped `http(s)` URLs) and `HistoryManager.merge` backfills `cta_message` on cached entries lacking it.

## [1.21.0] - 2026-11-06

### Added

- `evaluateBackInStockOffer`, `validateBackInStockContact`, and `subscribeBackInStock` decide whether to offer a back-in-stock notice, check the contact, and POST the storefront subscribe route. Failures emit `backInStock:error` and success emits `backInStock:subscribed`.
- Optional `backInStock` init object (`subscribePath`, `timeoutMs`, `maxRetries`, `retryBaseDelayMs`). Omitting it keeps the defaults: `/_v/private/availability-notify/subscribe`, 10 seconds, 2 retries, and a 500 ms base delay.
- Runtime dependency `libphonenumber-js` for phone validation. CommonJS and ESM builds leave `libphonenumber-js/max` external. The UMD build bundles it.

## [1.20.0] - 2026-11-05

### Added

- Incoming and history messages expose the optional `customData` field when the socket sends `message.custom_data` as a JSON object. Inner keys are passed through unchanged. The field is kept in `state.messages` and in the stored session conversation, and `getHistory` fills it into a cached message that lacks it. A `custom_data` that is not an object is dropped with a warning and the message is still delivered.

## [1.19.3] - 2026-10-30

### Fixed

- Outgoing image, video, audio, and file messages preview from a blob URL while the upload is in progress. Browser storage keeps the message only after the socket ack replaces that preview with the official http(s) link, so a media send no longer overflows the quota and clears the conversation.

## [1.19.1] - 2026-10-08

### Added

- Add optional `image` support to add-to-cart items

## [1.19.0] - 2026-10-07

### Added

- Socket events with `type: stream_rationale` update the thinking indicator text for the active stream and are not stored as chat messages

## [1.18.0] - 2026-10-01

### Added

- Incoming messages with `message_kind: rationale` update the thinking indicator text (`state.thinkingText`) and are not stored as chat messages
- Public `setThinkingText(text)` and the `thinking:text:changed` event

## [1.10.3] - 2026-04-08

### Added

- feat: voice mode feature flag
