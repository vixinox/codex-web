# Task 04: Integration, Retirement, and Acceptance

## Goal and completion result

Integrate the server/protocol, browser-profile, and UI work into one enrollment lifecycle; remove leftover legacy contracts that are no longer reached; update authoritative behavior snapshots and verify the complete acceptance matrix.

## Read first

- [Owner Device Enrollment Development Specification](../owner-device-enrollment.md)
- Task packages [01](01-owner-protocol-and-services.md), [02](02-browser-profiles-and-admission.md), and [03](03-remote-routes-and-device-management.md)
- [`../../owner-remote-architecture.md`](../../owner-remote-architecture.md), [`../../api/README.zh-CN.md`](../../api/README.zh-CN.md), [`../../frontend/README.zh-CN.md`](../../frontend/README.zh-CN.md), and [`../../current-behavior.md`](../../current-behavior.md)

## Scope and ownership

Own cross-package integration fixes, stale references in in-scope docs/scripts/tests, `docs/current-behavior.md` migration status, and final acceptance evidence. Component implementation remains owned by tasks 01-03; avoid duplicating their features.

Implement:

- Verify the end-to-end issue -> reference routing -> E2EE key binding -> atomic redemption -> profile persistence -> session restore lifecycle.
- Verify all invalidation/revocation paths and ensure errors map consistently from Owner services through protocol and UI.
- Search in-scope source/docs/tests for Owner-code remote admission, manual fingerprint confirmation, recovery-code paths, login-QR requests, and first-session-only contracts; remove dead DTOs, method registry entries, route branches, fixtures, and docs. Retain internal route/identity data where architecture requires it.
- Update `docs/current-behavior.md` to describe the migrated implementation accurately only after the relevant implementation is complete. Keep architecture/API/frontend specs aligned with actual contracts; do not claim incomplete flows.
- Recreate `docs/acceptance-findings.md` only if there are actual acceptance findings; record findings for the new model rather than copying legacy findings.

## Dependencies and integration

Requires tasks 01, 02 and 03 to be integrated. No new task should depend on this package for component design. This package is the final integration/cleanup owner.

## Acceptance criteria

- All ten main-spec acceptance scenarios pass, including concurrent redemption and profile isolation.
- Legacy admission removal is complete across implementation, tests and authoritative docs, with required internal routing/pinning fields preserved.
- `current-behavior.md` distinguishes completed behavior from remaining gaps and does not describe target capabilities as implemented prematurely.
- Cross-package failures preserve the main spec's stable security behavior and do not disclose capability validity or secrets.

## Validation

```text
pnpm test:server
pnpm test:protocol
pnpm test:relay
pnpm test:frontend
pnpm typecheck
pnpm exec oxfmt --check <touched TypeScript files>
pnpm lint:staged
git diff --check
```

Run manual browser regression for local/remote route separation, invite redemption, profile workflows, and management controls. Stage only intended files before `pnpm lint:staged`; do not include unrelated staged work. Report any unavailable service prerequisite rather than substituting a retired live-test command.

## Local implementation choices

Cleanup should follow `AGENTS.md` and the main specification. Do not expand into unrelated architecture, dependency, workspace, or runtime changes. Update the main spec only for a demonstrated source-contract conflict or a user-approved scope change.
