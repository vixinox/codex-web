# Remote access acceptance findings

Updated: 2026-10-30

The implementation findings from the previous acceptance pass are resolved. The user can now begin live acceptance after running the documented services.

## Resolved implementation findings

1. **Bootstrap URL and origin profile**

   Startup now uses the validated `CODEX_APP_ORIGIN`, `CODEX_APP_RP_ID`, and `CODEX_REMOTE_RELAY_URL` profiles. Development defaults to `http://localhost:5173` / `localhost`; production requires an HTTPS origin and matching RP ID. The public URL is `/app/first-session?ref=...` and no longer carries Relay URL, owner code, grant, JWK, fingerprint, node identity, or other identity material.

2. **Reference-only Relay routing**

   Owner registers the active reference after Relay readiness. Relay keeps an in-memory `reference → nodeId` mapping and removes it on replacement, cancellation, expiry, successful consumption, trust reset, disconnect, shutdown, and restart. The client uses `bootstrap_reference`; Owner performs the protected atomic validation and one-time consumption.

3. **Terminal and Web UI QR size**

   Terminal and Web UI QR output encode only the short reference. The Web UI display is capped at a compact size.

4. **Ordinary management QR**

   Management QR now carries only a short request reference. The authenticated `remote.loginQr.consume` operation is wired through the Owner service and App client, consumes the reference once, and does not create a session. It remains separate from first-session bootstrap.

5. **App baseline**

   The eight sidebar controller failures were fixed by preserving an explicit `projectId: null` for root-thread list requests. The full App test suite is green.

6. **First-session deep-link redemption**

   Opening a valid `/app/first-session?ref=...` URL now automatically redeems the one-time bootstrap reference and navigates to the workspace. The generic login page remains available as a fallback for local Passkey and remote credential-based login.

7. **Windows IPC scope**

   Custom same-user named-pipe ACL hardening is accepted as out of scope for the current single-user deployment model. The product keeps local-only IPC, a fixed command allowlist, strict request validation, and the Owner runtime boundary. Shared multi-user Windows hosts are outside the supported deployment boundary.

8. **First-session loading state under React development mode**

   The first-session route previously used a query-string ref to suppress duplicate effects. In React StrictMode, the first effect was cleaned up before its redemption completed and the replayed effect skipped the request, leaving the page permanently at `Connecting to Owner`. The route now relies on the reference-keyed single-flight redemption and lets the active effect publish the result. The App suite remains green after this change.

9. **Promoted first-session response could race its close frame**

   After creating the first remote device, the Owner promoted the transport and closed it immediately. E2EE response encryption and the close frame were independent asynchronous operations, so the browser could observe `Owner connection closed` before resolving `owner.firstSession.redeem`, even though the device and session had already been created. Remote encrypted sends are now serialized per connection and the promoted response is flushed before the close notification.

10. **Trust reset used an invalid WebSocket close code**

    Trust reset and Owner-code rotation used close code `1012`, which the active WebSocket API rejects as an invalid application close code. Both reconnect paths now use the valid normal close code `1000`; the application-level reason remains available in the encrypted/Relay close flow.

## Remaining live acceptance

The user should run:

```text
pnpm dev
pnpm server
pnpm relay
```

For a genuinely clean first-session run, reset the remote trust state when a previous device has already been paired; `pnpm db:reset` preserves `remote-trust.json` and does not by itself make first-session bootstrap claimable again. Then verify a clean bootstrap, direct first-session deep-link redemption without the generic login screen, QR scan/upload, first-session one-time consumption, paired resume, individual and all-device revoke, trust reset, Owner/Relay restart, reference expiry/replacement/cancel, and the local/remote WebAuthn origin separation.

When diagnosing a live attempt, the Server logs Relay owner/client admission, E2EE handshake, first-session RPC, and rejection reason without printing references, tokens, or key material. The Relay logs attach acceptance/rejection and bootstrap reference registration. Restart `pnpm relay`, `pnpm server`, and `pnpm dev` after source or Vite environment changes so these diagnostics and browser-side `VITE_*` values are active.

Automated checks to rerun before live acceptance:

```text
pnpm --filter @codex-web/protocol test
pnpm --filter @codex-web/relay test
pnpm --filter @codex-web/server test
pnpm --filter @codex-web/app test
pnpm typecheck
```
