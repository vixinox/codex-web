# M2 · WebAuthn, Recovery, and Sessions

## Mission

Implement the origin-scoped authentication domain consumed by local management and remote candidate connections.

## Read first

- `AGENTS.md`, `PROJECT.md`, `00-contracts.md`
- M1 handoff and schema
- `packages/server/src/owner/application-services.ts`
- `packages/server/src/owner/methods.ts`
- `packages/server/src/owner/session-runtime.ts`
- current auth/security tests

## Scope and allowed paths

- Add WebAuthn challenge/credential/assertion verification, recovery hashing/reservation/rotation, session TTL/revocation, step-up authorization, and Owner RPC service methods.
- Update server auth-domain tests and dependency manifests/lockfile as needed.
- Do not change QR candidate transport, Relay routing, CLI IPC, or React UI beyond DTO/type exports required by the server contract.

## Required behavior

- Use `@simplewebauthn/server@14.0.3` and browser-native WebAuthn contract assumptions.
- Challenge: at least 32 random bytes, five-minute expiry, max three failures, atomic consume, bound to owner/purpose/origin/RP/connection/E2EE key/request; persistent throttles survive restart.
- Exact local/remote origin and RP ID; require user verification; never accept client-supplied expected origin/RP.
- Recovery: optional ten-code batch, hash-only, atomic one-time consumption, reservation lock, new Passkey registration before session, rotate batch, revoke prior remote sessions, return new codes once.
- Sessions: token hash only, 30-day idle/90-day absolute expiry, device/trust epoch/revocation checks, one-use five-minute step-up authorization tied to exact method.
- Expose stable errors including `PASSKEY_REQUIRED`, `PASSKEY_INVALID`, `CHALLENGE_EXPIRED`, `CHALLENGE_ATTEMPTS_EXCEEDED`, `RECOVERY_CODE_INVALID`, `RECOVERY_CODE_RESERVED`, `RECOVERY_NOT_CONFIGURED`, `SESSION_EXPIRED`, and `SESSION_REVOKED`.
- The first authenticated remote session may register the first remote Passkey and issue the first recovery batch without step-up. Later high-risk operations require step-up where a relevant Passkey exists.

## Dependencies and seam

M1 owns persistence names. M3 calls these services from login-candidate admission. M5 consumes method names/DTOs. If a method is needed by M3/M5, add it to the contract and handoff; do not leave an undocumented RPC.

## Validation

- Focused tests: origin/RP mismatch, signature, UV=false, expiry/replay, three failures, concurrent recovery, session TTL/revoke, step-up binding.
- `pnpm typecheck`.
- `pnpm exec oxfmt --check <touched TypeScript files>`.
- `git diff --check`.

## Handoff

Report method names, input/output/error envelopes, persistence effects, and which methods M3/M5 may call. Include all focused test results and unresolved integration seams.
