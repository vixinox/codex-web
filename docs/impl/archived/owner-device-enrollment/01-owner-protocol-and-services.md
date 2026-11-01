# Task 01: Owner Enrollment Protocol and Services

## Goal and completion result

Implement Owner-owned invitation issue/status/cancel/redeem and make Relay reference routing the only unknown-browser admission path. The result publishes the stable semantic contract consumed by the browser profile work in task 02.

## Read first

- [Owner Device Enrollment Development Specification](../owner-device-enrollment.md)
- [`../../owner-remote-architecture.md`](../../owner-remote-architecture.md)
- [`../../api/README.zh-CN.md`](../../api/README.zh-CN.md)
- [`../../current-behavior.md`](../../current-behavior.md)

## Scope and ownership

Own `packages/protocol/src/owner`, `packages/protocol/src/relay`, `packages/server/src/owner`, `packages/server/src/remote`, `packages/relay/src`, and their focused tests. Coordinate semantic DTO and admission details for task 02; do not implement browser profile UI or route screens.

Implement:

- One active Owner invitation, random reference, five-minute adopted TTL, replacement, status, cancellation, atomic single-use consumption, and invalidation on the lifecycle events in the main specification.
- Issuance through existing local management/CLI IPC and authenticated paired-session entry points. Apply Passkey step-up when configured; preserve local recovery through the existing Owner/IPC authorization boundary.
- Redemption bound to the E2EE handshake public key, Owner/node identity, and trust epoch. Never accept caller-supplied device identity as authority. Create the device, pairing credential and initial session at most once under concurrent redemption.
- Online Relay registration/unregistration and reference-only candidate routing. Owner validates authorization; Relay stores only ephemeral routing state and invalidates it on disconnect/restart.
- Stable semantic request/result and error behavior for enrollment issue/status/cancel/redeem. The reference may reach only the issuing surface that needs to render the active URL/QR.
- Removal of recovery-code and login-QR server operations/storage, Owner-code login admission, and first-session-only contracts. Preserve the remote Passkey pair for known profiles and device/session/trust management contracts.

## Contract and invariants

- Invitation deep-link payload contains only a schema-versioned opaque reference. It does not carry Relay URL, Owner code, fingerprint, session token or key material.
- Relay URL comes from the trusted application profile. Custom Relay selection is excluded.
- A valid reference can cause exactly one device/session creation. All invalid or replayed attempts fail closed without creating a device/session.
- Invitation state is runtime-scoped; Owner restart invalidates it. Relay restart/disconnect must not leave a reference usable after reconnect without fresh registration.
- Trust reset, relevant device revocation, replacement, cancellation, expiry and success invalidate the reference consistently.
- Keep authorization checks inside Owner application services; transport and Relay adapters do not become a second policy implementation.

## Dependencies and integration

No prerequisite package. Publish the semantic invitation payload, redeem result, stable failure categories, and expected admission transport shape before task 02 integrates. Task 02 may implement pure local storage before this package is complete, but must not invent an incompatible DTO.

Task 03 consumes the Owner issue/status/cancel operations and relies on their authorization rules. Task 04 owns final stale-reference/document cleanup and end-to-end acceptance.

## Acceptance criteria

- First issue creates one active reference; second issue invalidates the first. Cancel is idempotent; status exposes no reusable secret to unauthorized projections.
- Expiry, restart, Relay disconnect/restart, trust reset, cancellation and revocation invalidate active enrollment.
- Two concurrent redemptions of one valid reference produce no more than one device and one initial session. Replays and invalid identity/epoch/key/reference create none.
- Browser key, node/Owner identity and trust epoch used by Owner are derived from authenticated handshake/runtime state, not untrusted body fields.
- Relay can route by registered opaque reference without learning Owner methods or session/device secrets; Owner remains the validation authority.
- Owner-code login, recovery-code, ordinary login-QR and obsolete first-session-only operation paths are removed with focused regression coverage. Paired and known-profile Passkey admission continue to work.

## Focused validation

```text
pnpm test:server
pnpm test:protocol
pnpm test:relay
pnpm typecheck
pnpm exec oxfmt --check <touched TypeScript files>
```

## Local implementation choices

Follow existing Owner method registry, error taxonomy, in-memory capability-store, Relay registration and CLI IPC conventions. Any implementation detail that would persist invitations, put routing data in the deep link, change Owner authorization, or make Relay authoritative requires updating the main specification first.
