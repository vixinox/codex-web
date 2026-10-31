# Task 02: Browser Profiles and Admission

## Goal and completion result

Replace the single current remote-device record with isolated multi-profile storage and implement profile-scoped paired restoration, session handling, remote Passkey re-authentication, logout and removal logic. Deliver tested application logic for task 03 to present.

## Read first

- [Owner Device Enrollment Development Specification](../owner-device-enrollment.md)
- [Task 01: Owner Enrollment Protocol and Services](01-owner-protocol-and-services.md)
- [`../../frontend/README.zh-CN.md`](../../frontend/README.zh-CN.md)
- `packages/app/src/lib/remote/device-key-store.ts`, `admission.ts`, `relay-owner-socket.ts`, and their tests

## Scope and ownership

Own `packages/app/src/lib/remote` profile storage/admission logic and focused pure-logic tests. Export safe operations and presentation projections for task 03. Do not implement route components, login screens, Owner management UI, or server contracts.

Implement:

- Versioned multi-profile IndexedDB persistence. Each profile has independent key material, device identity, Owner/node binding, trusted Relay profile reference, pairing token, trust epoch, encrypted session and display metadata.
- Migration handling for the legacy single-current record: do not silently promote legacy identity/trust data. Reject or clear it safely and surface a state that leads to re-enrollment.
- Profile-scoped create/read/list/update/logout/remove operations. Logout clears session bearer material but preserves profile key and identity; removal clears all profile secrets and invokes authenticated revocation when available.
- Paired connection and encrypted session restore; identity checks before session recovery or Passkey; remote Passkey for a known, matching connection only.
- A safe status/error projection that distinguishes offline, unavailable, identity mismatch, revoked, expired session, Passkey required, and corrupt/unreadable profile states without leaking secrets.
- Isolation guarantees: failure, logout, expiry or corruption of one profile does not mutate another profile.

## Dependencies and integration

Pure profile storage can begin independently. Before wiring redemption, align the stored enrollment result with task 01's published semantic DTO and the existing session contract. Task 03 consumes these profile APIs and status projections. Task 04 verifies the full cross-boundary flows.

## Acceptance criteria

- Multiple saved profiles persist and can be listed, selected and updated independently across reloads.
- The private device key remains non-exportable; session bearer is encrypted with the profile's protected storage key. Secrets do not appear in UI projections, URL serialization, logs or errors.
- Paired restore uses the selected profile's device/token/session only.
- Owner key, node ID or trust-epoch mismatch fails closed for that profile and never silently replaces its identity.
- Session expiry triggers Passkey only for a matching known profile. If no remote Passkey is available, safe metadata remains and the UI can request a fresh invitation.
- Logout preserves profile identity/key while clearing session credentials. Removal clears all local secrets and tries server revocation only through an authenticated connection.
- Legacy record handling, malformed records, decryption failure, profile isolation and expiry have focused tests.

## Focused validation

```text
pnpm test:frontend
pnpm typecheck
pnpm exec oxfmt --check <touched TypeScript files>
```

## Local implementation choices

Use existing IndexedDB/crypto helpers and existing admission/session abstractions where they satisfy the invariants. Choose the storage schema version, stable local profile ID format, and UI-neutral status names locally. Do not add a new persistence dependency or weaken cryptographic/non-exportable-key properties.
