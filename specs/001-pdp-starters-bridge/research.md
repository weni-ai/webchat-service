# Research: PDP Conversation Starters Bridge

**Branch**: `001-pdp-starters-bridge` | **Date**: 2026-03-09

## R1: Where to handle incoming `starters` messages

**Decision**: `WebSocketManager._handleMessage()` intercepts `starters` type and emits `STARTERS_RECEIVED`.

**Rationale**: The existing codebase has two patterns for handling incoming WebSocket messages:
1. **Non-message metadata** (`ready_for_message`, `project_language`, `pong`, `allow_contact_timeout`) — intercepted in `_handleMessage()` before reaching `MessageProcessor`.
2. **Chat messages** (`message`, `stream_start`, `delta`, `stream_end`, `typing_start`) — forwarded to `MessageProcessor` for normalization, queuing, and state management.

Starters responses are metadata, not chat messages. They should not be normalized, queued, or stored in message state. They are a direct response to a request, similar to `project_language`.

**Alternatives considered**:
- *Route through MessageProcessor*: Rejected. Would require adding starters-specific handling to a processor designed for chat messages. The response doesn't need normalization, queuing, or state management.
- *Create a new StartersManager module*: Rejected. Over-engineering for a simple request-response pattern. The existing HistoryManager pattern (separate module) is justified because history involves merging, pagination, and state management. Starters are fire-and-forget.

## R2: Request-response correlation without server-side request IDs

**Decision**: Track the latest request fingerprint (`account:linkText`) on the service instance. Discard responses when the fingerprint has been cleared or changed.

**Rationale**: The socket server's `IncomingPayload` for `starters` responses does not include any request identifier or echo back the original request data. The response is simply `{ type: "starters", data: { questions: [...] } }`. This means the client cannot match a specific response to a specific request.

However, this is acceptable because:
1. The server's `StartersInFlight` dedup ensures only one starters request is in-flight per client at a time.
2. The response is always for the most recent request that the server accepted.
3. The client only needs to know if the response is still relevant (user hasn't navigated away).

The fingerprint is set when `getStarters()` is called and cleared when the frontend signals navigation away (or when a new `getStarters()` call overwrites it).

**Alternatives considered**:
- *Add a request ID to the WebSocket protocol*: Rejected. Would require modifying the socket server's `OutgoingPayload` and `IncomingPayload` types, which is out of scope and a breaking change to the protocol.
- *Ignore staleness entirely*: Rejected. Would cause stale starters to be displayed briefly when navigating between PDPs in rapid succession.

## R3: Error discrimination strategy

**Decision**: Match errors containing "conversation starters" in the error string to emit `starters:error` instead of generic `error`.

**Rationale**: The socket server's `GetPDPStarters` handler constructs all error messages with a recognizable pattern:
- `"failed to generate conversation starters: <reason>"` for Lambda failures
- `"get pdp starters: concurrency limit reached, try again later"` for semaphore rejection
- `"data is required"` and `"account and linkText are required"` for validation (though these should be caught client-side)

The service matches on the presence of "starters" in the error message. This covers the Lambda failure case and concurrency limit. Validation errors are caught client-side before sending.

Additionally, the service should clear the `_latestStartersFingerprint` on error, so the frontend knows no starters are pending.

**Alternatives considered**:
- *Track in-flight state and attribute any error during in-flight to starters*: Rejected. Too fragile — generic connection errors or unrelated server errors would be misattributed.
- *Use a dedicated error type from the server*: Rejected. Would require protocol changes to the socket server.

## R4: Public API shape

**Decision**: Single method `getStarters(productData)` that returns `void` (fire-and-forget). Results arrive via events.

**Rationale**: This follows the existing pattern in the codebase. `sendMessage()` is fire-and-forget, results arrive via `message:received`. `getHistory()` is the exception (returns a Promise), but history has a synchronous request-response pattern with the server replying on the same connection frame. Starters responses arrive asynchronously from a background goroutine after Lambda invocation (potentially 2-8 seconds later).

An event-based pattern is appropriate because:
1. The response is asynchronous and delayed (Lambda invocation).
2. Multiple consumers may want to listen (the React context, analytics, etc.).
3. The response may never arrive (connection drop, server error) — events handle this gracefully.

**Alternatives considered**:
- *Return a Promise that resolves with questions*: Rejected. Would require maintaining a pending promise map and matching responses to requests. Complex for marginal benefit, and the absence of request IDs in responses makes it fragile.
- *Callback-based API*: Rejected. Events are the established pattern in this codebase.

## R5: Payload field name — `get_pdp_starters` vs `get_starters`

**Decision**: Use `get_pdp_starters` as the WebSocket message type.

**Rationale**: The socket server's `ParsePayload` switch already handles `"get_pdp_starters"` (not `"get_starters"`). The `starters.md` spec in webchat-react mentions `get_starters`, but that document was written before the server implementation. The actual server code uses `get_pdp_starters` in both the switch case and the `GetPDPStarters` function name. We must match the server's actual contract.

**Alternatives considered**:
- *Use `get_starters` and request a server change*: Rejected. The server is already deployed and working. Changing it would require coordinated deployment of socket server + service library + frontend.
