# Owner Device Enrollment Development Specification

## Status and startup instruction

- **Status:** In progress. The target architecture is design-frozen; implementation is integrated and undergoing automated verification. User manual browser acceptance remains.
- **Goal:** Replace user-facing Owner-code, manual fingerprint, recovery-code, and login-QR flows with saved remote connection profiles and one-time device enrollment invitations.
- **Scope:** Owner enrollment lifecycle and admission, Relay reference routing, browser profile storage and session recovery, local/remote route separation, device management, CLI/local recovery, and removal of superseded paths.
- **Baseline:** Current workspace source behavior is authoritative for what exists today. Staged/unstaged diff intent was not considered.
- **Read first:** [`../owner-remote-architecture.md`](../owner-remote-architecture.md), [`../api/README.zh-CN.md`](../api/README.zh-CN.md), [`../frontend/README.zh-CN.md`](../frontend/README.zh-CN.md), [`../current-behavior.md`](../current-behavior.md), then the task packages under [`owner-device-enrollment/`](owner-device-enrollment/).
- **Implementation rule:** This document and its task packages are the implementation contract. Do not extend the legacy flows while migrating. Update this specification first if implementation evidence requires changing a frozen contract.

## Problem and user/system model

The remote browser has two user-visible states:

```text
Known browser:
  saved connection -> restore paired session -> remote Passkey only if re-authentication is needed

Unknown browser:
  open Owner-issued invitation -> bind this browser's key -> save connection -> enter workspace
```

An invitation is the Owner's approval to add a device. It is not a login form field or a request awaiting a second approval. Owner Gateway remains the authority for identity, enrollment, sessions, device revocation, trust epoch, and audit events. Relay routes opaque E2EE traffic and short-lived invitation references; it does not make authorization decisions or persist business/device state.

## Current implementation facts

Verified in the current workspace source:

- `packages/app/src/lib/remote/device-key-store.ts` stores a single current remote device record; there is no multi-profile connection manager.
- `packages/app/src/lib/remote/admission.ts` contains first-session redemption, paired admission, remote Passkey, and recovery-code login. `packages/app/src/app/composition/screens/login-screen.tsx` combines local Passkey and legacy remote login paths.
- `packages/server/src/remote/connector.ts` handles paired, login, first-session, and bootstrap-reference attachments. `packages/relay/src/relay-router.ts` supports reference routing and also retains Owner-code/login-candidate routing.
- `packages/server/src/owner/application-services.ts` and `packages/server/src/owner/methods.ts` expose first-session, recovery, login-QR, Owner-code and device/trust operations. These are existing legacy paths to migrate or remove, not target capabilities.
- `packages/server/src/owner/cli-runtime.ts`, Owner IPC, trust storage, device/session services and focused tests provide reusable local management, identity, lifecycle and validation entry points.
- The current baseline and migration boundary are recorded in [`../current-behavior.md`](../current-behavior.md); the normative target model is in [`../owner-remote-architecture.md`](../owner-remote-architecture.md), with the Owner API and frontend contracts in the linked boundary docs.

The current code is a legacy implementation baseline only. It does not yet implement the target UX, multi-profile storage, general enrollment issue/status/cancel contract, or paired-device invitation flow.

## Decisions and invariants

| Decision                                            | Status                       | Contract                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enrollment is the only unknown-browser remote entry | Confirmed                    | No Owner-code login, manual fingerprint confirmation, ordinary login QR, or recovery-code login remains.                                                                                                                                                                      |
| Invitation approval and key binding                 | Confirmed                    | The browser generates its device key before redemption. Owner binds the verified public key and creates the device and initial session as one logical operation. The server never trusts a browser-supplied `deviceId`.                                                       |
| Invitation payload and routing                      | Confirmed                    | Payload carries an opaque, random, short-lived reference only. It does not carry a Relay URL, Owner code, fingerprint, bearer, or private key. Standard Relay selection comes from the trusted application profile. Custom Relay selection is outside this work package.      |
| Invitation lifetime                                 | Recommended default, adopted | Five minutes, single use, cancellable, and only one active invitation per Owner. This gives a concrete bound while matching the existing short-lived invitation design; changing the duration does not change the protocol shape.                                             |
| Invitation invalidation                             | Confirmed                    | Replacement, cancellation, expiry, successful consumption, Owner restart, Relay restart/disconnect, trust reset, and relevant device/trust revocation invalidate the invitation. Redemption races must yield at most one successful device/session creation.                  |
| Owner and Relay responsibility                      | Confirmed                    | Owner validates invitation, current Owner/node identity, trust epoch, and browser key. Relay only registers/routes the opaque reference to the online Owner.                                                                                                                  |
| Owner code and fingerprint                          | Confirmed                    | Internal route and E2EE identity-pinning material may remain as required, but must not be exposed as a normal user action or login input. A changed Owner identity fails closed.                                                                                              |
| Connection profiles                                 | Confirmed                    | Multiple profiles are supported. Each profile owns its device key, device ID, Owner/node identity, pairing token, trust epoch, encrypted session, and display metadata. No global `current` record is authoritative.                                                          |
| Known-connection authentication                     | Confirmed                    | Attempt paired session restoration first. If the session is invalid and identity still matches, attempt remote Passkey for that profile. Without a remote Passkey, require a new invitation.                                                                                  |
| Recovery                                            | Confirmed                    | Recovery codes and their login/storage/rotation/management paths are removed. Owner local access or CLI is the recovery root; a currently authenticated paired device may issue an invitation subject to step-up rules.                                                       |
| Local and remote routes                             | Confirmed                    | localhost has a local Passkey entry only. Remote App origin shows saved remote profiles and handles enrollment deep links; it has no local-machine mode toggle.                                                                                                               |
| Logout versus removal                               | Confirmed                    | Logout clears that profile's session bearer but preserves its device key and profile. Removal deletes local secrets and attempts Owner-side revocation only over an authenticated connection.                                                                                 |
| Storage and presentation boundary                   | Confirmed                    | Private keys and pairing/session credentials stay in protected browser storage; session bearer is encrypted with a non-exportable key. UI receives only a safe presentation projection. Secrets and raw identity material stay out of URLs, logs, React state, and telemetry. |

## Domain model, state ownership, and interfaces

### Owner-owned state

Owner owns invitation validity, Owner/node identity, trust epoch, device registration, pairing-token issuance, session issuance/revocation, Passkey presence, and security events. Invitation state may be in protected runtime memory: restart invalidation is intentional. Session bearers are returned once; only their hashes are persisted server-side.

The following TypeScript shapes describe semantics, not permission to expose raw values to UI:

```ts
type EnrollmentInvitation = {
  reference: string
  expiresAt: string
  issuer: 'owner-local' | 'cli' | 'paired-device'
}

type EnrollmentRedeemResult = {
  ownerId: string
  nodeId: string
  ownerPublicKey: string
  deviceId: string
  clientToken: string
  trustEpoch: number
  session: OwnerSessionCredentials
}
```

`OwnerSessionCredentials` must use the existing session contract and return the bearer only to the redeeming browser. The relay/app routing profile is resolved outside the invitation payload. Enrollment issuer and status DTOs must omit capability material except for the reference needed by the issuing surface.

### Browser-owned state

The local profile store is the source of truth for saved remote connections. Its persisted record must contain a profile ID, display label, trusted Relay profile reference/URL, node and Owner identity binding, device ID, pairing client token, trust epoch, created/last-connected timestamps, device private key, and encrypted session data. Type details and IndexedDB schema version are implementation-owned, but profile isolation and secret boundaries are not.

The UI projection contains only label, connection/session status, timestamps, and actionable errors. It must not expose private key, pairing token, session bearer, raw Owner public key, or opaque enrollment reference except while the enrollment route is actively consuming it.

## Behavior and lifecycle

### Invitation issue, redemption, and failure

1. Owner local management, CLI IPC, or an authenticated paired session requests an invitation. The Owner replaces any active invitation and registers the new reference with Relay when the Owner is online.
2. A remote browser opens the enrollment deep link. It validates the payload shape and obtains routing only from the trusted app profile.
3. The browser creates a non-exportable device key and attaches through the reference-routed E2EE channel. The invitation URL is not a credential for an established session.
4. Owner validates the reference, expiry, current identity/trust epoch and handshake key, then consumes the invitation and creates the device, pairing token, and first session atomically with respect to duplicate redemption.
5. The browser persists a new isolated connection profile and encrypted session, then enters the workspace.
6. Replay, wrong identity/epoch/key, expired, cancelled, replaced, revoked, or consumed invitations fail with stable authorization/resource errors and create no additional device or session. Errors must not reveal whether an unrelated reference is valid.

### Invitation management and authorization

- `owner.enrollment.issue()` is authenticated and available through local management, CLI IPC, or an authenticated paired session. When a remote Passkey is configured, a paired device must complete step-up before issue; without one, the active paired session is sufficient.
- `owner.enrollment.status()` returns active/absent state, expiry and issuer. The issuing UI may receive the opaque reference needed to render its URL/QR; other callers and status projections receive no reusable capability.
- `owner.enrollment.cancel()` is authenticated and idempotent; its result states whether an active invitation was cancelled.
- Owner local/CLI issue must use the existing local Owner/IPC boundary. Do not introduce a new recovery bypass or require a remote device to recover all-device loss.
- Keep device list/revoke/revoke-all, remote-session revoke-all, trust reset and Passkey operations with existing Owner authorization rules, updated to invalidate enrollment consistently.

### Saved connection lifecycle

1. Remote login loads all local profiles without contacting Owner and shows a profile list.
2. Selecting a profile attempts paired E2EE connection and session restoration. `Test connection` checks Relay reachability, Owner availability, E2EE identity, device authorization and session state only.
3. If session re-authentication is required, compare Owner public key, node identity and trust epoch before remote Passkey. Mismatch fails closed and marks only that profile for re-enrollment.
4. Successful remote Passkey refreshes the selected profile session. If no Passkey is configured, retain safe profile metadata and direct the user to obtain a new invitation.
5. Logout clears the selected profile's session. Profile removal clears its key, pairing token, encrypted session and identity binding; attempt Owner revocation only if authenticated transport is available.

Revocation, trust reset, local storage corruption or session decryption failure affects only the selected profile and must not corrupt other profiles. Owner/Relay restart invalidates invitations and closes active remote connections; saved profiles remain available for a later connection attempt.

## Non-goals and compatibility

- No Guest runtime, anonymous workspace, Relay account, multi-Owner account model, multi-node management, or offline business queue.
- No remote Owner-code form, fingerprint confirmation, arbitrary Owner discovery, recovery-code login, login QR request, or separate request-approval capability.
- No silent trust-on-first-use from a bare Relay URL. Trust begins with an Owner-issued invitation.
- No migration compatibility for legacy Owner-code, recovery, first-session-only, or login-QR admission after the new contract is landed. Legacy local browser records must be rejected/cleared safely rather than silently promoted to profiles.
- No display of Owner public key text, fingerprint, raw session token, private key, API key, host paths, or raw runtime/Relay payloads.
- No change to unrelated workspace, Thread, Codex runtime, persistence, or deployment behavior.

## Implementation task packages and dependencies

Task packages are under [`owner-device-enrollment/`](owner-device-enrollment/). They own these boundaries:

| Package                                                                                                        | Scope                                                                                                                                            | Depends on                                        |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| [01-owner-protocol-and-services.md](owner-device-enrollment/01-owner-protocol-and-services.md)                 | Owner enrollment lifecycle, secure redemption, CLI/local issue, paired issue authorization, Relay reference-only admission, and protocol cleanup | None; establishes shared server/protocol contract |
| [02-browser-profiles-and-admission.md](owner-device-enrollment/02-browser-profiles-and-admission.md)           | Versioned multi-profile store, isolated secrets, paired restore, remote Passkey and profile lifecycle logic                                      | Contract in package 01                            |
| [03-remote-routes-and-device-management.md](owner-device-enrollment/03-remote-routes-and-device-management.md) | Local/remote route split, enrollment deep link, profile manager UI, invitation UI, device management integration                                 | Packages 01 and 02                                |
| [04-integration-and-retirement.md](owner-device-enrollment/04-integration-and-retirement.md)                   | Cross-boundary lifecycle integration, removal of stale contracts/docs, acceptance and full checks                                                | Packages 01-03                                    |

Packages 01 and 02 may proceed independently once package 01's shared semantic DTO/transport contract is published; package 02 does not need server implementation to build pure storage logic. Package 03 integrates both. Package 04 is final integration and retirement ownership, not a second implementation of the component work.

## Acceptance and validation

### Acceptance scenarios

1. Clean Owner can issue an invitation through local management/CLI; a new browser redeems it once and saves an isolated profile.
2. An authenticated paired device can add another browser; configured Passkey requires step-up, and all-device loss remains recoverable through local Owner/CLI.
3. A valid paired session restores without Passkey; an invalid session on an identity-matching profile uses remote Passkey; absent Passkey requires a new invitation.
4. Connection test distinguishes Relay unreachable, Owner offline, E2EE/identity mismatch, revoked device, invalid session and success without changing authorization state.
5. Replacement, expiry, cancellation, replay, concurrent redemption, Owner restart, Relay restart/disconnect, device revocation and trust reset fail closed.
6. Owner key, node identity or trust epoch changes never silently replace a saved profile identity.
7. Logout preserves profile/key; removal clears local secrets; Owner revocation prevents a removed device from resuming.
8. localhost exposes local Passkey only; remote origin exposes saved profiles and enrollment deep links only.
9. Recovery-code APIs/storage/CLI/UI, ordinary login-QR flows, Owner-code login and manual fingerprint confirmation are absent.
10. Legacy single-device browser data is handled without silently trusting or promoting it; multiple profiles remain isolated under success and failure paths.

### Checks

Run focused package tests during each task, then run the final repository checks:

```text
pnpm test:server
pnpm test:protocol
pnpm test:relay
pnpm test:frontend
pnpm typecheck
pnpm exec oxfmt --check <touched TypeScript files>
pnpm lint:staged
git diff --check
```

Manual browser regression is required for enrollment deep links, profile selection/test/remove, logout, route separation, and invitation failure states. Do not add renderer/Playwright/screenshot tests; the repository verification rules require manual UI acceptance. `pnpm lint:staged` applies when intended changes are staged for commit and must include only intended files. Integration commands requiring running services are not part of this specification unless the implementer documents the prerequisite and uses the repository's documented ports.

## Open questions and blockers

- **None blocking.** Invitation payload routing and custom Relay are resolved by the architecture/API contract: this scope uses the trusted Relay application profile and excludes custom Relay selection.
- **Adopted default:** Invitation TTL is five minutes; this is an explicit implementation default, not a historical code fact or separately confirmed product choice.
- **Implementation-local detail:** IndexedDB schema layout, profile ID format, precise UI labels, and exact transport method names may follow existing conventions as long as the contracts, boundaries and acceptance scenarios above remain true.
