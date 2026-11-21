# App Server data capture

Run `pnpm --filter @codex-web/server capture:app-server` from the repository root. The command reads `TEST_BASE_URL`, `TEST_API_KEY`, `TEST_MODEL`, and `TEST_MODEL_REASONING_EFFORT` from the process environment or root `.env`, then uses the verified runtime in `.data/codex/runtime/manifest.json`.

Each run writes `messages.jsonl` and `report.json` under `.data/app-server-captures/<run-id>/`. The JSONL is a local raw protocol record and can contain prompts, model output, and workspace paths. Do not commit or share it without reviewing and redacting content. Authentication request and response bodies are omitted. The capture process uses a fresh `CODEX_HOME` and workspace, and removes the temporary home when it exits.

The collector declines command and file-change approval requests. It answers user-input requests with an empty answer object. A scenario is reported as observed only when its target method appears; prompts cannot guarantee that a model or provider will use a particular tool. Failed and unobserved scenarios remain explicit in the report.
