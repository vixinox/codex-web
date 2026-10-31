# Task 03: Remote Routes and Device Management

## Goal and completion result

Expose enrollment and saved remote connections through separate, understandable entry points. Users can enroll from an invitation, choose/test/remove a saved remote profile, and manage invitations/devices without encountering the retired login fields.

## Read first

- [Owner Device Enrollment Development Specification](../owner-device-enrollment.md)
- [Task 01: Owner Enrollment Protocol and Services](01-owner-protocol-and-services.md)
- [Task 02: Browser Profiles and Admission](02-browser-profiles-and-admission.md)
- [`../../frontend/README.zh-CN.md`](../../frontend/README.zh-CN.md)

## Scope and ownership

Own `packages/app/src/app/entry`, login/enrollment route composition, `packages/app/src/app/composition/screens`, and relevant Owner management UI/client modules. Coordinate route/controller interfaces with task 02. Do not alter Owner/Relay policy or reimplement profile persistence.

Implement:

- Separate localhost local-Passkey login from remote-origin saved-profile login; remove the local/remote mode toggle.
- Remote login showing saved connection profiles, connection status, `Test connection`, connect, logout and remove actions. With no profiles, the only unknown-browser route is an enrollment deep link.
- Enrollment deep-link handling that accepts the opaque invitation reference, uses the trusted Relay application profile, creates the browser key, calls task 01's redemption path, persists the resulting profile through task 02, and then opens the workspace.
- Invitation issue/cancel/status controls in authenticated Owner management, including URL/QR rendering of the opaque reference. Paired issuance performs required Passkey step-up as part of Owner contract.
- Device list, single/revoke-all, session revoke-all and trust reset controls using safe Owner DTOs; show actionable failure and success states without printing Owner key/fingerprint/tokens.
- Remove Owner-code field, manual fingerprint confirmation, recovery-code field, ordinary login-QR request/scanner, and legacy first-session-only UX.

## Dependencies and integration

Depends on task 01 semantic issue/redeem/management methods and task 02 profile/controller APIs. The screen may be developed with typed fixtures while either dependency is in progress, but integration must use the real contracts. Task 04 owns cross-origin and lifecycle acceptance.

## Acceptance criteria

- localhost exposes local Passkey only; remote origin exposes saved remote profiles and invitation deep links only.
- Unknown browser can complete enrollment from a valid link without entering Owner code, fingerprint or recovery code.
- Known-profile test reports Relay/Owner/E2EE/device/session state and never changes authorization state.
- Expired/cancelled/replayed invitation, identity mismatch, offline Owner, revoked device and invalid session states give a safe next action; unrelated profiles remain available.
- Invitation issue shows the one active invitation, cancellation is reflected, and successful enrollment updates the device list/event state.
- No user-visible UI, route or scanner retains the removed legacy admissions.

## Focused validation

```text
pnpm test:frontend
pnpm typecheck
pnpm exec oxfmt --check <touched TypeScript files>
```

Complete manual browser regression for localhost and remote origins, enrollment deep links, profile selection/test/remove/logout, invitation cancellation/expiry, and management flows. Renderer/route Playwright or screenshot tests are outside the repository's accepted test strategy.

## Local implementation choices

Follow current route/composition and shadcn UI conventions. Keep the UX scan-friendly and state-oriented. UI wording and icon choices are local provided they preserve the entry-point separation and do not disclose protocol internals.
