# Agent entry point

## Read by task

- Read `PROJECT.md` when a change may affect architecture, cross-module boundaries, shared protocols, security, persistence, runtime topology, or core responsibilities.
- Read `docs/app-server/` and `docs/vendor/` before changing Codex CLI/App Server behavior, JSON-RPC, authentication, startup, Thread/Turn/SSE semantics, or another protocol contract. Existing frontend consumption of a documented bridge endpoint does not require the protocol archive.
- Do not implement unverified internal formats such as `auth.json` by guesswork.
- Read `docs/api/README.zh-CN.md` for REST/SSE contract changes and `docs/frontend/README.zh-CN.md` for frontend boundary or data-flow changes.

## Current scope

The core product mainline is substantially complete. Guest Page is the only remaining product delivery line.

Guest Page uses a real but isolated Guest runtime. It must remain separate from Better Auth, Owner credentials, Owner `/api/*`, Owner Codex history and backend control APIs. Each fixed 24-hour anonymous lease has a fresh private workspace that starts empty. Guest Agent turns may read, write and execute only inside that workspace under `workspaceWrite`, with no general network access. Guest runtime auto-starts before Fastify listens and fails closed when its dedicated credential or Windows sandbox is not ready; Owner runtime remains explicitly started by the Owner. Do not expand work into unrelated features, architecture, dependencies, or documentation.

## Editing rules

- Keep changes within the requested files and behavior. Preserve unrelated user changes.
- Update `PROJECT.md` only for stable architecture, security boundaries, runtime topology, architecture risks, or hard-to-reverse decisions. Do not record ordinary progress, local implementation details, or routine verification there.
- Do not rely on Git history or Git rollback. The sole exception is `pnpm lint:staged`: it compares the Git index with `HEAD` to report only warnings newly introduced by the intended staged changes.
- When searching source, exclude `.data/**` and `docs/vendor/**`.
- Use `oxfmt` for TypeScript; Prettier is not used.
- `pnpm lint` intentionally suppresses the existing warning baseline. Before a change is committed, stage its intended files and run `pnpm lint:staged`; it exits nonzero for staged errors or warnings not present in `HEAD`.
- Pin every shadcn CLI command to `shadcn@4.16.0`.
- Services are user-operated. Do not start, stop, restart, terminate, or take over Vite, Fastify, databases, preview servers, or test harnesses unless the user explicitly requests process management. Use only Vite `5173` and Fastify `3000` when authorized.
- Always use `pnpm` as the package manager (`pnpm install`, `pnpm add`, `pnpm run`, etc.). Do not use `npm`, `yarn`, or `bun` for package management.
- Never invoke a subagent unless explicitly requested by the user.

## Verification

Choose the smallest check that covers the change:

| Change                                                                  | Required checks                                                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| UI, CSS, renderer, or page layout                                       | `pnpm typecheck`, touched-file `oxfmt --check`, manual browser regression                                  |
| Controller, transport, security projection, SSE, or pure frontend logic | focused test when available, `pnpm typecheck`, touched-file `oxfmt --check`                                |
| REST, bridge, persistence, lifecycle, or server behavior                | focused server/bridge test, `pnpm typecheck`, touched-file `oxfmt --check`                                 |
| Codex startup, authentication, Thread, Turn, or SSE runtime             | applicable focused checks, `pnpm typecheck`, and manual browser regression; live test commands are retired |

Frontend automated tests cover transport, security projections, controller state, SSE behavior, and pure logic. Do not add React DOM, renderer, page-flow, Playwright, screenshot, or visual tests unless explicitly requested; UI acceptance uses manual browser regression.

The user operates required services for manual or live verification. Report the required command when a running service is needed.
