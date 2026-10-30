# M3 · Remote Candidate, QR, Device, and Trust Lifecycle

## Mission

Replace email/password/TOTP candidate login and direct QR redemption with first-session bootstrap, Passkey login, optional recovery, paired resume, device revoke, and trust reset.

## Read first

- `AGENTS.md`, `PROJECT.md`, `00-contracts.md`
- M1 and M2 handoffs
- `packages/server/src/remote/connector.ts`
- `packages/server/src/remote/login-qr-capability-store.ts`
- `packages/server/src/qr-session-issuer.ts`
- `packages/server/src/owner/session-runtime.ts`
- `packages/app/src/lib/remote/admission.ts`
- existing connector/QR/session tests

## Scope and allowed paths

- Remote candidate admission, E2EE binding, first-session grant consumption, normal login request QR, device/session lifecycle, trust reset, and matching protocol/client pure logic.
- Update connector/QR/device tests and DTOs necessary for M2 service calls.
- Do not implement WebAuthn cryptography, CLI IPC, or final React screens.

## Required behavior

- Keep Relay opaque routing and `admission: 'login'`; Owner remains the auth authority.
- First-session grant is five-minute, single-use, bound to Owner/node/trust epoch/official remote origin/first E2EE client key. It creates exactly the first remote device/session, no Passkey, no recovery consumption, no management authority, no second device.
- Ordinary management login QR is five-minute, single-use, one pending request per Owner, invalidated by replacement/cancel/restart/trust reset/expiry/success; it never creates a session alone.
- Normal candidate login uses remote Passkey if configured. Recovery is available only if recovery batch exists and delegates M2 recovery semantics.
- Paired resume validates token hash, device, trust epoch, idle/absolute TTL, and revocation. Logout/device revoke/trust reset close active connections and clear invalid client stores.
- Verify Owner public-key fingerprint before first trust; do not use Passkey as Owner identity proof and do not accept silent TOFU.

## Dependencies and seam

M2 owns auth methods and error semantics. M5 consumes QR payload, candidate states, presence flags, and paired-store invalidation behavior. M4 may add the explicit CLI grant-rotation command, but M3 owns the server operation.

## Validation

- Focused server connector/session/QR tests, protocol/Relay tests, and app admission/device-store pure tests.
- First-session replay/race, second-device rejection, no-management authority, restart/trust-reset invalidation, normal Passkey login, recovery-not-configured error, paired expiry/revoke.
- `pnpm typecheck`.
- `pnpm exec oxfmt --check <touched TypeScript files>`.
- `git diff --check`.

## Handoff

Report candidate state machine, QR payload schema, service seams, security events, client-store behavior, and exact tests. Explicitly state whether first-session and ordinary login paths are distinguishable in the client DTO.
