# Frozen Shared Contracts

This file is the shared boundary for M0–M6. A package may refine implementation details inside these boundaries, but may not change the behavior without a new user decision and a coordinator update.

## Identity and origins

- There is exactly one local Owner and one stable internal `ownerId`.
- Remove user-entered username, email, password, and TOTP. Keep owner ID, Passkey public credentials, optional recovery-code hashes, device records, sessions, and Owner/node identity.
- Local WebAuthn: exact origin `http://localhost:5173`, RP ID `localhost`.
- Remote WebAuthn: exact origin `https://codex.vixinox.com`, RP ID `codex.vixinox.com`.
- `relay.vixinox.com` is transport/routing only and never changes the WebAuthn origin.
- Local and remote Passkeys are independent and cannot authenticate across RP IDs. WebAuthn requires user verification and exact challenge, origin, RP ID, signature, and binding checks.

## First-session UX and QR semantics

- A clean Owner startup does not require a Passkey, recovery code, email, password, or TOTP.
- After the Owner listener is ready, the CLI prints one five-minute, single-use `first_session` URL/QR line. It does not print recovery codes and does not repeat the line on every restart.
- The first-session grant binds to owner ID, node identity, current trust epoch, official remote origin, and the first E2EE client public key. The first valid redemption creates exactly one remote device and session, then upgrades to paired admission.
- It does not register a Passkey, authorize management RPCs, or authorize a second device. Owner fingerprint verification remains mandatory.
- A lost/expired grant is regenerated only by an explicit CLI/IPC command. After all remote access paths are lost, the explicitly confirmed recovery command may revoke stale remote sessions and issue a new grant.
- Ordinary management login QR remains a five-minute, single-use request reference and does not create a session by itself.

## Optional security setup

- After the first session, the user may continue using the workspace without configuring Passkey or recovery code.
- The management page offers remote Passkey registration, recovery-code generation, and a localhost enrollment ticket for local Passkey registration.
- The first remote Passkey and first recovery batch may be configured from the first authenticated session. Later high-risk operations require a fresh Passkey step-up when the relevant origin has a Passkey.
- Recovery codes are ten high-entropy one-time codes, stored only as hashes. Recovery consumes one code atomically, requires new Passkey registration, rotates the batch, revokes prior remote sessions, and returns the new batch once.
- If neither a remote Passkey nor recovery batch exists, login-screen shows that the user must return to the Owner machine for a new bootstrap URL/QR.

## Sessions and devices

- Remote paired sessions use a device key and are silently resumed when valid.
- Session TTL is 30 days idle or 90 days absolute. Logout revokes the session and removes local token/key state.
- Keep server-side per-device records, individual revoke, revoke-all-remote-sessions, and trust reset. Trust reset increments the epoch and invalidates remote sessions, challenges, requests, and grants.
- Do not store WebAuthn private material. Session tokens are returned once and stored server-side only as hashes.

## Persistence and reset

The new SQLite schema contains at least: `owner`, `passkey_credential`, `recovery_code`, `local_enrollment_ticket`, `remote_device`, `owner_session`, `auth_throttle`, `project`, `credential`, and `codex_event`. Remove `user`, `account`, `verification`, `twoFactor`, and `owner_security_state`.

- `owner` has one row with stable ID, creation time, runtime initialization, and optional security-setup timestamps.
- `local_enrollment_ticket` stores only a hash, exact local RP ID, purpose, expiry, and consumption state.
- Challenges and pending grants are memory-only and die on Owner restart; persistent throttles survive restart.
- `pnpm db:reset` requires Owner stopped, instance lock, typed confirmation `RESET OWNER DATABASE`, deletion and schema creation in one process. No migration and no silent startup deletion.
- Reset removes Owner control-plane data, Projects, encrypted API credentials, sessions, events, and Owner ID. Preserve Codex Home Thread history and database-external Owner node key/fingerprint; force remote re-pair.

## CLI and IPC

- Owner is the only database writer and application-service authority.
- While Owner runs, CLI uses same-OS-user protected IPC: Windows named pipe; macOS/Linux Unix domain socket. Owner remains responsive and no second runtime starts.
- While Owner is stopped, CLI takes the instance lock and starts a short-lived managed runtime.
- IPC uses versioned newline-delimited JSON, 64 KiB frame limit, command allowlist, request IDs, stable errors, and no arbitrary RPC/SQL/path access.
- CLI never performs a Passkey ceremony. Normal startup prints only the first-session URL/QR. Recovery codes are printed only by explicit authenticated rotation/setup commands.

## App/login-screen contract

`packages/app/src/app/composition/screens/login-screen.tsx` must:

1. Try paired-session restore before showing login controls.
2. Accept camera, image, and manual first-session URL/QR entry.
3. Present first-session connection without Passkey, recovery, email, password, or TOTP fields.
4. Show Passkey login only when remote Passkey presence is reported.
5. Show recovery only when recovery batch presence is reported.
6. Explain the Owner-machine bootstrap path when neither exists.
7. Navigate to workspace after first-session redemption and show a dismissible one-time security-setup prompt linking to management.

## Legacy cleanup boundary

Delete Better Auth server/client usage, old email/password/TOTP RPCs and UI, `twoFactorEnabled` state/guards, direct QR redemption/session issuer, obsolete auth tests/fixtures, and stale initialization code. Keep unrelated provider API-key password fields and existing credential AES-GCM encryption.
