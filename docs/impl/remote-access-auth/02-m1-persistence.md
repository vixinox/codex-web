# M1 · Persistence, Reset, and Zero-Credential Startup

## Mission

Replace the Better Auth schema and terminal account/TOTP initialization with the Owner schema and first-session startup contract.

## Read first

- `AGENTS.md`, `PROJECT.md`, `00-contracts.md`
- `docs/current-behavior.md`
- `packages/server/src/db/schema.ts`
- `packages/server/src/database.ts`
- `packages/server/scripts/reset-local-database.ts`
- `packages/server/src/owner/owner-initialization.ts`
- `packages/server/src/owner/server.ts`

## Scope and allowed paths

- Schema/database/workspace ownership and reset script.
- Owner initialization and startup state machine.
- Direct tests for those modules and required package scripts/dependencies.
- Do not implement WebAuthn verification, remote candidate login, app screens, or IPC transport internals.

## Required behavior

- Use the table and field boundary in `00-contracts.md`; replace `user_id` with `owner_id` where required.
- Preserve credential AES-GCM encryption and `currentCredentialId` semantics.
- A clean startup prepares schema, starts HTTP/Owner WS/Relay/Codex after runtime readiness, and does not ask for email/password/TOTP, Passkey, recovery code, or acknowledgement.
- Issue one five-minute `first_session` grant after Owner listener readiness; expose its payload to the CLI once. Pending grant dies on restart.
- Initial local Passkey and recovery code are optional post-login setup, not startup gates.
- `pnpm db:reset` holds instance lock across delete and recreate, requires exact typed confirmation, and never migrates or silently deletes on startup.
- Preserve Codex Home history and database-external node key/fingerprint; reset all Owner control-plane data and generate a new owner ID.

## Dependencies and seam

M2 consumes exact table names and Owner lifecycle state. M3 consumes grant/request state. M4 consumes startup readiness and reset behavior. M1 must not invent RPC names owned by M2/M3.

## Validation

- Focused database/workspace/owner-initialization/reset tests.
- Assert no recovery plaintext, Passkey ceremony, or legacy account gate during clean startup.
- `pnpm typecheck`.
- `pnpm exec oxfmt --check <touched TypeScript files>`.
- `git diff --check`.

## Handoff

Report schema/table changes, startup state transitions, grant creation/printing seam, reset command behavior, preserved artifacts, and exact test results. Note any M0 race integration still pending.
