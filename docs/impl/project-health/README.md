# Project Health and Server Architecture Specification

## Status and startup instruction

- Status: **Verified** (development-time verification completed on 2026-11-25; manual browser acceptance remains pending separately).
- Goal: reorganize the Server's large cross-domain modules around explicit state ownership and deep internal interfaces, close the Owner event subscription record cleanup gap, and prevent the selected module clusters from growing without architectural review.
- This specification supersedes the earlier Server module scope and statuses in this folder. Task 03 (App orchestration) and Task 05 (local quality feedback) remain historical completed work and are not reopened.
- Read this specification and the applicable task package before changing implementation.

## Quality-command timing extension (2026-11-25)

- Status: **Verified** (2026-11-25). The verified Server work above remains complete; this extension adds development tooling only.
- Baseline: current workspace scripts and `docs/testing.md` are authoritative. There is no hosted CI or existing timing gate. Earlier concurrent timing observations are illustrative, not calibration samples. Staged/unstaged diff intent is not inspected.
- Confirmed: cover `lint`, `typecheck`, `test:tools`, `test:core`, and `test`; daily mode reports timing, milestone mode blocks. Keep original commands unchanged and introduce a separate runner, without hooks, CI, new tools or application/protocol changes.
- Confirmed: block when wall time exceeds an absolute ceiling OR exceeds 150% of baseline AND adds at least 5 seconds. Smaller increases report warnings. Underlying command failure always fails and preserves its exit code; report mode only relaxes timing violations.
- Confirmed: commit-ready repository baseline with explicit calibration; never automatically roll a successful measurement into the baseline. Environment mismatch disables timing enforcement and visibly reports that no timing acceptance was established.
- Adopted defaults: `pnpm quality:check` runs `lint`, `typecheck`, `test` once sequentially; `--commands` selects any of the five commands, avoiding redundant core/tool tests already covered by full test. `pnpm quality:report` uses the same runner in report mode. `pnpm quality:calibrate --reason <text>` warms each of the five commands once, then measures three serial successful runs and records the median. Absolute ceilings are explicitly stored as twice the median rounded up to whole seconds, with a minimum of 10 seconds. No automatic retry or background profiling.
- Environment matching uses Node/pnpm versions, OS platform/release/architecture, CPU model/logical count and rounded RAM GiB; command text is recorded for audit, not used to disable detection when scripts change. Reports contain timing/exit/environment metadata, not captured test output or workspace paths.
- Keep a bounded local report history under ignored `.quality/` (latest report and at most 20 dated reports). Calibration requires all samples to succeed before replacing the baseline; failure leaves it intact. Missing/malformed baseline is explicit: missing reports uncalibrated; malformed configuration fails, never silently bypasses the gate. No Git-history comparisons.
- Acceptance: deterministic threshold/mode/environment tests; real child-process success/failure/output tests; calibration success/failure preservation and history bounds; three measured serial samples of all five real commands; final `quality:check`, full tests, typecheck and lint. Update `docs/testing.md` and root maintenance instructions; no browser acceptance is needed for tooling-only work.
- Evidence-based implementation deviation: current lint and its existing architecture-budget fixture panic because locked oxlint requires `oxlint-tsgolint >=7.0.2008` while the workspace resolves `7.0.2001`. Align that existing dev-tool version to the minimum compatible release so required quality checks and baseline calibration can run; do not add a dependency or change lint rules.

## App Server schema refresh extension (2026-11-25)

- Status: **Verified** (2026-11-25). Goal: make the latest stable App Server JSON Schema refresh reproducible through one command without an agent, with a smaller implementation surface.
- Confirmed: each run checks the GitHub latest stable release. Prefer a local Codex CLI whose `--version` matches that release, then a matching CLI cached under `.data/codex/runtime/schema-tools/<version>/<platform>`; otherwise download the official same-version CLI archive, verify its release SHA-256 and executable version, and cache it. Do not inspect the App Server runtime manifest or verify the separate App Server package asset: neither affects schema generation.
- Confirmed: only JSON Schema is generated. Preserve immutable per-version outputs under ignored `docs/vendor/codex-app-server/<version>/`; a local current-version pointer identifies the most recently generated snapshot. Never change the checked-in/reviewed Conversation coverage catalog or imply new members are supported automatically.
- Confirmed: compare latest `ThreadItem`, `ThreadRealtimeItem`, `ServerRequest` and `ServerNotification` members against the reviewed 0.167 catalog and print added/removed members for review. The local schema refresh itself succeeds after a valid artifact is produced; tests remain pinned to the last reviewed catalog.
- Failure contract: latest-release lookup, missing CLI asset/digest, download/hash verification, archive member validation, generator version, schema parse/required files, or publication failure leaves the prior current pointer and any prior version snapshot intact. A new version is published from a staging directory only after validation. Existing same-version snapshots are immutable; identical content is idempotent, differing content fails without overwrite. Use direct file content comparison for local snapshots; do not create per-file checksum manifests.
- Network default: when HTTP(S)_PROXY is configured but Node proxy support is not enabled for the current process, the command wrapper restarts itself once with `NODE_USE_ENV_PROXY=1`; without configured proxy it uses the normal fetch path. This is needed for the 100+ MB official CLI archive on managed desktops and avoids shell-specific download tools.
- `pnpm schema:update` is the single user-facing command. Do not add runtime or third-party dependencies, mutate the App Server manifest, modify source adapter coverage, download the App Server package again, or update vendor Markdown docs.
- Validation: unit tests inject release data, downloads, process execution and temporary directories to cover reuse/download/verification/idempotency/failure/diff paths; run focused script tests, `pnpm test:tools`, `pnpm typecheck`, `pnpm lint`, touched-file formatting and existing schema coverage tests. Finally run the real command against the latest stable release and confirm the App Server manifest stays untouched.
- Simplification result: removed the no-op App Server manifest/asset checks and the per-file generated schema hash manifest. Existing snapshot equality now compares file paths and bytes directly; CLI download/cache SHA-256 verification remains. The script still validates JSON bundles and message unions before publication.
- Final simplification verification: production updater files are now about 595 lines including the command wrapper, down from 630; tests are about 360 lines. The local 0.172.0 snapshot metadata was rewritten without per-file hashes, while schema contents remained unchanged. `pnpm schema:update` reused the cached CLI and snapshot, reported the same coverage delta, and did not inspect or modify the App Server manifest.
- `pnpm quality:check` passed after simplification (lint 1.34s, typecheck 1.36s, full test 16.49s); all nine focused schema-refresh tests, 21 tooling tests, touched-file formatting and direct oxlint passed.
- Final implementation result: the updater still reads the GitHub stable release and its Codex CLI asset, but no longer inspects the App Server manifest or requires the separate App Server package asset. Snapshot metadata stores version/tag/generator provenance only. For 0.172.0, the generator cache remains at about 417 MB, the existing 0.172.0 Server runtime is untouched, and the local coverage delta remains three new `ThreadRealtimeItem` members plus `thread/search/partial`; 0.167.0 remains the reviewed baseline.
- Verification after simplification: pending final focused tests, lint, formatting, and `pnpm quality:check`.

### Implemented timing gate and verification

- `scripts/quality-timing.mjs` implements report, milestone check and explicit calibration modes. The original quality scripts are unchanged. `quality:check` serially runs `lint`, `typecheck` and full `test`; `quality:report` can select and report any of the five measured commands, including `test:tools` and `test:core`.
- `quality/timing-baseline.json` records same-machine calibration with one warmup and three serial successful samples per command. Medians and absolute limits are lint 1.271s/10s, typecheck 1.367s/10s, test:tools 4.456s/10s, test:core 7.632s/16s and test 15.589s/32s. Baseline environment: Node 24.19.0, pnpm 12.4.1, Windows 10.0.22631, x64, 12th Gen Intel Core i7-12700H, 20 logical CPUs, 32 GiB RAM.
- The required lint repair was only a compatible update of the existing `oxlint-tsgolint` dev dependency from `7.0.2001` to `7.0.2008`; oxlint remains in its original declared `^1.82.0` range and resolves to 1.95.0. No new dependency or lint rule was added.
- `pnpm quality:check` passed after calibration: lint 1.42s, typecheck 1.39s and full test 15.95s, no timing regression. `pnpm lint:architecture`, focused quality-timing tests (8) and final full suite/tool tests (12 tooling tests) passed. The check also includes all package tests and typecheck. Touched-script `oxfmt --check` passed.
- Timing tests cover command allowlisting, strict relative/absolute threshold edges, environment comparison, required calibration reason, child-process elapsed time and exit-code preservation, failed atomic baseline replacement, and the 20-report retention bound.
- Failures observed before calibration: lint and the existing architecture test could not run because the tsgolint peer version was below oxlint's declared minimum. Updating the existing development tool to that minimum resolved both failures; final checks then passed.

## Baseline and verified facts

- This section records the pre-refactor baseline; the implemented result and final validation are recorded below.
- The current workspace source is the implementation baseline. Staged/unstaged diff intent was not inspected or inferred.
- `owner/application-services.ts` combines Owner authentication, device administration, workspace/settings, Codex lifecycle, Skills, Thread/Conversation and event operations. `owner/runtime.ts` already composes a shared registry/resume/device authorization/local management facade; WebSocket and Relay share the registry, while IPC receives local management only.
- `codex/manager.ts`, `codex/runtime-manager.ts`, `codex/conversation-adapter.ts`, `remote/connector.ts`, and `owner/session-runtime.ts` each combine several related but distinct responsibilities. `turn-scheduler.ts`, `event-services.ts`, `auth-domain.ts`, and `device-management.ts` are existing internal seams to preserve and deepen where useful.
- The Owner request frame currently carries an open string method and unknown params/result. Owner and Relay wire parsers, Owner error DTOs, event cursor/reset behavior, runtime manifest, SQLite schema, and remote trust file are current contracts.
- `event-services.ts` stores resumable subscription records in a process-local Map with TTL. Expiration is checked on access/resume; abandoned expired records have no general cleanup path.
- `CodexBridge` is declared in `http/types.ts` and marks several capabilities optional. Owner callers use different fallback behaviors when a capability is absent.
- `.oxlintrc.json` has no line-count rule. Production Server files over 450 physical lines are the selected review targets; this number is a module budget, not a universal source-quality metric.

## Decisions and invariants

| Decision | Status | Constraint |
|---|---|---|
| Keep Owner runtime and method registry as the composition seam | Confirmed | Migrate implementation behind it; remove replaced aggregation paths after cutover. |
| Include Owner, Codex/runtime, Relay connector and Owner session runtime | Confirmed | Preserve each existing public facade and observable behavior. |
| Preserve Owner/Relay wire shapes, method names, error codes, auth policy, SQLite/trust-store formats and App Server semantics | Confirmed | No compatibility aliases or parallel wire implementation. |
| Define the Owner-facing Codex port in a Server-owned Codex/Owner integration module | Recommended default | Required capabilities are required members; temporary unavailability is represented by existing errors/results. Optional members require a real supported capability variant. |
| Add a targeted 450 physical-line budget for selected Server module clusters | Confirmed | Check production `.ts` files only in the selected clusters and their extracted child directories. Exemptions name the file, larger ceiling and cohesion rationale. |
| Run architecture budget through `pnpm lint` | Confirmed | Keep `pnpm lint:architecture` as a focused command; do not change `lint:staged` responsibilities. |
| Keep cross-store device state in its current files | Confirmed | Preserve fail-closed compensation and idempotent retry; no storage migration or trust-state merge. |

Invariants:

- Local Owner admission still requires verified loopback peer, exact local Host and Origin and remains connection-scoped in memory.
- Remote Owner access still requires E2EE device binding and a valid Owner session. Relay never authorizes Owner business operations.
- Thread and Project ownership checks, controlled-root checks, credential secrecy, request limits and public error projection remain intact.
- Snapshot/watermark/history reconciliation and event cursor/gap/reset/resume semantics remain intact.
- A single Thread remains serialized; distinct Threads retain current concurrency. Cancellation/timeout semantics must not claim the underlying App Server operation stopped unless it did.
- Every mutable state collection has one authoritative owner. No mirror Maps, service locators, global mutable registries, bidirectional manager callbacks, or forwarding-only modules.

## Target module boundaries

- **Owner application:** `owner/runtime.ts` composes domain modules behind the existing method registry. Separate cohesive Owner use cases (at minimum conversation/thread, workspace/settings, Codex lifecycle, remote administration, and authentication where ownership remains clear). Keep event cursor/stream lifecycle together. Keep Conversation snapshot/history reconciliation together. Authorization guards remain centralized.
- **Codex manager:** preserve `CodexManager` as facade. `TurnScheduler` remains the only owner of queued/active task scopes. State audit decides whether process/lifecycle and pending App Server Interaction state each form a stable internal module; otherwise keep cohesive state together and document its budget exemption.
- **Codex runtime manager:** preserve its facade while separating release discovery, manifest/installation integrity, activation/rollback and smoke verification only where a narrow cohesive interface results. The runtime manager remains sole owner of manifest transitions.
- **Remote connector:** preserve `OwnerConnector` and its public methods. Separate Relay socket/reconnect/heartbeat from admitted client handshake/E2EE session lifecycle only where each resulting module owns its state and shutdown behavior.
- **Owner session runtime:** preserve `OwnerSessionRuntime` behavior. Keep request admission, cancellation/timeout, stream lifecycle, ordered frame delivery and backpressure state single-owned; extract only internal modules that reduce the interface callers must understand.
- **Codex port:** relocate and tighten the Owner-facing port. Make capabilities required when production semantics depend on them; model actual optional capabilities explicitly. Remove silent direct-run/empty-result fallbacks that hide missing required functionality.
- **Subscription records:** keep Owner/session binding and resumability. Expired record cleanup must not close a still-active stream or remove a live recovery record before its TTL. Bound record count and deterministically evict only expired entries; when no expired record can be removed, reject new records with a stable existing Owner capacity error or add one only if no suitable current error exists, without changing normal traffic.

## Growth guard

- `.oxlintrc.architecture.json` is the sole budget definition. Installed oxlint supports `max-lines`; reuse that rule rather than creating a second line-counting script. This is an evidence-based implementation refinement of the original custom-checker proposal.
- Enforce 450 physical lines, including comments and blank lines, for the exact facade files and recursive Owner application/session and Codex process/runtime directories named in that config. New files in these directories inherit the rule. Tests, fixtures and generated files are excluded. No exemptions are currently needed.
- Existing composition facades remain because production callers use them. `application-services.ts` contains dependency assembly only; new business implementation goes into its domain module. State ownership and module-placement rules are maintained in `packages/server/AGENTS.md`.
- Exceptions require an exact-path finite budget, a cohesion rationale and an update to this specification; no wildcard exemptions or inline budget suppression.
- Root oxlint config inherits the architecture config, so existing `pnpm lint` enforces it. `pnpm lint:architecture` is the focused entry. `lint:staged` retains its implementation and warning-baseline behavior and sees inherited error rules through the root config.
- Behavioral tooling fixtures run real oxlint against an at-budget file, oversized facade/new nested files, excluded tests/fixtures and unrelated code, then verify root config inheritance. They do not inspect production source text or reimplement the rule.

## Scope and compatibility

- In scope: Owner application decomposition, Codex dependency port, Codex Manager/runtime boundaries, Relay connector and Owner session runtime boundaries, Owner event subscription record cleanup, focused behavior tests, targeted architecture budget, and active `project-health` specification/task packages.
- Out of scope: App/Relay package refactors, product features, Owner or Relay wire changes, database/trust file migrations, auth model changes, dependency additions, tRPC, generic line limits across the repository, CI platform work, and rewriting archived implementation history.
- Existing facades stay as adapters for current production callers. Temporary adapters are allowed only within a single migration milestone and must be removed before its acceptance criteria pass.

## Implementation milestones

1. **Owner application and Codex port:** split Owner use cases behind the current registry, tighten required Codex capabilities, preserve context/authorization and method DTOs.
2. **Codex process and runtime:** audit state, then extract only stable lifecycle/Interaction/runtime responsibilities; preserve Manager/runtime facades and TurnScheduler ownership.
3. **Relay and Owner session:** audit state/close order, then split connector/session internals without changing frame order, E2EE, admission, backpressure or close behavior.
4. **Subscription lifecycle:** reclaim expired records, bound capacity and cover cancellation/recovery behavior.
5. **Architecture budget and reconciliation:** add targeted budget checker, integrate lint, remove obsolete implementations and complete full validation.

Each milestone depends on the specification and existing behavior tests. Milestones 2 and 3 may proceed after milestone 1 type/contracts are stable; milestone 4 is independently testable. Budget enforcement lands after module moves and applies to their final layout.

## Acceptance and validation

- Public Owner and Relay methods, frame/event schemas, auth decisions, errors, persistence formats and product behavior match the baseline.
- Every extracted mutable state has one owner and one cleanup path; lifecycle/state audit documents start, success, failure, cancellation, timeout, reconnect and shutdown transitions.
- Owner method dispatch contains no catch-all domain implementation; each domain module has a narrow explicit dependency object and tests through its interface.
- Owner-facing Codex callers cannot silently lose required scheduling, model, readiness, snapshot/history or interaction capabilities because an optional property is absent.
- Expired subscription records are reclaimed; active streams survive record cleanup rules; resume is allowed within TTL and rejected after TTL; capacity is bounded.
- Device issue/redeem/revoke behavior remains fail-closed, compensates partial writes, disconnects access on incomplete revocation, and supports idempotent retry without migration.
- All budgeted production modules meet 450 physical lines or have an exact documented exemption; `pnpm lint` includes the check.
- Per milestone run focused Server tests, `pnpm typecheck`, and touched-file `pnpm exec oxfmt --check`. At completion run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and the focused architecture checker. `pnpm lint:staged` applies only when intended files are staged per repository rules.
- Because Codex startup, authentication, Thread/Turn and Relay/session lifecycle internals are touched, report manual browser regression as post-implementation user acceptance; it does not replace automated checks.

## Task packages

1. [Task 01: Owner application and Codex port](./01-owner-application-services.md)
2. [Task 02: Codex Manager and runtime](./02-codex-manager-boundaries.md)
3. [Task 06: Remote connector and Owner session runtime](./06-remote-session-boundaries.md)
4. [Task 07: Subscription lifecycle and architecture budgets](./07-lifecycle-and-architecture-budget.md)

Tasks 01, 02 and 06 contain the module refactors. Task 07 integrates lifecycle cleanup and budget enforcement after the target module layout is established. Tasks 04 and 05 in this folder remain completed prior health/quality work and are not re-run except for final checks listed above.

## Implemented result (2026-11-25)

- Owner application extraction, required Codex port, Codex process/events/startup and runtime release/package/smoke decomposition are implemented.
- RemoteClientSessions now exclusively owns handshake/session Maps, E2EE sequences, pending close ordering and revocation revision. OwnerConnector retains Relay socket/reconnect/heartbeat and invitation routing.
- OwnerSessionRuntime retains admission/request/stream coordination; virtual transport, contracts, abort/error utilities and ordered sender are separate internal modules.
- Subscription expiry uses one unref'ed timer, ten-minute TTL and 2,048-record capacity. It reuses the existing retryable `owner.request.limit-exceeded` error; valid recovery records are never evicted to admit a new one. A wrong-session resume cannot destroy the correct session's record. TTL/capacity are rechecked after asynchronous cursor checks.
- Existing device lifecycle implementation remains unchanged. Its tests now additionally verify trust-file failure after application revocation, forced disconnection and idempotent retry.
- Startup completion now awaits runtime manifest bookkeeping. A deterministic gated regression protects against the detached write racing shutdown or temporary-directory cleanup; runtime policy and manifest format are unchanged.
- All five milestones are complete. Moved implementations were removed from their original facades; no temporary compatibility implementation or mirrored state remains.

### Final module layout and budgets

| Existing facade | Physical lines | Internal implementation and state ownership |
|---|---:|---|
| `owner/application-services.ts` | 97 | Dependency assembly; seven modules under `owner/application/` own authentication/administration, workspace, Codex, Threads, Conversation read/commands and validation. |
| `codex/manager.ts` | 382 | Process identity/lifecycle and loaded Threads; `process/events.ts` owns notification-derived activity and pending Interactions, `process/startup.ts` owns bootstrap. Existing TurnScheduler retains task queues. |
| `codex/runtime-manager.ts` | 390 | Sole runtime manifest owner; `runtime/release.ts`, `package.ts` and `smoke.ts` handle release I/O, archive integrity and process checks. |
| `remote/connector.ts` | 406 | Relay connection lifecycle and enrollment routing; `remote/sessions/index.ts` owns client handshake/E2EE/session state. |
| `owner/session-runtime.ts` | 444 | Admission/request/stream coordination; `owner/session/` contains contracts, virtual transport, ordered sender and request utilities. |

The 450-line rule includes comments and blank lines and covers the configured extracted directories recursively. No exemptions were required. These measurements describe placement and growth headroom, not module quality or a reduction in total source size.

### Development-time verification

- `pnpm test`: passed. Server 170, App 272 across 48 files, Protocol 26, Relay 27, Conversation 8, Telemetry 14, tooling 4; zero failures.
- Focused Owner/Thread, Manager/runtime, Conversation delivery, Remote/session, device and event lifecycle checks passed. New regressions cover subscription expiry/capacity/session binding, cross-store revoke failure/retry, startup bookkeeping completion and archive integrity/traversal/link rejection.
- `pnpm typecheck`, `pnpm lint`, `pnpm lint:architecture`, and touched-TypeScript `pnpm exec oxfmt --check`: passed.
- `pnpm --filter @codex-web/app themes:check`: passed for all 42 themes.
- `pnpm lint:staged` and `pnpm quality:check` passed against the current staged milestone before commit.

### User acceptance

- The user completed manual browser acceptance on 2026-11-25. These flows are user-verified separately from the automated checks above.
- No remaining implementation blocker or deferred cleanup task.
