# Feature Specification: PDP Conversation Starters Bridge

**Feature Branch**: `001-pdp-starters-bridge`  
**Created**: 2026-03-09  
**Status**: Draft  
**Input**: User description: "Implement the communication bridge in webchat-service between webchat-react and weni-webchat-socket for the get_pdp_starters architecture"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Request PDP Starters via WebSocket (Priority: P1)

A user navigates to a product detail page (PDP) on a VTEX store. The webchat-react frontend detects the page, extracts product data from the VTEX Intelligent Search API, and requests conversation starters through the webchat-service library. The service sends a `get_pdp_starters` message via the existing WebSocket connection. The socket server invokes a Lambda function asynchronously, and when the result arrives, the service emits a `starters:received` event with the generated questions. The webchat-react frontend displays the questions as conversation starters.

**Why this priority**: This is the core value of the feature — enabling the WebSocket-based flow that eliminates the need for a separate HTTP endpoint and extra configuration (`endpoint`, `secret`) in the frontend init.

**Independent Test**: Can be fully tested by calling `service.getStarters(productData)` after the service is connected and verifying that a `starters:received` event is emitted with an array of questions.

**Acceptance Scenarios**:

1. **Given** the service is connected and registered, **When** `getStarters()` is called with valid product data (account, linkText), **Then** a `get_pdp_starters` message is sent via WebSocket containing the product data in the `data` field.
2. **Given** a `get_pdp_starters` request was sent, **When** the server responds with a `starters` message containing `data.questions`, **Then** the service emits a `starters:received` event with `{ questions: [...] }`.
3. **Given** a `get_pdp_starters` request was sent, **When** the server responds with an `error` message related to starters, **Then** the service emits a `starters:error` event with the error details.

---

### User Story 2 - Graceful Handling of Connection and Readiness (Priority: P2)

The webchat-react frontend may attempt to request starters before the WebSocket connection is established or before registration is complete. The service must handle these cases gracefully — either by rejecting the call with a clear error or by queueing the request until the connection is ready.

**Why this priority**: Without proper connection-state handling, starters requests would silently fail or throw cryptic errors, degrading the user experience on initial page load.

**Independent Test**: Can be tested by calling `getStarters()` before connection is established and verifying it either throws a descriptive error or queues and eventually sends the request after connection.

**Acceptance Scenarios**:

1. **Given** the service is not connected, **When** `getStarters()` is called, **Then** the call is rejected with a clear error indicating the connection is not ready.
2. **Given** the service is connecting (WebSocket handshake in progress), **When** `getStarters()` is called, **Then** the call is rejected with a clear error indicating the connection is not ready.
3. **Given** the service was previously connected but lost connection, **When** `getStarters()` is called, **Then** the call is rejected with a clear error.

---

### User Story 3 - SPA Navigation Clears Stale Starters (Priority: P3)

When the user navigates from one product page to another within a Single Page Application, stale starters from the previous product must not be displayed. The webchat-react frontend handles clearing and re-requesting, but the service must support this by allowing rapid successive calls to `getStarters()` where only the latest response matters.

**Why this priority**: Prevents displaying irrelevant starters for a product the user is no longer viewing, which would confuse the user.

**Independent Test**: Can be tested by calling `getStarters()` twice in rapid succession with different product data and verifying that the `starters:received` event fires for the most recent request without interference from the previous one.

**Acceptance Scenarios**:

1. **Given** a starters request is in-flight for product A, **When** `getStarters()` is called for product B, **Then** only the response matching the latest request is emitted as `starters:received`.
2. **Given** two rapid `getStarters()` calls are made, **When** both server responses arrive, **Then** the service does not emit stale data from the first request (responses arriving out of order are handled).

---

### Edge Cases

- What happens when the server returns an empty `questions` array? The service emits `starters:error` since the socket server already treats this as an error condition.
- What happens when the WebSocket connection drops while a starters request is in-flight? The request is lost; no event is emitted. The frontend should re-request after reconnection if still on a PDP.
- What happens when `getStarters()` is called with missing required fields (`account` or `linkText`)? The service validates locally and throws an error before sending the WebSocket message.
- What happens when the server responds with a generic `error` type not related to starters? The existing error handling pipeline processes it; the `starters:error` event is only emitted when the error message explicitly relates to starters generation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Service MUST expose a public `getStarters(productData)` method that sends a `get_pdp_starters` message over the existing WebSocket connection.
- **FR-002**: Service MUST validate that `productData` contains non-empty `account` and `linkText` fields before sending the WebSocket message; throw a synchronous error if validation fails.
- **FR-003**: Service MUST construct the outgoing WebSocket payload following the existing `OutgoingPayload` format: `{ type: "get_pdp_starters", from: "<sessionId>", data: { account, linkText, productName?, description?, brand?, attributes? } }`.
- **FR-004**: Service MUST handle incoming `starters` messages from the server by emitting a `starters:received` event with the `data.questions` array.
- **FR-005**: Service MUST handle starters-related errors from the server by emitting a `starters:error` event with the error details.
- **FR-006**: Service MUST reject `getStarters()` calls when the WebSocket connection is not in `connected` state.
- **FR-007**: Service MUST track the latest starters request to prevent emitting stale responses when multiple rapid requests are made (request fingerprinting via `account:linkText`).
- **FR-008**: Service MUST add `STARTERS_RECEIVED` and `STARTERS_ERROR` to the `SERVICE_EVENTS` constants.
- **FR-009**: Service MUST add `GET_PDP_STARTERS` to the `WS_MESSAGE_TYPES` constants.
- **FR-010**: Service MUST handle the incoming `starters` message type in the `WebSocketManager._handleMessage` method, similar to how `project_language` and `ready_for_message` are handled — routing it to the appropriate event emission before it reaches the generic `MESSAGE` handler.

### Key Entities

- **Product Data**: Represents the product information sent with a starters request. Contains `account` (VTEX store identifier), `linkText` (product slug), and optional enrichment fields (`productName`, `description`, `brand`, `attributes`).
- **Starters Response**: The server's response containing generated conversation starter questions. Contains `questions` (array of 1–3 strings).
- **Starters Request Fingerprint**: A combination of `account:linkText` used to track the latest in-flight request and discard stale responses.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users see conversation starters within the socket server's response time (no added latency from the service layer beyond payload serialization).
- **SC-002**: When navigating between product pages, stale starters from a previous product are never displayed (0% stale data incidents).
- **SC-003**: Invalid starters requests (missing required fields, disconnected state) are caught and reported before reaching the server in 100% of cases.
- **SC-004**: The integration adds no additional configuration requirements to the webchat-react initialization — the existing WebSocket connection is reused entirely.

## Assumptions

- The `weni-webchat-socket` server already has the `get_pdp_starters` handler fully implemented (confirmed: `ParsePayload` dispatches to `GetPDPStarters`, which validates, deduplicates, and spawns a goroutine for Lambda invocation).
- The socket server responds with `type: "starters"` on success and `type: "error"` with a message containing "conversation starters" on failure.
- The socket server's `IncomingPayload` for starters includes `data.questions` as an array of strings.
- The webchat-react frontend will handle product detection, data extraction from VTEX API, and UI rendering of starters — this spec covers only the service bridge layer.
- The existing `WebSocketManager.send()` method is sufficient for sending the starters request (no queue needed since starters are fire-and-forget from the service perspective).
- Per-client deduplication and concurrency control are handled server-side; the service does not need to implement these.

## Scope Boundaries

### In Scope

- New `getStarters()` public method on `WeniWebchatService`
- Incoming `starters` message handling in `WebSocketManager`
- New `SERVICE_EVENTS` and `WS_MESSAGE_TYPES` constants
- Client-side validation of required fields
- Request fingerprinting to discard stale responses
- TypeScript type definitions update

### Out of Scope

- Product detection logic (handled by webchat-react)
- VTEX API integration (handled by webchat-react)
- UI rendering of conversation starters (handled by webchat-react)
- Server-side implementation (already complete in weni-webchat-socket)
- Lambda function implementation
- DynamoDB cache logic
- Client-side debounce (to be implemented in webchat-react)
