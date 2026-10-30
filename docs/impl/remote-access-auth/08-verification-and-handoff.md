# V · Integrated Verification and Cold-Start Handoff

## Mission

Verify the complete implementation against the frozen contract and leave a new session with a self-contained final status.

## Read first

- `AGENTS.md`, `PROJECT.md`, [`README.md`](./README.md), [`00-contracts.md`](./00-contracts.md)
- all M0–M6 handoffs
- final changed-file list and current source/docs

## Integrated checks

Run only after package handoffs are present:

- `pnpm --filter @codex-web/server test`
- `pnpm --filter @codex-web/protocol test`
- `pnpm --filter @codex-web/relay test`
- `pnpm --filter @codex-web/app test`
- `pnpm test`
- `pnpm typecheck`
- `pnpm exec oxfmt --check <all modified TypeScript files>`
- `git diff --check`

Before any authorized commit, stage only intended files and run `pnpm lint:staged`; do not include unrelated WIP.

## Manual browser and OS acceptance

- Clean database starts Owner/Relay/Codex without Passkey/recovery gate and prints exactly one first-session URL/QR line.
- First-session QR creates exactly one remote device/session, no credential, no management authority; replay/second device fails.
- Workspace works before optional security setup; dismissible management prompt appears once.
- Remote Passkey and recovery setup work from management; local Passkey uses a separate localhost ticket/origin.
- Passkey cannot cross origins; recovery is hash-only, single-use, rotates batch, registers new Passkey, revokes prior remote sessions.
- Paired resume, logout, session expiry, individual revoke, revoke-all, trust reset, and missing-recovery fallback behave as specified.
- Same-user CLI IPC works while Owner remains responsive; different-user access fails; stopped Owner path takes lock and exits cleanly.
- QR/grant expiry, restart, replacement, cancellation, and trust reset invalidate correctly; no secret appears in logs/URLs/events/diagnostics.
- Explicit database reset removes documented control-plane data, preserves Thread history/node identity, creates new owner ID, and forces re-pair.

The user operates required live services. If a live check is needed, report `pnpm dev`, `pnpm server`, and `pnpm relay`; do not start or stop user-operated services automatically.

## Cold-start handoff review

Confirm a new session can execute from `README.md` alone:

- package graph and dependencies are clear;
- frozen decisions have one source of truth;
- every RPC/DTO/table/CLI seam is documented;
- failure, reset, expiry, revoke, empty-security-state, and cleanup paths are covered;
- all package handoffs identify changed files, checks, and remaining work;
- no open product-decision blocker is hidden as an implementation detail.

## Final handoff

```markdown
## Final handoff: remote-access-auth
- Status: verified | blocked
- Package handoffs: <M0–M6 status>
- Contract deviations: <none or exact section>
- Tests/checks: <commands and results>
- Manual acceptance: <matrix and result>
- Remaining risks: <none or concrete risk>
- Next session instruction: <exact first action, or “none; implementation complete”>
```

## Current acceptance handoff

The implementation is not yet contract-complete. The active findings and exact next actions are recorded in `docs/acceptance-findings.md`; `docs/current-behavior.md` is the current behavior snapshot. The first next-session task is the bootstrap-reference registration path between Owner and Relay, followed by environment-configured App origin/RP ID and compact QR output. Manual browser/Relay acceptance remains user-operated.
