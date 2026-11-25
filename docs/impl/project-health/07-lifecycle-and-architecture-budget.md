# Task 07: Subscription lifecycle and architecture budgets

## Status and dependency

- Status: **Verified** (2026-11-25).
- Source of truth: [Project Health specification](./README.md).
- Subscription cleanup can proceed independently. Enforce the final architecture budgets after Tasks 01, 02 and 06 establish the extracted module layout.

## Goal

Reclaim abandoned Owner event subscription records safely and add a targeted architecture-size guard for the selected Server module clusters.

## Subscription lifecycle

- Records in `owner/event-services.ts` are keyed by subscription ID and bind owner, session, scope, optional thread and expiry.
- Add a bounded cleanup strategy that removes expired records during normal subscription activity and prevents unbounded growth during idle periods. Use one timer for the nearest expiry or another equally bounded process-local mechanism; do not create one timer per subscription.
- Preserve the TTL resume window. Cancelling/closing an active stream removes its EventHub listener but does not immediately remove its resumable record.
- A record is resumable only for its bound owner/session and before expiry. Expired records are rejected and removed.
- Enforce a finite maximum record count. Prune expired records before rejecting. When full with no expired entries, reject the new subscription through an existing stable capacity error if available; otherwise add one explicit non-retryable Owner capacity error and update the Owner error parser/tests. Never evict a live recovery record silently.
- Clear the cleanup timer and records when the event service is disposed, if the owning runtime has a disposal path; otherwise use an unref'ed single timer and test that cleanup does not hold process exit open.

## Architecture budget

- Use installed oxlint `max-lines` with `.oxlintrc.architecture.json` inherited by the root config. This replaces the originally proposed custom budget script/manifest.
- Check the explicitly named Owner application/session, Codex Manager/runtime and Remote connector/session production modules, recursively covering extracted implementation directories. Tests, fixtures and generated files are excluded.
- Enforce 450 physical lines including blanks/comments. No exemptions are needed for the completed layout. Future exceptions require an exact path, finite ceiling and cohesion rationale in the specification.
- `pnpm lint:architecture` is the focused check. Existing `pnpm lint` and `lint:staged` inherit the error rule through root configuration; their implementations and warning handling are unchanged.
- Tooling regression executes the real oxlint rule for at-budget production code, oversized existing/new nested modules, exclusions and root inheritance. No duplicate line-count implementation.

## Acceptance and validation

- Tests prove subscription resume before expiry, rejection/removal after expiry, cleanup of abandoned records, no premature deletion on stream cancellation, owner/session binding and capacity behavior.
- Fake clock/timers or injected time dependencies are used; no unbounded polling or real sleep.
- Tooling fixtures prove only configured production paths are measured and violations report path, current lines and budget.
- Run focused event/application tests, `pnpm test:tools`, `pnpm lint:architecture`, `pnpm lint`, `pnpm typecheck`, touched-file `oxfmt --check`, and final `pnpm test`.

## Non-goals

No Redis/background service, persistent subscription storage, changes to event cursor or stream wire shapes, generic repository-wide line limit, or use of LOC as a proxy for quality.

## Implemented result and verification

- Subscription records expire after ten minutes, with a maximum of 2,048. One nearest-expiry unref'ed timer reclaims abandoned records without keeping the process alive. Capacity/expiry are rechecked after asynchronous cursor validation. Active streams survive record expiry, and cancellation retains the resume record until expiry.
- Capacity rejection reuses retryable `REQUEST_LIMIT_EXCEEDED` / `owner.request.limit-exceeded`; no error parser/wire change was needed. Wrong-owner/session resume is rejected without deleting the rightful session's record.
- Three deterministic event lifecycle regressions cover idle expiry/timer behavior, live stream delivery, cancellation/resume, owner/session binding and capacity reclamation. Existing cross-store device behavior is unchanged; a new revoke failure regression proves fail-closed disconnection and idempotent retry after a trust-file write failure.
- Native oxlint configuration and recursive selected paths enforce all budgets through `pnpm lint:architecture` and root inheritance. Real-tool fixtures cover the 450/451-line threshold, new nested files, exclusions and root inheritance. Server maintenance instructions record placement/state rules; no custom LOC checker or exemption was added.
- Event/device focused checks, `pnpm test:tools` (4 tests), `pnpm lint:architecture`, `pnpm lint`, `pnpm typecheck`, touched-file `oxfmt --check` and final `pnpm test` passed. Complete package totals are in the main specification.
