# M4 · Adaptive CLI and Local Passkey Reset

## Mission

Make CLI commands work through the running Owner when available, otherwise through a locked temporary runtime, and remove CLI Passkey/recovery behavior that conflicts with the zero-credential startup.

## Read first

- `AGENTS.md`, `PROJECT.md`, `00-contracts.md`
- M0 and M1 handoffs
- M2 management method handoff
- `packages/server/src/owner/cli.ts`
- `packages/server/src/owner/cli-runtime.ts`
- `packages/server/scripts/owner-cli.ts`
- `packages/server/src/owner/instance-lock.ts`

## Scope and allowed paths

- CLI command parser/UX, IPC client/dispatcher integration, running/stopped selection, startup grant rotation, local Passkey reset, tests, and package scripts.
- Do not write SQL directly from CLI and do not implement WebAuthn ceremony in CLI.

## Required behavior

- Probe IPC first. If Owner is running, send only allowlisted management commands to Owner; do not take data-root lock or open a second runtime. Owner remains responsive.
- If IPC unavailable, attempt atomic instance lock. If Owner is active, retry IPC up to five seconds and fail without a second runtime. If stopped, start short-lived managed runtime under lock.
- Normal clean startup prints one first-session URL/QR once after listener readiness. Add explicit command to rotate/print a lost or expired grant. After all paths are lost, recovery command requires interactive typed confirmation and revokes stale remote sessions before issuing a new grant.
- CLI never performs Passkey ceremony. It never prints recovery codes during startup. Explicit authenticated/confirmed recovery rotation may print codes once, never in logs/JSON diagnostics.
- Local Passkey reset is stopped-only, explicitly confirmed, local-origin credentials/sessions only, hash-only five-minute enrollment ticket, remote credentials/sessions/recovery/projects/node identity preserved.
- Destructive commands require interactive confirmation; no raw RPC/SQL/filesystem path passthrough.

## Dependencies and seam

M0 owns endpoint framing/ACL. M1 owns startup/reset lock. M2 owns methods and local enrollment ticket. Do not add commands without corresponding Owner service methods and contract documentation.

## Validation

- Running/stopped/start-race tests, Owner responsiveness, same-user ACL, different-user denial, no direct DB writes, destructive confirmations, grant printing/no secret logs, local reset isolation.
- `pnpm typecheck`.
- `pnpm exec oxfmt --check <touched TypeScript files>`.
- `git diff --check`.

## Handoff

Report CLI command names, running/stopped decision table, IPC errors/retry, secret-output audit, local reset effects, and exact tests. State whether M6 must remove any legacy command aliases.
