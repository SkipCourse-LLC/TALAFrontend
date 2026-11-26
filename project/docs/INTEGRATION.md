# Dylan review handoff — yichen frontend demo

## 2026-10-20: Firebase integration update

The current implementation includes genuine local Firebase Auth, UID profiles, transactional reservations, immutable Evidence submission, published staff outcomes, acknowledgements and server-confirmed family-link reads. These share adapters with a guarded, separately approved test-cloud mode. No actual cloud project is connected or deployed. Start with the root [README](../../README.md), [backend contract](../../backend/README.md) and [current integration blockers](BACKEND_INTEGRATION_NEEDED.md). Test-cloud configuration must pass a public Auth project/Web App check before any SDK initialization; SkipClass production is explicitly blocked.

Firebase mode has no real Zoom, AI, payment, parent dashboard or production consent workflow. Evidence finalization removes staging and uses server-only files; abandoned staging retention and malware scanning remain release blockers. The following October 7 review, remote hashes, historical test counts and no-commit statements are retained as history, not a fresh remote-state or production claim. New work remains on `yichen`; integration into Next.js requires Dylan's separate review.

## Historical presentation review — 2026-10-07

Reviewed on 2026-10-07. This snapshot preserves the existing UI and functionality. SCRUM-46–49 provide demonstrable frontend flows, not production authentication, a school approval decision or real payment processing. Mock data is accepted for this review; final Jira acceptance criteria were not supplied.

The [task walkthrough and test evidence](SPRINT_2.md) describes the presentation preview. Earlier whole-product changes exceed the four-task modules. The [backend checklist](BACKEND_INTEGRATION_NEEDED.md) preserves the wider integration questions.

## Repository state verified for this review

| Item                       | Observed state                                                             |
| -------------------------- | -------------------------------------------------------------------------- |
| Local directory / branch   | `/Users/yichenzeng/TALA-Hub` / `yichen`                                    |
| Local HEAD                 | `903214865d453d0f077a3dd99ccd76bc1ae7b5ca`                                 |
| Team remote                | `team`: `https://github.com/Tucson-Adaptive-Learning-Academy/Frontend.git` |
| Original remote            | `origin`: `https://github.com/tinaalessiteacher-hash/TALA-Hub.git`         |
| Live team `yichen`         | `903214865d453d0f077a3dd99ccd76bc1ae7b5ca`, equal to local HEAD            |
| Committed but not pushed   | None; local HEAD and the live team branch are equal                        |
| Staged files               | None                                                                       |
| Worktree at review start   | 58 modified tracked files and 25 untracked files; none deleted             |
| Live team `main`           | `693b8635257e16397bc70347de164e96bc5c62b5`                                 |
| Live team `rewrite/nextjs` | `068e8c08324ca239dd721349723ab8fe5cca774f`                                 |

The remote `yichen` already contains the existing 12-commit project history through `9032148`, including the earlier Sprint 2 demo at `b0aed67`. The newer UI, module adapters and tests in the current worktree are **not on that branch yet**. Commit messages alone were not used to verify task behavior.

This review preserves all pending work, including earlier registration, login, dashboard, public-site, shared-style and routing changes. Those changes exceed SCRUM-46–49 and need a separate scope review. No file with an unexplained purpose was found among the nonignored candidates. Local backups, dependencies, generated builds and test artifacts are excluded from the manifest and from the proposed delivery.

No staging, commit, push, PR, merge, branch deletion, force push or deployment was performed. Existing application source was unchanged during this delivery audit; necessary repairs were limited to test diagnostics/types and documentation.

## Install and run

Use Node.js `^22.13.0 || >=24`. This review used Node 24.1.0 / npm 11.3.0. From the repository root:

```sh
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/#/`. No secret or real payment account is required. The existing `frontend/.env.example` contains public demo flags only; an `.env` file is not required for the default local demo. Use invented account details. The Email verification option uses public sample code `246810` and sends no email.

For deliberate error/retry demonstrations, restart the dev server with:

```sh
VITE_DEMO_MODE=true VITE_DEMO_TOOLS=true npm run dev
```

Keep `VITE_DEMO_TOOLS=false` for the normal walkthrough. Setting `VITE_DEMO_MODE=false` makes unconnected services unavailable; it does not activate a real API. Check commands and results are recorded in [SPRINT_2.md](SPRINT_2.md). Browser suites need Chromium and WebKit installed and unused test ports 4173/4175.

## Confirmed service and privacy boundaries

- `authentication/authService.ts` chooses the auth adapter and retains a whitelisted demo identity in sessionStorage. `demoAuthAdapter.ts` performs sample login; role choices are publicly selectable fixtures, not RBAC. No Google OAuth integration was observed in this branch.
- `registration/enrollmentContract.ts` contains frontend registration types and checks; `enrollmentService.ts` implements the current mock submission. No account, database record, document upload or student provisioning is created. The receipt passes sample family names/emails and safe enrollment preferences to the workspace in memory; passwords are cleared and are not included in the receipt.
- `authentication/twoFactorAdapter.ts`, `twoFactorService.ts` and `twoFactorRuntime.ts` keep the 2FA contract, mock implementation and runtime together. OTPAuth verifies actual TOTP mathematics in the browser. That is not server-enforced MFA, provider enrollment or a durable authenticator binding.
- `payment/paymentAdapter.ts`, `paymentService.ts`, `paymentRuntime.ts`, `useApproval.ts` and `usePaymentSnapshot.ts` contain the module's frontend contract, mock state and subscriptions. Approval is selected through a clearly labeled demo fixture, not read from a database or meeting appointment.
- Card/bank, billing and contact values in `SamplePaymentMethod.tsx` are fixed fake display data. Users cannot enter real financial details. The adapter receives a sample-method enum, not card number, CVV, bank credentials or billing/contact fields. Success records a local demo receipt and makes no charge.
- `dashboard/skipCourseApi.ts` / `demoStudentAdapter.ts` remain the mock student-data boundary. `classes/scheduleAdapter.ts` owns the timetable contract; `scheduleService.ts` implements the sample schedule. Shared models are UI contracts, not confirmed backend schemas.
- `shared/services/demoConfig.ts`, `demoDelay.ts` and `demoData.ts` retain the existing demo flags, latency and identity fixtures. Public copy and assets still require team/sponsor approval.

Registration drafts, verification challenges, approval fixtures and payment receipts are held in memory and reset on refresh. Successful payment receipts can be revisited during the same SPA session; unfinished payment drafts reset when leaving the page. Demo identity and class selections can survive refresh in the same tab. Sign-out or a new demo identity invalidates the relevant module state.

TOTP secrets and QR data are generated at runtime, never hardcoded or persisted to browser storage. Using **Copy** deliberately places the manual setup key on the system clipboard; the UI explains this clipboard behavior. Clear the clipboard after copying. Do not share an unmasked authentication screenshot. Test traces, automatic screenshots/video and automatic failure-page snapshots are disabled; explicit setup screenshots mask enrollment material. The delivery fix also prevents assertion/axe/network diagnostics from including a raw setup key, QR URI or page markup. Generated reports stay outside the delivery.

## Compare before integrating with rewrite/nextjs

The team branch was inspected read-only at `068e8c0`, using a separate temporary clone. The local worktree and team branches were not merged or migrated.

| Aspect                 | Current yichen project                                                                                     | Team rewrite/nextjs at inspected commit                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Application root       | `frontend/`                                                                                                | Repository root                                                                                                         |
| Framework              | React 19.3, Vite 8.3, TypeScript 6.0.3                                                                     | Next.js 16.3.6, React 19.3, TypeScript 6.0.3                                                                            |
| Routing                | React Router / HashRouter in `frontend/src/App.tsx`; `/#/two-factor`, `/#/enrollment-status`, `/#/payment` | Next App Router under `app/`, including `(marketing)` route group                                                       |
| Components and styling | Feature folders, ordinary CSS and shared global styles                                                     | `components/`, `lib/`, `styles/`, CSS Modules/tokens                                                                    |
| Tests                  | Playwright unit/adapter and browser configurations                                                         | Vitest; separate formatting, ESLint and Stylelint checks                                                                |
| Authentication         | Public demo login/session and browser TOTP                                                                 | Inspected `lib/server/session.ts` returns null; login form is a placeholder. No working Google auth was confirmed there |
| Task pages             | Existing 2FA, enrollment status and payment routes                                                         | Corresponding feature routes were not present in the inspected tree                                                     |
| Environment            | Public `VITE_` demo flags; no client credentials                                                           | `NEXT_PUBLIC_` client configuration plus server environment helpers                                                     |

`git merge-base` found **no common ancestor** between `yichen` and `rewrite/nextjs` (12 and 7 commits respectively). Shared React dependencies do not make the directory, routing, server/client boundary, roles or styles interchangeable. Do not merge the complete branch with unrelated-history overrides. Dylan should select the target branch and integration method, then port reviewed feature behavior/contracts deliberately. A Next.js port must decide client/server ownership, provider handling, styles, navigation and tests. This audit does not start that work.

## Decisions requested from Dylan and the team

1. Which authentication solution and integration branch should the team use? Dylan's Google auth suggestion and possible admin Authenticator use remain options, not a finalized policy. Existing signup 2FA is preserved; existing sample login does not require 2FA for every user. Confirm required roles, enrollment timing, recovery and server verification before changing that behavior.
2. What grants payment eligibility, who may pay for which student, and which backend record/version owns that decision? **Meeting appointment approval must remain separate from enrollment/payment approval.** Confirm whether backend `declined` maps to current `rejected` or `not-approved`, and whether withdrawn/cancelled applications need a distinct status.
3. Confirm amounts/currency, ESA/STO eligibility, fee wording, the payment provider, hosted fields/checkout and server receipt/webhook confirmation. Current $0.00 is an invented demo total, not a confirmed fee, award or paid balance.
4. Confirm registration/database ownership, stable account/application/student IDs, authorized parent/student relationships and when real student access begins. Current route guards and the demo role selector are not authorization.
5. Review the earlier whole-product changes separately from SCRUM-46–49. The manifest records their scope; no teammate source was edited during this delivery audit.
6. Confirm whether a future ordinary push to `team/yichen` triggers GitHub Pages or an external hosting integration. The inspected Next.js workflow runs checks on PRs and pushes to `main`, with no deployment job; no workflow exists in the inspected `yichen` tree. Hosting settings/webhooks and the screenshot's failed remote check were not verified. GitHub connector status requests returned 404 despite successful authenticated Git reads, so no cause for that check is asserted.

Future Git actions require the user's confirmation. The only proposed push target is the team's `yichen`, using a normal push after rechecking its live SHA. Never update `main` or `rewrite/nextjs`, force push, merge for Dylan or modify deployment configuration as part of this handoff.

## Wider backend/content handoff retained

The [backend checklist](BACKEND_INTEGRATION_NEEDED.md) still covers registration, parent/student account linking, profile/evidence data, SkipCourse, AZ Transfer and billing. No illustrative HubSpot/EZAMU payload or endpoint from earlier planning material is treated as a confirmed contract, and no such endpoint was introduced here.

Karl/backend must provide approved requests/responses, authentication, error and authorization rules, staging origins and safe fixtures. Tina/sponsor must confirm registration/documents, guardian consent, access and approval policies, fees and content. Ayushi/Tina own final public content. Real adapters must validate service responses, map them to UI view models and retain cancellation/error/retry behavior. Server-side authorization, idempotency and partial-failure recovery remain essential; client route guards cannot provide them.

CNAME, DNS, GitHub Pages settings, hosting projects and production systems were not changed. The [deployment guide](DEPLOYMENT.md) is reference material requiring a confirmed owner and target; it is not release authorization.
