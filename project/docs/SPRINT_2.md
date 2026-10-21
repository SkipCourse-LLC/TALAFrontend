# SCRUM-46–49: current demo review

Review date: 2026-10-07. This records inspected behavior and fresh local checks, not Jira labels or commit-message claims. Existing UI was preserved. No live authentication, database, approval or payment service is connected. Final Jira acceptance criteria were not supplied, so demo readiness does not establish production completion or a final Done decision.

Repository/integration decisions: [INTEGRATION.md](INTEGRATION.md). This October 7 review describes the preserved presentation mode. Current Firebase work and limitations are documented in the root [README](../../README.md) and [backend checklist](BACKEND_INTEGRATION_NEEDED.md); it does not make the original Demo MFA or payment flows production-ready.

## Actual task status

| Task     | Implemented and demonstrable                                                                                                                                                                                                                                 | Main files under `frontend/src/`                                                                                                                                                                    | Still unconfirmed or absent                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCRUM-46 | Existing six-step parent registration opens Authenticator setup before a signup session exists. Runtime QR/manual key, show/hide, copy/fallback, loading, failed setup/retry and restart are available.                                                      | `authentication/TwoFactorPage.tsx`, `TwoFactorSetup.tsx`, `twoFactorAdapter.ts`, `twoFactorService.ts`, `twoFactorRuntime.ts`, `twoFactor.css`; existing registration/App wiring                    | Provider enrollment, durable account binding, server-owned secret/challenge, role/policy decision; phone authenticator app operation not manually tested |
| SCRUM-47 | Six-digit entry supports paste, native editing/backspace and focus. Empty, invalid, expired code/challenge, service failure, retry, back/cancel, success and recovery/lost-device guidance are implemented. Signup verification opens a parent demo session. | `authentication/TwoFactorPage.tsx`, `TwoFactorComplete.tsx`, `twoFactorCode.ts`, adapter/service/runtime and styles                                                                                 | Server verification/rate limits/session creation, actual email delivery, recovery codes or lost-device reset workflow                                    |
| SCRUM-48 | Responsive checkout, funding guidance, visible sample card brands/details, fixed billing/contact data, sample-method selection, acknowledgment validation, loading, success, failure/retry, cancel/resume and duplicate-submit protection.                   | `payment/PaymentPage.tsx`, `PaymentForm.tsx`, `SamplePaymentMethod.tsx`, `PaymentLayout.tsx`, `paymentAdapter.ts`, `paymentService.ts`, `paymentRuntime.ts`, `usePaymentSnapshot.ts`, `payment.css` | Real payment collection/tokenization/provider, server amounts and receipts; success here is simulated and no money is charged                            |
| SCRUM-49 | Enrollment status defaults pending. Approved sample enables payment; pending, not-approved and rejected samples keep it locked. Direct navigation cannot grant approval. Submission rechecks approval and rejects revoked/late/cancelled results.            | `payment/ApprovalPage.tsx`, `useApproval.ts`, `PaymentPage.tsx`, payment adapter/service/runtime; existing App/dashboard links                                                                      | Real approval source, authorized payer/application ID, mapping of declined/withdrawn states, verified payment-to-student-access rules                    |

These contracts live inside their modules and do not invent API endpoints. Existing Google auth is not connected in this branch. This audit neither removes 2FA nor adds universal mandatory 2FA to login.

## Demo walkthrough

Use invented account details and the supplied fixed payment samples only. Start the application as described in [README](../../README.md).

1. Open `/#/register`, finish all six registration steps and submit. Funding here records a preference; it does not accept card information or approve funding.
2. On Authenticator setup, inspect the QR and reveal/hide the manual key. Copy is optional and places the key on the system clipboard; clear it afterwards. Continue to verification. Automated tests decode the QR and calculate matching TOTP codes; Google/Microsoft phone apps were not physically operated for this review.
3. Submit empty and malformed/wrong codes to inspect error feedback, then retry with a valid current six-digit TOTP. Alternatively choose Email for a repeatable mock demonstration using `246810`; no email is sent. An already-expired TOTP/challenge is covered by controlled automated fixtures rather than pretending the public email code is a live OTP.
4. On verification success, continue to the parent workspace. Signup passwords are cleared; normal sample login remains a separate demonstration entry.
5. Open **Enrollment status & payment** (`/#/enrollment-status`). Start with Pending, then inspect Not approved and Rejected. Select **Approved (demo)** in **Demo application status**, then **Continue to payment**. This is a public fixture selector, not a school decision or appointment approval.
6. On `/#/payment`, choose **Private**. Card brands and fake credit-card/billing/contact fields are already visible inline. Before selecting a method, try submitting to inspect the missing-method feedback. Then select **Use demo card**. The optional fixed card/bank chooser opens through **Add demo payment method** before selection or **Change demo payment method** afterwards; real data cannot be entered.
7. Try continuing without acknowledgment to inspect validation. Check the acknowledgment and use **Pay with demo card** (or **Pay with demo bank account** for that sample). Only Private is currently offered. The receipt identifies simulated completion and a $0.00 demo total, not real payment success.
8. To show simulated service errors and retry, restart locally with `VITE_DEMO_TOOLS=true` and use the labeled demo controls. Cancel an attempt and resume, or revoke an approved fixture. Ordinary demo mode hides these QA controls.
9. Navigate away/back after success to inspect the in-session receipt. Refresh to show that approval/payment and unfinished verification reset. A demo login identity can survive refresh, but cannot create an approved backend application.

Anonymous payment navigation goes to login; pending signup navigation stays in verification. Opening 2FA without an in-memory pending signup offers a restart. Route guards are frontend UX only.

## Implemented state meanings

| Area                            | Actual states                                                                                          | Meaning and limit                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Application/payment eligibility | `pending`, `approved`, `not-approved`, `rejected`                                                      | Local fixture per demo identity. `declined` is not a literal implemented value; its backend meaning/mapping needs confirmation |
| Payment attempt                 | `idle`, `submitting`, `success`, `cancelled`, `error`                                                  | `cancelled` means a demo payment attempt, not a withdrawn/cancelled application. No application-cancelled state is implemented |
| Verification                    | setup/loading/verification, validation or service error, expired challenge, recovery guidance, success | Locally verified TOTP or public email fixture. Recovery UI does not issue recovery codes or reset an account                   |

Approval and payment are never derived from meeting-booking approval. Missing real business states or interfaces are integration gaps, not scenarios declared passed.

## State, races and sensitive data

- The mock authenticator generates a random 20-byte secret and otpauth QR locally. OTPAuth uses SHA-1, six digits, 30-second periods and a one-step clock tolerance. Challenges have a 10-minute TTL and local single-use/replay checks. This is real TOTP math running in a browser demo, not production MFA.
- Setup/verification handles request abort, method/identity changes and late responses. Back retains a valid setup; cancellation, method change, success, leaving the page or refresh invalidates it. Codes/challenges/secrets are not saved in browser storage or sent to an API.
- Payment locks duplicate submission synchronously, captures the selected sample method, rechecks approval across the asynchronous operation and invalidates responses on cancellation, identity/adapter change or approval revocation. A local receipt cannot be resurrected by a late result.
- Approval and receipts are module memory only. A completed receipt survives SPA navigation in the same demo session; unfinished drafts reset on page exit. Refresh/sign-out/new demo login clear the corresponding state. Demo identity and course selections may remain in sessionStorage; they are not credentials or permission proof.
- Fixed sample card/bank/address/contact fields are display data, not editable payment inputs. The submission contract accepts only a sample-method enum for Private. It does not transmit or store raw financial details.
- `VITE_DEMO_MODE=false` fails closed; there is no guessed live endpoint. Never store secrets in `VITE_` variables or a future client adapter.

## Fresh verification — this review

Commands run from `frontend/` with the existing pinned dependencies. Browser results use Chromium at desktop 1440px, phone 390px, small phone 320px and WebKit tablet 768px. Additional controlled module fixtures verify error/race states.

| Check                                                         | Current result                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm ls --depth=0`                                            | Passed; installed top-level dependencies match the lockfile                                              |
| `npm run lint`                                                | Passed after diagnostic changes; zero warnings                                                           |
| `npm run typecheck`                                           | Passed after the strict NodeList typing repair                                                           |
| `VITE_DEMO_MODE=true VITE_DEMO_TOOLS=false npm run build`     | Passed after final regression; TypeScript and normal demo build                                          |
| `npx playwright test --config=tests/sprint2Unit.config.ts`    | 43 passed after diagnostic changes                                                                       |
| `npx playwright test --config=tests/sprint2Browser.config.ts` | 100 passed after diagnostic changes                                                                      |
| `npm test` (default main Playwright configuration)            | Final rerun: 144 passed (3.9m), no failures, skips or retries                                            |
| Tracked/current-source and history sensitive-data scans       | Passed: Gitleaks zero leaks in 118 current files, 13 local and 20 team commits; supplemental scans clear |

The initial full run before the diagnostic repair passed 144 tests; the isolated run passed 100 and adapter/unit run passed 43. After the repair, the first full rerun stopped before test execution because TypeScript did not narrow a NodeList index in a new boolean diagnostic. A guarded NodeList access fixed that test typing issue. Typecheck and the final full rerun passed afterwards. A startup failure is not counted as passing regression coverage. The final suites total **287 passing tests**: 43 unit/adapter + 100 isolated browser + 144 full regression. The first passing pre-repair run is not added to that total.

A separate ordinary-demo smoke check against the current local app passed **4/4 sizes** (1440/390/320 Chromium and 768 WebKit), with actual demo=true/tools=false runtime flags. Each used a fresh sample Parent context, checked three non-approved fixtures, Approved → visible Private sample card → selection/focus → acknowledgment → $0 demo receipt, SPA receipt retention and refresh relocking. QA error controls were absent; page errors, external requests and horizontal overflow were zero. No screenshots or raw identity/setup material were recorded. These four smoke journeys are reported separately from the 287 suite tests.

Coverage includes registration→setup→verification, empty/invalid/expired/retry, QR decoding and TOTP correspondence, cancellation/navigation/refresh, payment methods and acknowledgment validation, funding fixtures, approval restrictions/revocation, duplicate submit and late responses, keyboard focus/error announcements, touch targets, layout overflow, reduced motion, browser storage and axe accessibility checks. The full regression also covers the existing public-site/login/workspace/class flows, which were preserved.

Automated axe checks and keyboard tests do not establish complete WCAG compliance. Physical screen-reader sessions, physical phone authenticator enrollment, real provider compatibility and service integration are not claimed as tested. No real accounts or financial data were used.

## Necessary repair during delivery review

Only test files were repaired: `signupHelpers.ts`, `twoFactorSetup.spec.ts`, `sprint2.spec.ts`, `sprint2Upgrade.spec.ts`, `sprint2Production.browser.ts` and `sprint2Adapters.unit.ts`. Failure assertions now retain secret-presence/format/uniqueness/QR correspondence checks while reporting boolean results, safe violation IDs/counts and generic parse errors. Raw secrets, provisioning URIs, storage contents, request URLs and authentication page markup are not included in those diagnostics. One NodeList access is guarded for strict TypeScript checking.

Traces, screenshots/video and automatic failure-page snapshots remain disabled; explicit authentication screenshots mask setup material. Test reports/logs and local snapshots are excluded from the proposed Git delivery. No application page, shared dependency, package/lockfile or deployment setting was changed during this audit.

## Security evidence

Gitleaks was run with redaction against all 13 locally reachable commits and all 20 commits in a complete read-only clone of the team repository; both scans found zero leaks. A first partial-clone attempt could not load all blobs and was replaced by the complete successful scan; it is not counted as evidence.

The tracked/nonignored current source was also scanned, with supplemental checks for literal TOTP assignments, provisioning URIs, private keys and inline QR data. Supplemental historical scans examined 1,033 local and 1,202 team source blobs and found no matching literal TOTP/provisioning/private-key/inline-QR patterns. No real password, token, API key, private key, persisted TOTP secret or real payment record was identified. `.env.example` contains only public demo flags. Ignore checks exclude `.env`, local credentials/private keys, dependencies, builds, reports and backups; tracked-file checks found no such artifact. The final post-documentation Gitleaks scan covered all 118 tracked/nonignored current files (approximately 615 KB) and found zero leaks; supplemental current-source patterns also returned zero findings. No historical secret was identified, so no credential rotation or history rewrite was performed.

Scanners cannot prove the absence of every possible secret or personal datum. Runtime keys deliberately generated for the demo and fixed public sample verification/payment values are distinguished from private credentials. If a historical secret is found later, stop the push and coordinate credential rotation and history handling; do not rewrite shared history automatically.

## Remaining acceptance and integration decisions

- Dylan: final authentication provider, intended 2FA roles/timing (including the possible admin-only future use), recovery approach and target integration branch. Existing 2FA stays; no universal enforcement is added.
- Backend: real auth/database/session, server secret storage, challenge expiration/attempt limits, email and recovery. Frontend role/session fixtures must be replaced by verified authorization.
- Team/sponsor/backend: enrollment/payment approval source, separate appointment approval, application status mappings and payer-family permissions. Pending/not-approved/rejected are demo states; withdrawn/cancelled applications are a gap.
- Payment owner/backend: actual provider and hosted payment collection, authoritative amounts/currency, eligibility, server idempotency, cancellation/reconciliation and webhook-confirmed receipts. No provider endpoint has been invented.
- Dylan: deliberate integration plan for React/Vite features into the separate Next.js tree. There is no common Git ancestor; no full-branch merge or migration was attempted.
- Release owner: explain external deployment triggers before a future ordinary `team/yichen` push. No hosting settings were changed and the remote failed check shown in the screenshot remains unexplained.

Previous September/October 1 test totals described earlier snapshots, not this delivery. Historical quality records remain in [QUALITY_REVIEW.md](QUALITY_REVIEW.md). No commit, push, PR, merge or deployment occurred in this review.
