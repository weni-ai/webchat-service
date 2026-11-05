# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `evaluateBackInStockOffer`, `validateBackInStockContact`, and `subscribeBackInStock` decide whether to offer a back-in-stock notice, check the contact, and POST the storefront subscribe route. Failures emit `backInStock:error` and success emits `backInStock:subscribed`.
- Optional `backInStock` init object (`subscribePath`, `timeoutMs`, `maxRetries`, `retryBaseDelayMs`). Omitting it keeps the defaults: `/_v/private/availability-notify/subscribe`, 10 seconds, 2 retries, and a 500 ms base delay.
- Runtime dependency `libphonenumber-js` for phone validation. CommonJS and ESM builds leave `libphonenumber-js/max` external. The UMD build bundles it.

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
