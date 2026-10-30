# M6 · Legacy Cleanup and Contract Synchronization

## Mission

After M1–M5 behavior exists, remove obsolete authentication and QR code paths and synchronize stable architecture/API/frontend/current-behavior documentation.

## Read first

- `AGENTS.md`, `PROJECT.md`, `00-contracts.md`
- all M1–M5 handoffs
- `docs/owner-remote-architecture.md`
- `docs/api/README.zh-CN.md`
- `docs/frontend/README.zh-CN.md`
- `docs/current-behavior.md`

## Scope and allowed paths

- Delete obsolete server/client auth modules, Better Auth dependencies, old RPCs/routes/tests/fixtures, old QR redemption/session issuer, and stale startup code.
- Synchronize the stable docs named above and mark discussion history as superseded by this package.
- Do not remove unrelated settings/provider API-key password fields or credential AES-GCM code.

## Required cleanup

- No imports or dependencies for Better Auth remain.
- Remove `user`, `account`, `verification`, `twoFactor`, `owner_security_state`, email/password/TOTP Owner RPCs, `twoFactorEnabled`, direct `owner.loginQr.redeem`, and `qr-session-issuer` behavior.
- Remove old CLI `auth totp reset` and legacy aliases. Keep new explicit bootstrap/recovery commands.
- Remove obsolete auth DTOs, pending TOTP state, old route guards, and tests/fixtures that assert the old flow.
- Preserve unrelated provider/API-key password vocabulary and document why remaining matches are not Owner auth.
- Update current behavior only to describe implemented behavior; do not claim manual acceptance before V.

## Validation

- Repository-wide `rg` for `better-auth`, `twoFactorEnabled`, TOTP auth method names, old QR redemption, email/password Owner login.
- Full `pnpm test` and `pnpm typecheck`.
- `pnpm exec oxfmt --check <all modified TypeScript files>`.
- `git diff --check`.

## Handoff

Report every deletion, every intentionally retained search match, synchronized documents, full test results, and any manual check still owned by V.
