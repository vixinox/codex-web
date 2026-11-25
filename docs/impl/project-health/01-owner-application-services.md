# Task 01: Owner application and Codex port

## Status and dependency

- Status: **Verified** (2026-11-25).
- Source of truth: [Project Health specification](./README.md).
- Scope: Server Owner application internals and the Owner-facing Codex dependency contract. Preserve the current runtime, registry and transport entry points.

## Goal

Make Owner use cases locally maintainable behind narrow domain modules and make required Codex capabilities explicit at compile time, without changing Owner methods, DTOs, errors, authorization or user behavior.

## Pre-refactor entry points

- `packages/server/src/owner/application-services.ts` creates domain dependencies and implements Owner methods in one large factory.
- `packages/server/src/owner/runtime.ts` composes Owner application services into the registry, session resume, device authorization and local management facade.
- `packages/server/src/owner/methods.ts` explicitly maps Owner wire methods to domain operations.
- `packages/server/src/owner/event-services.ts`, `auth-domain.ts`, `device-management.ts`, and `skill-selection.ts` already own cohesive behavior and should be reused rather than duplicated.
- `packages/server/src/http/types.ts` currently owns `CodexBridge`, although Owner and Thread modules consume it.

## Implementation decisions

- Keep `createOwnerApplicationServices()` as the composition seam, the existing Owner runtime facade, and `methods.ts` as the explicit wire registry.
- Move domain implementations into cohesive modules for conversation/thread read and commands, workspace/settings and credentials, Codex lifecycle/configuration/skills, and remote Owner administration. Keep authentication/device modules where they are unless extraction demonstrates a concrete ownership improvement.
- Each module receives an explicit narrow dependency object and an Owner method context. Do not pass the whole `AppDependencies` object into each module.
- Keep `threadsRead` snapshot/history reconciliation and `eventsSubscribe/resume` cursor/replay behavior internally cohesive. Do not split snapshot, history and watermark truth across modules.
- Define the Owner-facing Codex port within the Server Codex/Owner integration, not under HTTP types. Require every capability whose absence changes correctness; represent runtime unavailability with existing errors/results. Keep optional capabilities only when production adapters intentionally differ.
- Remove the old `application-services.ts` implementation after all registry and IPC call sites have moved. Retain only a small composition module if it remains useful; no duplicate legacy path.

## Invariants and failure behavior

- `requireOwner` and local transport checks remain the authoritative authorization guards; do not copy them into domain modules.
- Thread read/mutation and project path ownership checks remain in `ThreadDomain` and execute before App Server mutations.
- Conversation commands preserve current serialization, cancellation, error projection and Interaction response behavior.
- Credential selection/delete and Codex restart behavior remain unchanged.
- No arbitrary raw Codex RPC is exposed to the browser; no new access to secrets or internal objects is introduced.

## Acceptance and validation

- Owner wire method names, params/results, public errors and IPC command surface are unchanged.
- Required Codex behavior no longer depends on optional-property fallbacks or direct execution when queue scheduling is missing.
- Domain modules have explicit small dependency objects; no service locator, circular imports or forwarding-only modules.
- Existing Owner application, auth, device, Thread, Conversation and protocol behavior tests pass; add or revise tests only for uncovered current invariants.
- Run focused Owner/Thread tests, `pnpm typecheck`, and `pnpm exec oxfmt --check <touched-ts-files>`.

## Non-goals

No tRPC, wire contract change, persistence migration, auth redesign, App package refactor or generic service layer.

## Implemented result and verification

- `application-services.ts` is a 97-line dependency composition module. Implementation moved to `application/authentication.ts`, `workspace.ts`, `codex.ts`, `threads.ts`, `conversation-read.ts`, `conversation-commands.ts` and `validation.ts`; existing auth/device/Thread/event modules are reused.
- `codex/owner-port.ts` defines required Owner-facing capabilities; `CodexManager` explicitly implements that port. The HTTP-owned `CodexBridge` and silent missing-capability/direct-run fallbacks were removed. Stopped runtime behavior uses existing errors.
- Conversation snapshot/history/watermark reconciliation remains together; command scheduling, authorization and Interaction semantics remain under the existing authoritative modules.
- Focused Owner/Thread tests, full `pnpm test`, `pnpm typecheck`, touched-file `oxfmt --check`, `pnpm lint` and `pnpm lint:architecture` passed. See the main specification for aggregate results and separate pending browser acceptance.
