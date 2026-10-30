# M0 · IPC Permission Primitive

## Mission

Build and test the OS-protected local IPC primitive that later lets CLI commands execute inside the running Owner without starting a second runtime.

## Read first

- `AGENTS.md`, `PROJECT.md`, `00-contracts.md`
- `packages/server/src/owner/instance-lock.ts`
- `packages/server/src/owner/cli-runtime.ts`
- `packages/server/src/owner/cli.ts`
- existing instance-lock and CLI tests

## Scope and allowed paths

- Add the shared IPC endpoint/framing/permission adapter under `packages/server/src/owner/`.
- Update only the directly related instance-lock/IPC tests and package exports/scripts required to exercise it.
- Do not implement authentication methods, database schema, QR behavior, or CLI command UX in this package.

## Required behavior

- Windows uses a named pipe; macOS/Linux uses a Unix domain socket.
- Endpoint identity is derived from canonical data-root, but secrets never appear in the endpoint name.
- Same OS user succeeds; a different OS user is denied. Unix socket mode is `0600`; Windows uses an ACL/security descriptor that proves the boundary.
- Use `node:net`; newline-delimited UTF-8 JSON, one request/response per line, max 64 KiB each, request ID correlation, version `1`, unknown-key/command rejection, malformed-client close.
- Add an Owner-ready handshake and five-second retry contract for startup races. The primitive must not take the data-root lock.

## Dependencies and seam

M1 may design persistence in parallel. M4 consumes the endpoint/client API and retry semantics. Do not invent an application command list; M4 owns the allowlist.

## Validation

- Focused IPC and instance-lock tests.
- Same-user and different-user manual check on Windows; Unix permission check where available.
- `pnpm typecheck`.
- `pnpm exec oxfmt --check <touched TypeScript files>`.
- `git diff --check`.

## Handoff

Report the endpoint API, frame schema, ACL evidence, retry behavior, test commands/results, and any platform limitation. If Windows defaults cannot prove same-user access, mark M0 blocked before M4 starts; do not weaken the boundary.
