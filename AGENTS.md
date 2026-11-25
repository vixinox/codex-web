# Agent entry point

## Read by task

- Start with [`README.md`](README.md) for product setup and [`docs/README.md`](docs/README.md) to find the relevant guide.
- Read [`docs/architecture.md`](docs/architecture.md) for changes affecting package boundaries, shared protocols, security, persistence, runtime topology or core responsibilities.
- Read `docs/app-server/` and `docs/vendor/` before changing Codex CLI/App Server behavior, JSON-RPC, authentication, startup, Thread/Turn/SSE semantics or another upstream protocol contract. Existing frontend consumption of a documented bridge endpoint does not require the protocol archive.
- Read [`docs/api/README.zh-CN.md`](docs/api/README.zh-CN.md) for Owner/Relay contract changes, [`docs/frontend/README.zh-CN.md`](docs/frontend/README.zh-CN.md) for frontend boundaries and data flow, and [`docs/testing.md`](docs/testing.md) for tests or validation changes.
- Read applicable scoped instructions such as `packages/server/AGENTS.md` and `packages/app/src/app/chat/AGENTS.md` when editing those areas.
- Do not implement unverified internal formats such as `auth.json` by guesswork.

## Current scope

The product scope is one Owner identity with local-first access and remote control through Relay. Local browser access is authorized only by the server-verified loopback peer, exact local Host, and exact local Origin boundary; it uses a connection-scoped in-memory Owner admission, not a bearer or persisted session. Remote access still requires an Owner-issued one-time enrollment link, a registered device, and a valid device-bound session; a Passkey may reauthenticate a known remote device. Guest runtime, API, lease/quota persistence, and compatibility flows have been removed. Do not reintroduce them.

Do not expand work into unrelated features, architecture, dependencies, or documentation.

## Editing rules

- Keep changes within the requested files and behavior. Preserve unrelated user changes.
- Keep durable, cross-module architecture facts in the appropriate topic documentation; update `docs/architecture.md` only when its system map or package responsibilities change. Do not create a second root architecture summary.
- Do not rely on Git history or Git rollback. The sole exception is `pnpm lint:staged`: it compares the Git index with `HEAD` to report only warnings newly introduced by the intended staged changes.
- When searching source, exclude `.data/**` and `docs/vendor/**`.
- Use `oxfmt` for TypeScript; Prettier is not used.
- `pnpm lint` intentionally suppresses the existing warning baseline. Before a change is committed, stage its intended files and run `pnpm lint:staged`; it exits nonzero for staged errors or warnings not present in `HEAD`.
- Pin every shadcn CLI command to `shadcn@4.21.0`.
- Prefer reusing an already-running Vite, Fastify, database, preview server, or test harness. If no suitable instance is available, the Agent may start the service needed for the task; use only Vite `5173` and Fastify `3000` unless the task requires another documented port. The Agent must stop services it started when the work is complete, while leaving pre-existing user-operated services untouched.
- Always use `pnpm` as the package manager. Do not use `npm`, `yarn`, or `bun` for package management.
- Consider creating commits only when a formal development document or a concrete development plan calls for them. In all other cases, commit only when the user explicitly requests it.
- Before any authorized commit, stage only the intended files, run the applicable focused checks and `pnpm lint:staged`, then commit with a concise message describing the completed milestone. Preserve unrelated existing WIP and do not include it in milestone commits.

## Verification

Choose the smallest check that covers the change:

| Change | Required checks |
| --- | --- |
| UI, CSS, renderer, or page layout | `pnpm typecheck`, touched-file `oxfmt --check`, manual browser regression |
| Controller, transport, security projection, SSE, or pure frontend logic | focused test when available, `pnpm typecheck`, touched-file `oxfmt --check` |
| REST, bridge, persistence, lifecycle, or server behavior | focused server/bridge test, `pnpm typecheck`, touched-file `oxfmt --check` |
| Codex startup, authentication, Thread, Turn, or SSE runtime | applicable focused checks, `pnpm typecheck`, and manual browser regression; live test commands are retired |

Frontend automated tests cover transport, security projections, controller state, SSE behavior, and pure logic. Do not add React DOM, renderer, page-flow, Playwright, screenshot, or visual tests unless explicitly requested; UI acceptance uses manual browser regression. The user operates required services for verification — report the required command when a running service is needed.

New tests must protect a current behavior, boundary, or invariant, prefer pure logic over rendered UI, and be removed or rewritten when the behavior or boundary is removed. Do not add tests only to increase counts, mirror implementation details, or preserve retired `/api/*`, Guest, preview, or compatibility flows. Run the smallest affected package test during iteration; run `pnpm test` before a milestone is considered complete.

- `pnpm quality:report` observes core quality-command duration; `pnpm quality:check` applies the checked-in environment-specific baseline for milestone verification. Recalibrate only with an explicit reason via `pnpm quality:calibrate --reason "<reason>"`; do not roll baselines automatically.
