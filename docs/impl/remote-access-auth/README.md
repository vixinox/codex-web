# Remote Access Authentication · Multi-Agent Work Package

## 1. Status and startup instruction

- **Status:** Ready for implementation.
- **Goal:** Replace account/password/TOTP authentication with origin-scoped Passkeys, optional recovery codes, per-device sessions, a one-time first-session URL/QR, and an Owner-owned adaptive CLI. Remove obsolete authentication code and contracts in the same implementation.
- **Coordinator entry point:** This file.
- **Frozen contract:** [`00-contracts.md`](./00-contracts.md).
- **Discussion history:** [`../remote-access-auth-discussion.md`](../remote-access-auth-discussion.md).
- **Repository rules:** [`AGENTS.md`](../../../AGENTS.md), [`PROJECT.md`](../../../PROJECT.md).

Every new session or subagent starts by reading `AGENTS.md`, `PROJECT.md`, this file, `00-contracts.md`, and the assigned package file. The assigned package file is a complete work order; no additional prompt or product decision is required.

## 2. Authority and change control

1. The user's latest confirmed decisions and `00-contracts.md` are authoritative for product behavior.
2. Package files define implementation scope and validation. They cannot weaken a frozen contract.
3. Current source and `docs/current-behavior.md` describe the pre-implementation baseline only.
4. If source contradicts a frozen contract, preserve the requested target and record the contradiction in the package handoff; do not silently redesign the target.
5. A subagent may edit only the files listed in its package unless a shared contract or generated lockfile must be updated. Preserve unrelated WIP.
6. Do not commit, reset, checkout, merge, rebase, push, or start a second Owner/Vite/Relay service unless the user explicitly requests it. Run focused checks before handing off.

## 3. Package graph and dispatch

```text
M0 IPC primitive ───────┐
                        ├── M4 adaptive CLI
M1 persistence/startup ─┼── M2 WebAuthn/session ──┐
                        │                         ├── M3 remote/QR/device
                        └─────────────────────────┘
                                                   └── M5 app/login-screen
                                                        └── M6 cleanup/contracts
                                                            └── V verification
```

| ID | Work order | Depends on | Primary ownership | Can start when |
| --- | --- | --- | --- | --- |
| M0 | [`01-m0-ipc.md`](./01-m0-ipc.md) | none | `packages/server/src/owner/*ipc*`, instance-lock tests | immediately |
| M1 | [`02-m1-persistence.md`](./02-m1-persistence.md) | none for design; M0 for final startup race check | schema, reset, initialization | immediately; coordinate with M0 before final integration |
| M2 | [`03-m2-webauthn-sessions.md`](./03-m2-webauthn-sessions.md) | M1 schema names | auth domain, challenge/session services | after M1 table contract is stable |
| M3 | [`04-m3-remote-qr-device.md`](./04-m3-remote-qr-device.md) | M1, M2 | candidate admission, QR, remote device lifecycle | after M2 service contracts exist |
| M4 | [`05-m4-adaptive-cli.md`](./05-m4-adaptive-cli.md) | M0, M1, M2 | CLI IPC and local Passkey reset | after M0 endpoint contract and M2 management methods |
| M5 | [`06-m5-app-login-and-management.md`](./06-m5-app-login-and-management.md) | M2, M3 | app auth flow, `login-screen.tsx`, management UX | after RPC shapes are stable |
| M6 | [`07-m6-legacy-cleanup-and-sync.md`](./07-m6-legacy-cleanup-and-sync.md) | M1–M5 | delete legacy code and synchronize docs/contracts | after all behavior packages pass |
| V | [`08-verification-and-handoff.md`](./08-verification-and-handoff.md) | M6 | integrated verification and cold-start handoff | after implementation packages complete |

Parallel work is allowed only when package file boundaries and shared contracts remain intact. M1 and M0 may proceed in parallel, but M1 must use the table names in `00-contracts.md`; M4 cannot be declared complete until both are integrated.

## 4. How a subagent executes a package

1. Read the common files and the assigned package file.
2. Inspect current source only in the package's entry points and baseline files.
3. Implement the package's target behavior without reopening frozen product decisions.
4. Run the package's focused checks, `pnpm typecheck`, and `pnpm exec oxfmt --check` for touched TypeScript.
5. Re-run `git diff --check` for touched docs/source.
6. Do not wait for a further instruction. Finish with the handoff block below in the session response and, if working in a shared checkout, leave the working tree changes in place.

### Required handoff block

```markdown
## Handoff: <package ID>
- Status: complete | blocked | partial
- Changed files: <absolute or repository-relative paths>
- Contract impact: none | <exact contract section and reason>
- Behavior implemented: <short concrete description>
- Checks run: <commands and result>
- Known failures: <none or exact output/condition>
- Follow-up for: <next package ID and exact seam>
- Do not redo: <decisions or checks already completed>
```

If blocked, identify the exact dependency, source evidence, and the smallest decision or change needed. Do not mark a package complete with unverified behavior.

## 5. Global completion criteria

- No Owner username, email, password, TOTP, Better Auth account/session, guest mode, or old QR redemption remains.
- Clean startup prints one first-session URL/QR once after Owner is ready; it does not print recovery codes or require Passkey setup.
- The first-session URL/QR creates exactly one first remote device/session and no credential or management authority.
- Remote/local Passkeys use separate exact origins and RP IDs.
- Recovery codes are optional after login, hash-only, one-time, atomically consumed, and rotated after recovery.
- CLI delegates over same-OS-user IPC while Owner runs and uses a locked temporary runtime only while Owner is stopped.
- `owner.sqlite` is explicitly deleted/recreated; no migration or silent startup deletion exists.
- `login-screen.tsx` implements the zero-credential first-session path and conditionally exposes Passkey/recovery controls.
- All package checks, repository typecheck, final tests, formatting, manual browser checks, and `pnpm lint:staged` (before any authorized commit) pass.

## Current implementation handoff

Core Owner-only implementation is landed, but integrated acceptance is incomplete. Read [`docs/current-behavior.md`](../../../docs/current-behavior.md) and [`docs/acceptance-findings.md`](../../../docs/acceptance-findings.md) before changing source. The first follow-up is the bootstrap-reference protocol: Relay currently routes by owner code, so a reference-only URL requires an in-memory Owner-to-Relay registration/revocation seam. Do not shorten the URL by merely moving the existing full payload into another parameter.
