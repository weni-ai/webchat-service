# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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
