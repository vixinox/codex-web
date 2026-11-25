# Task 02: Codex Manager and runtime

## Status and dependency

- Status: **Verified** (2026-11-25).
- Source of truth: [Project Health specification](./README.md).
- Task 01 establishes the Owner-facing Codex port before its implementation is moved.

## Goal

Reduce coupling inside Codex process management and runtime acquisition while keeping the existing `CodexManager` and `CodexRuntimeManager` facades and all App Server behavior.

## Pre-refactor entry points and state

- `packages/server/src/codex/manager.ts` owns per-user process promises/clients, lifecycle status, active Turn projection, loaded Threads, stopping markers, pending App Server requests/Interactions, event callbacks and startup/credential switching.
- `packages/server/src/codex/turn-scheduler.ts` is the authoritative owner of queued tasks, active tasks and active scopes. Do not duplicate its Maps in Manager or extracted modules.
- `packages/server/src/codex/runtime-manager.ts` owns manifest reading/writing, release lookup, package verification, installation, activation/rollback and App Server smoke verification.
- `packages/server/src/codex/conversation-adapter.ts`, `event-hub.ts`, `event-store.ts` already own conversion and event persistence/delivery responsibilities; do not create competing paths.

## Required state audit

The audit below was completed before extraction and determines ownership of process promises/clients, lifecycle state, active Turn projection, loaded Threads, stopping state, pending Interactions, runtime manifest transitions and temporary acquisition resources. The existing behavior tests exercise startup/failure/restart, credential changes, Turn completion/cancel, Interaction response/expiry, process exit and shutdown.

## Implementation decisions

### State audit and selected seams (2026-11-25)

| State | Authoritative owner and transitions | Cleanup |
|---|---|---|
| Process promises, active clients, lifecycle status, loaded threads, stopping markers | Manager; get/start/restart selects one process per user, ready installs client, stop invalidates slot before awaiting startup | Stop/process exit; callbacks retain client identity checks |
| Queued tasks and active scopes | Existing TurnScheduler; queue to active to settled | Timeout/cancel/stop/shutdown settle tasks without claiming Codex Turn termination |
| Active Turn notification projection and pending Interactions | Process-event module; receives events/requests from a specific user/client, maps to Conversation changes, resolves original RPC IDs | Turn terminal cancels its requests; client exit/stop expires its requests and clears activity |
| Manifest and active/candidate/previous entries | RuntimeManager only; check/install/activate/rollback mutate existing manifest | Installer staging cleanup in finally; manifest retained across restarts |
| Release HTTP and archive integrity operations | Stateless/internal release and package modules, called by RuntimeManager | Download streams/timers and temporary smoke home cleaned by their own operation |

Process-event callbacks do not own process lifecycle or scheduling. Manager forwards the existing notification-driven projection through that module, so no activity Map is mirrored. Process bootstrap accepts the real transport adapter and callback wiring; it does not own a second client registry. Runtime package/discovery helpers never retain manifest state.

- Keep `CodexManager` as the Owner-facing facade and preserve its current methods and observable status behavior.
- `TurnScheduler` remains sole owner of task queue and scope serialization.
- Extract process lifecycle or Interaction registry only if the audit shows a stable ownership boundary and a narrow one-way interface. If two states require coordinated atomic updates, keep them under one owner and record a targeted line-budget exemption instead of introducing synchronized managers.
- Keep event conversion in `conversation-adapter.ts`; Manager may delegate to it but must not duplicate mapping logic.
- Keep `CodexRuntimeManager` as facade and sole owner of manifest state transitions. Separate discovery, package installation/integrity and smoke verification only when the resulting internal interfaces reduce caller knowledge and preserve transaction ordering.
- Preserve candidate/active/previous runtime behavior, checksum and smoke verification, offline fallback, activation/rollback and startup fail-closed behavior.
- Remove moved implementations from the facade files. Do not retain parallel old and new state paths.

## Acceptance and validation

Implementation finding (2026-11-25): full-suite cleanup exposed an unawaited `runtime.markRestarted()` manifest operation racing Manager shutdown and temporary-directory removal. Startup/restart completion must await this operation instead of leaving filesystem work detached; this tightens lifecycle completion without changing RPC or runtime policy.

- One owner per state collection; shutdown and failed-start cleanup cover every owned process, request, timer and queued task.
- Preserve same-Thread Turn serialization, cross-Thread concurrency, cancellation semantics, Interaction correlation and terminal outcomes.
- Preserve credential changes, runtime candidate activation/rollback, offline use of a verified active runtime, and startup protocol verification.
- No App Server protocol or runtime manifest compatibility changes.
- Run focused `manager.test.ts` (including TurnScheduler behavior), `runtime-manager.test.ts`, `conversation-delivery.test.ts`, and any moved-state focused tests; then `pnpm typecheck` and touched-file `oxfmt --check`.

## Non-goals

No App Server behavior/version change, task quota, concurrency policy change, persistence migration, new runtime update policy, or public API expansion.

## Implemented result and verification

- Manager is 382 lines and retains process/lifecycle ownership. `process/events.ts` owns pending Interactions and notification-derived active Turns; `process/startup.ts` performs configuration, callback installation and authenticated initialization. TurnScheduler remains unchanged as the sole queue owner.
- RuntimeManager is 390 lines and retains all manifest transitions. `runtime/release.ts`, `runtime/package.ts` and `runtime/smoke.ts` own release I/O, validated archive operations and smoke subprocess checks, respectively. No helper retains a second manifest.
- The startup bookkeeping race described above is fixed by awaiting `markRestarted()`. A deterministic gated Manager regression proves startup cannot resolve before bookkeeping finishes. Synthetic archive tests cover required files, tamper detection, traversal and link rejection without network or real runtime installation.
- Focused Manager tests (14), archive tests (2), runtime/Conversation checks and full `pnpm test` passed; `pnpm typecheck`, touched-file `oxfmt --check`, `pnpm lint` and `pnpm lint:architecture` passed. No budget exemptions were needed. Manual runtime/browser acceptance is recorded separately in the main specification.
