# Remote access acceptance findings

Updated: 2026-10-30

This is the handoff checklist for the next implementation session. Resolve items in order unless a dependency requires otherwise.

## 1. Bootstrap URL is not local and is too large

After `pnpm db:reset` and `pnpm server`, startup printed a URL beginning with `https://codex.vixinox.com/app/first-session?payload=...`. The local Relay address was embedded in the payload, but the App host was the production host. The payload also contained duplicated JSON JWK material, owner code, node identity, fingerprint, and grant, producing a long URL and oversized terminal QR.

Required fix: add validated `CODEX_APP_ORIGIN`, `CODEX_APP_RP_ID`, and `CODEX_REMOTE_RELAY_URL` profiles; use local defaults `http://localhost:5173` / `localhost` outside production; replace `payload=` with a five-minute single-use bootstrap reference; keep complete identity data inside the protected first-session exchange; make terminal and Web UI QR output encode only the short reference.

## 2. Reference-only routing needs a Relay seam

The current Relay routes login candidates through `ownerCode → nodeId`. A URL containing only `ref` cannot find an Owner with the current protocol. Adding a client admission field without an Owner-to-Relay registration path is incomplete.

Required fix: Owner registers the active bootstrap reference with Relay after listener readiness; Relay stores the reference-to-node mapping in memory only; Owner unregisters it on replacement, cancel, expiry, successful consumption, trust reset, shutdown, and restart; the client attaches with `bootstrap_reference`; Relay routes to the registered Owner; Owner atomically validates owner/node/trust epoch/origin/client key and returns the protected bootstrap response.

Do not put `ownerCode`, grant, JWK JSON, or fingerprint into the public URL merely to avoid implementing this seam.

## 3. Other known gaps

- Windows named pipe same-user ACL is not implemented or verified.
- Ordinary management QR has issue/status/cancel support, but its request-reference consumption path is not fully connected to a management operation.
- `auth-domain` has SQLite coverage for recovery and device/session lifecycle; realistic database-backed WebAuthn assertion/registration coverage remains limited.
- App suite has eight sidebar controller failures unrelated to the Owner remote-access files.
- Browser and live Relay acceptance has not been run.

## Suggested first commands

```text
pnpm --filter @codex-web/protocol test
pnpm --filter @codex-web/relay test
pnpm --filter @codex-web/server test
pnpm typecheck
```

Then implement the reference registration protocol before changing the printed URL format.
