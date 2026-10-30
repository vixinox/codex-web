# Remote Access Authentication Work Package (Compatibility Entry Point)

The implementation specification has been split into independently executable work packages so a new session or subagent can start without conversational context.

Read the coordinator index first:

- [`remote-access-auth/README.md`](./remote-access-auth/README.md)
- [`remote-access-auth/00-contracts.md`](./remote-access-auth/00-contracts.md)

The package order is M0–M6 followed by integrated verification V:

1. [`01-m0-ipc.md`](./remote-access-auth/01-m0-ipc.md)
2. [`02-m1-persistence.md`](./remote-access-auth/02-m1-persistence.md)
3. [`03-m2-webauthn-sessions.md`](./remote-access-auth/03-m2-webauthn-sessions.md)
4. [`04-m3-remote-qr-device.md`](./remote-access-auth/04-m3-remote-qr-device.md)
5. [`05-m4-adaptive-cli.md`](./remote-access-auth/05-m4-adaptive-cli.md)
6. [`06-m5-app-login-and-management.md`](./remote-access-auth/06-m5-app-login-and-management.md)
7. [`07-m6-legacy-cleanup-and-sync.md`](./remote-access-auth/07-m6-legacy-cleanup-and-sync.md)
8. [`08-verification-and-handoff.md`](./remote-access-auth/08-verification-and-handoff.md)

`00-contracts.md` is the single frozen behavior contract. This compatibility entry point intentionally contains no second copy of the architecture; do not implement from an older chat excerpt or from the pre-split discussion document.
