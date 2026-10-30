# API boundary

Owner control uses the authenticated Owner WebSocket protocol. Public admission methods are first-session redemption, remote Passkey challenge/verify, and recovery reserve/finish. Authenticated methods cover workspace operations and Owner management projections.

WebAuthn origins are profile-controlled: local defaults to `http://localhost:5173` / RP ID `localhost`; production uses the validated `CODEX_APP_ORIGIN` and matching `CODEX_APP_RP_ID`. Relay only routes opaque E2EE traffic and short-lived bootstrap references.

First-session grants and ordinary request references are single-use and expire after five minutes. Session tokens are returned once, stored server-side as hashes, and checked against device revocation, trust epoch, and TTL.

The local CLI uses a versioned NDJSON IPC endpoint with a 64 KiB frame limit and a fixed management allowlist. The Owner process remains the sole database writer.
