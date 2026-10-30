# Current behavior

> Status snapshot: 2026-10-30. This document describes the current implementation and its verified limits. It is not a claim that the full remote-access contract has passed manual acceptance.

The server initializes one Owner row and starts without an email, password, TOTP, Passkey, or recovery-code ceremony. When remote relay access is configured and no device exists, it prints one five-minute single-use first-session URL and a terminal QR on TTY. The grant is memory-only and disappears on restart.

Remote first-session redemption verifies the Owner fingerprint, binds the first E2EE client key, creates one remote device and session, and admits the client with bootstrap scope. The current implementation still hard-codes the remote WebAuthn profile to `https://codex.vixinox.com` / `codex.vixinox.com`; local Passkeys use `http://localhost:5173` / `localhost`. The local development first-session URL currently embeds the complete payload, so local startup can print a production-host URL and a very large terminal QR.

Recovery codes are hash-only. Rotation returns ten codes once; recovery consumes one code, requires a new Passkey, rotates the batch, and revokes previous remote sessions. Owner management supports Passkey presence, recovery generation, local enrollment tickets, first-session issuance, device revoke, revoke-all, session revoke-all, trust reset, and management QR issue/status/cancel.

While Owner is running, CLI management commands use versioned NDJSON local IPC with a fixed allowlist. When Owner is stopped, CLI takes the instance lock and runs a short-lived managed runtime. `pnpm db:reset` requires exact `RESET OWNER DATABASE` confirmation and recreates the current schema in one process.

## Acceptance findings and next session entry point

Start with item 1. Do not treat the current implementation as complete until the list is resolved or explicitly waived.

1. **Local origin and bootstrap reference:** replace the payload-bearing URL with a short, single-use bootstrap reference. Add an Owner-to-Relay reference registration/revocation path so Relay can route a reference without requiring `ownerCode` in the URL. Make App origin, WebAuthn RP ID, and Relay URL controlled by validated environment profiles: local defaults to `http://localhost:5173` / `localhost`; production uses the configured HTTPS origin and matching RP ID. Do not accept origin or RP ID from QR contents or client requests.
2. **Terminal and Web UI QR size:** encode only the short reference in QR output, keep the terminal renderer compact, and cap the Web UI QR display size. Full public keys, owner code, grant, and other identity material must not be placed in URLs, QR data, or ordinary logs.
3. **Reference protocol seam:** extend protocol, Relay router, Owner connector, and App admission with a `bootstrap_reference` flow. Reference issuance, replacement, cancel, expiry, restart, trust reset, replay, client-key binding, and successful one-time consumption need focused tests.
4. **Windows IPC:** implement and verify same-user ACLs for the Windows named pipe.
5. **Ordinary management QR:** complete the request-reference consumption flow after the current issue/status/cancel management surface; it must not create a session by itself and must remain separate from first-session bootstrap.
6. **Live acceptance:** the user must run `pnpm dev`, `pnpm server`, and `pnpm relay` and verify browser, Relay, QR, paired resume, revoke, trust reset, and restart behavior.
7. **App baseline:** `pnpm --filter @codex-web/app test` currently has eight failures in `use-workspace-sidebar-controller.test.tsx`; these are outside the Owner remote-access files and should be triaged separately before claiming the full App suite is green.

Automated verification currently passing includes the server suite (114 tests after the auth-domain database tests), repository typecheck, focused protocol/Relay checks, formatting checks, and `git diff --check`. Manual browser and live Relay acceptance remains to be performed by the user.
