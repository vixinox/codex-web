# Task 06: Remote connector and Owner session runtime

## Status and dependency

- Status: **Verified** (2026-11-25).
- Source of truth: [Project Health specification](./README.md).
- Task 01 supplies the stable Owner registry and resume/auth interfaces. This task owns Remote and Owner session internals only.

## Goal

Reduce coupling in the Relay connection and Owner session state machines while preserving E2EE, admission, frame delivery order, reconnect, revocation and shutdown behavior.

## Pre-refactor entry points and state

- `packages/server/src/remote/connector.ts` owns Relay socket lifecycle, reconnect/heartbeat timers, enrollment reference routing, per-client handshake phases, E2EE keys and sequences, Owner virtual transports and session runtime instances.
- `packages/server/src/owner/session-runtime.ts` owns Owner frame parsing/dispatch, hello/admission, requests, timeout/cancel, streams, serialized writes, backpressure and close cleanup.
- `packages/server/src/owner/websocket.ts` and `OwnerConnector` share `OwnerSessionRuntime`; the relay router remains an opaque transport and is outside this task.

## Required state audit

The audit below was completed before extraction. It assigns socket timers, client handshake/session maps, enrollment references, E2EE keys/sequences, inbound serialization, revocation revision, admission, request controllers/timeouts, stream controllers and output queue capacity to one owner each. Existing regressions cover handshake revocation, enrollment promotion, queued frame/close ordering, request cancel/timeout, stream cancellation and shutdown.

## Implementation decisions

### State audit and selected seams (2026-11-25)

| State | Owner and lifecycle |
|---|---|
| Relay socket, attach transport, running/connected flags, ready/heartbeat/reconnect timers, inbound Relay serialization | OwnerConnector; timers and all admitted clients end on stop/disconnect; socket identity guards late callbacks |
| Current enrollment routing reference | OwnerConnector; issue/register/unregister and relay disconnect invalidate it |
| Client binding/enrollment references, handshake phase, key/receive sequence/send sequence/send queue, revocation revision | Remote client-sessions module; attach creates state, handshake promotes it, per-device close or Relay teardown releases it; revision invalidates in-flight handshakes |
| Owner admission, client ID, active request/controllers/timeouts, streams | OwnerSessionRuntime; hello/admit creates authorization, execute/cancel/timeout settle requests, close aborts all and removes listeners |
| Virtual Owner transport listeners | Transport adapter; close is idempotent and clears both listener sets |
| Ordered encoded output queue/queued bytes | Session sender; runtime validates frames/limits, sender owns queued-byte capacity and actual delivery, runtime close invalidates pending sends |

Client-session handling receives only the trust adapter, remote admission callbacks and a Relay frame sender. It never mutates Relay socket/reconnect state. Owner runtime remains responsible for frame/error semantics and the request/stream state machine; type/transport and ordered sender modules do not create a second admission or stream state owner.

- Keep `OwnerConnector` and `OwnerSessionRuntime` as facades used by current callers.
- Extract only one-way internal modules with a single state owner. A likely seam is Relay connection lifecycle vs client E2EE/session handling; another candidate is Owner request lifecycle vs ordered frame sender. Confirm each seam against the audit before moving code.
- Do not split state that must be atomically coordinated across async callbacks into separately mutable managers. Record a per-file line-budget exemption when the state machine is cohesive.
- Keep remote transport adapters explicit and injected. No module may authorize Owner business methods independently of OwnerSessionRuntime.
- Preserve current close order: already received/decrypting Relay messages are delivered before close processing; stale callbacks from replaced sockets cannot affect the replacement.
- Remove old implementation paths after cutover; no dual connector/session runtime.

## Acceptance and validation

- Owner wire frames and Relay protocol frames are byte-shape compatible; Relay still sees opaque encrypted Owner payloads.
- Device authorization, trust epoch, session resume and revocation checks remain in their current authoritative path.
- Request/stream timeout and cancellation, frame size limits, backpressure behavior, and serialized send ordering remain unchanged.
- All listeners, timers, sockets, requests, streams and keys owned by a closed lifecycle are released; a stale callback cannot mutate a replacement lifecycle.
- Run focused `connector.test.ts`, `session-runtime.test.ts`, `websocket.test.ts`, protocol and device-management tests; then `pnpm typecheck` and touched-file `oxfmt --check`.
- Manual browser/Relay regression after implementation is a user acceptance handoff, not a replacement for these tests.

## Non-goals

No Relay package changes, new wire version, crypto change, auth policy change, extra relay persistence or Owner/Relay topology change.

## Implemented result and verification

- `OwnerConnector` is 406 lines and retains socket/reconnect/heartbeat, inbound serialization and invitation routing. `remote/sessions/index.ts` owns client binding, handshake, keys/sequences/send queues, revocation revision and virtual Owner transport/runtime instances.
- `OwnerSessionRuntime` is 444 lines and retains admission/request/stream state. `owner/session/contracts.ts`, `virtual-transport.ts`, `ordered-sender.ts` and `request.ts` isolate transport contracts, listener cleanup, ordered output capacity and request utilities. Original facade exports remain available; no dual implementation remains.
- Focused connector/session/WebSocket/device tests and full workspace tests passed, including protocol and Relay checks. Typecheck, touched-file formatting and both lint commands passed. No budget exemptions were needed.
- Real browser enrollment, Passkey, session restoration/revocation and reconnect remain post-implementation user acceptance once services are running; they are not claimed as manually verified.
