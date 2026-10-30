# M5 · App Login Screen and Management UX

## Mission

Replace legacy auth UI/state with the zero-credential first-session flow, origin-aware Passkey controls, optional recovery setup, paired restore, and device/security management.

## Read first

- `AGENTS.md`, `PROJECT.md`, `00-contracts.md`
- M2 and M3 handoffs
- `docs/frontend/README.zh-CN.md`
- `packages/app/src/app/composition/screens/login-screen.tsx`
- `packages/app/src/app/entry/route-components.tsx`
- `packages/app/src/app/owner/owner-manage-screen.tsx`
- `packages/app/src/app/owner/owner-management-client.ts`
- `packages/app/src/lib/remote/admission.ts`
- `packages/app/src/lib/remote/device-key-store.ts`

## Scope and allowed paths

- App auth transport/adapters, login screen, owner management screen/client/model, route guards and auth state, pure frontend tests, and touched frontend docs if required by the contract.
- Do not modify server cryptography, schema, Relay routing, or CLI IPC.

## Required login-screen behavior

1. Try paired-session restore before showing login controls.
2. Accept camera, image upload, and manual first-session URL/QR entry; reuse the safe QR decoder path.
3. First-session UI says “首次连接” and requires no Passkey, recovery code, email, password, or TOTP.
4. On successful redemption, persist device/session and navigate to workspace.
5. Show Passkey login only when remote Passkey presence is true.
6. Show recovery only when recovery batch presence is true; otherwise show `RECOVERY_NOT_CONFIGURED` guidance.
7. If no paired session, remote Passkey, recovery batch, or valid first-session grant exists, clearly instruct the user to return to Owner machine and generate a new URL/QR.
8. After first login, show a dismissible one-time security-setup prompt linking to management. Skipping does not block product use.
9. Remove all email/password/TOTP/username fields and related state.

## Required management behavior

- Show Passkey presence by origin and allow remote Passkey registration from the first session.
- Allow recovery-code generation when none exists; display plaintext once and require explicit save acknowledgement in the UI. Rotation requires step-up once a Passkey exists.
- Issue localhost enrollment ticket and open/instruct exact `http://localhost:5173` setup; never treat remote Passkey as local credential.
- Show device/session list, individual revoke, revoke-all, trust reset, QR status/cancel, security state, and risk guidance when no recovery path exists.
- Never expose credential private material, recovery hashes, raw QR bearer, session token, Owner paths, or API keys.

## Dependencies and seam

M2/M3 handoffs are authoritative for method names, DTOs, presence states, errors, and storage invalidation. If the UI needs a missing field, record it in the handoff and update `00-contracts.md` before inventing a local assumption.

## Validation

- Pure app tests for QR/admission/device state and error projections.
- `pnpm --filter @codex-web/app test`.
- `pnpm typecheck`.
- `pnpm exec oxfmt --check <touched TypeScript files>`.
- Manual browser regression for fresh startup, first-session QR, skip/setup security, paired resume, missing recovery path, local/remote origin separation, logout/revoke.

## Handoff

Report the login-screen state machine, management actions, any DTO additions, test results, and manual browser results. State explicitly that no React DOM/Playwright/screenshot tests were added unless user requested them.
