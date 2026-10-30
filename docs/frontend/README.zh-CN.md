# Frontend boundary

The login screen first attempts paired-session restore, then accepts first-session QR, image, camera, or manual URL input. It conditionally offers remote Passkey or recovery login based on the Owner security projection. It never asks for email, password, or TOTP.

Native Owner DTOs flow through the runtime reducer into presentation models. Management shows local and remote Passkey presence, one-time recovery codes, local enrollment tickets, first-session status, compact reference-only QR output, management request-reference consumption, device revoke, session revoke-all, and trust reset without exposing tokens, hashes, private keys, filesystem paths, or API keys. The Relay endpoint comes from the validated `VITE_CODEX_REMOTE_RELAY_URL` profile and is never accepted from QR contents.
