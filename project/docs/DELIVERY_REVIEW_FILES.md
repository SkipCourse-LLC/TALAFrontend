# Pending delivery review files

Snapshot date: 2026-10-07. Paths are relative to the repository root. This is a review manifest, **not a staging instruction**. No files have been staged or committed. Read [INTEGRATION.md](INTEGRATION.md) and [SPRINT_2.md](SPRINT_2.md) before selecting commit scope.

Total: **92 candidates** — 66 modified tracked files and 26 new files; no deleted files. Local HEAD equals the verified team `yichen` at `903214865d453d0f077a3dd99ccd76bc1ae7b5ca`; there are no committed-but-unpushed changes.

The audit began with 83 pending files. It preserved all earlier application changes, then repaired diagnostics in six existing test files (two became newly modified relative to HEAD) and updated/added the eight handoff documents listed below. Application source, dependencies, routing and deployment configuration were not changed during this audit.

No unexplained-purpose candidate was identified. The earlier whole-product changes are known UI/service upgrades but exceed the four Jira tasks and need a distinct scope review; this manifest does not establish teammate ownership or authorize new edits. Ignored local snapshots, `node_modules`, builds, `.env`/credentials, screenshots, reports and temporary scripts are excluded.

## SCRUM-46/47 module source (8)

| Status   | File                                                | Changed during this delivery audit? |
| -------- | --------------------------------------------------- | ----------------------------------- |
| New      | `frontend/src/authentication/TwoFactorComplete.tsx` | No — preserved earlier work         |
| Modified | `frontend/src/authentication/TwoFactorPage.tsx`     | No — preserved earlier work         |
| Modified | `frontend/src/authentication/TwoFactorSetup.tsx`    | No — preserved earlier work         |
| New      | `frontend/src/authentication/twoFactor.css`         | No — preserved earlier work         |
| New      | `frontend/src/authentication/twoFactorAdapter.ts`   | No — preserved earlier work         |
| New      | `frontend/src/authentication/twoFactorCode.ts`      | No — preserved earlier work         |
| New      | `frontend/src/authentication/twoFactorRuntime.ts`   | No — preserved earlier work         |
| Modified | `frontend/src/authentication/twoFactorService.ts`   | No — preserved earlier work         |

## SCRUM-48/49 module source (11)

| Status   | File                                           | Changed during this delivery audit? |
| -------- | ---------------------------------------------- | ----------------------------------- |
| Modified | `frontend/src/payment/ApprovalPage.tsx`        | No — preserved earlier work         |
| Modified | `frontend/src/payment/PaymentForm.tsx`         | No — preserved earlier work         |
| New      | `frontend/src/payment/PaymentLayout.tsx`       | No — preserved earlier work         |
| Modified | `frontend/src/payment/PaymentPage.tsx`         | No — preserved earlier work         |
| New      | `frontend/src/payment/SamplePaymentMethod.tsx` | No — preserved earlier work         |
| Modified | `frontend/src/payment/payment.css`             | No — preserved earlier work         |
| New      | `frontend/src/payment/paymentAdapter.ts`       | No — preserved earlier work         |
| New      | `frontend/src/payment/paymentRuntime.ts`       | No — preserved earlier work         |
| Modified | `frontend/src/payment/paymentService.ts`       | No — preserved earlier work         |
| Modified | `frontend/src/payment/useApproval.ts`          | No — preserved earlier work         |
| New      | `frontend/src/payment/usePaymentSnapshot.ts`   | No — preserved earlier work         |

## Earlier cross-module route wiring (1)

The pending App.tsx diff passes the existing registration receipt into the workspace. It predates this audit. No routing edit was made during delivery review.

| Status   | File                   | Changed during this delivery audit? |
| -------- | ---------------------- | ----------------------------------- |
| Modified | `frontend/src/App.tsx` | No — preserved earlier work         |

## Tests and test configuration (16)

Existing/new unit, integration, harness and browser tests are source files. Generated test reports are not included. Six diagnostic repairs retain meaningful assertions while avoiding secret/page-data disclosure.

| Status   | File                                          | Changed during this delivery audit?              |
| -------- | --------------------------------------------- | ------------------------------------------------ |
| Modified | `frontend/playwright.config.ts`               | No — preserved earlier work                      |
| Modified | `frontend/tests/frontend.spec.ts`             | No — preserved earlier work                      |
| New      | `frontend/tests/paymentCheckout.browser.ts`   | No — preserved earlier work                      |
| New      | `frontend/tests/productAdapters.unit.ts`      | No — preserved earlier work                      |
| New      | `frontend/tests/productSelectors.spec.ts`     | No — preserved earlier work                      |
| New      | `frontend/tests/productUpgrade.spec.ts`       | No — preserved earlier work                      |
| Modified | `frontend/tests/signupHelpers.ts`             | Yes — diagnostic/privacy or strict typing repair |
| Modified | `frontend/tests/sprint2.spec.ts`              | Yes — diagnostic/privacy or strict typing repair |
| New      | `frontend/tests/sprint2Adapters.unit.ts`      | Yes — diagnostic/privacy or strict typing repair |
| New      | `frontend/tests/sprint2Browser.config.ts`     | No — preserved earlier work                      |
| New      | `frontend/tests/sprint2Harness.html`          | No — preserved earlier work                      |
| New      | `frontend/tests/sprint2Harness.tsx`           | No — preserved earlier work                      |
| New      | `frontend/tests/sprint2Production.browser.ts` | Yes — diagnostic/privacy or strict typing repair |
| New      | `frontend/tests/sprint2Unit.config.ts`        | No — preserved earlier work                      |
| New      | `frontend/tests/sprint2Upgrade.spec.ts`       | Yes — diagnostic/privacy or strict typing repair |
| Modified | `frontend/tests/twoFactorSetup.spec.ts`       | Yes — diagnostic/privacy or strict typing repair |

## Earlier whole-product changes outside the four-task modules (48)

Preserved existing changes in authentication/login, registration, dashboard/classes, public-site and shared code. Do not describe this entire group as SCRUM-46–49 or refactor it during handoff.

| Status   | File                                                 | Changed during this delivery audit? |
| -------- | ---------------------------------------------------- | ----------------------------------- |
| Modified | `frontend/src/authentication/AuthForm.tsx`           | No — preserved earlier work         |
| Modified | `frontend/src/authentication/LoginPage.tsx`          | No — preserved earlier work         |
| Modified | `frontend/src/authentication/authService.ts`         | No — preserved earlier work         |
| Modified | `frontend/src/authentication/authentication.css`     | No — preserved earlier work         |
| Modified | `frontend/src/authentication/demoAuthAdapter.ts`     | No — preserved earlier work         |
| Modified | `frontend/src/authentication/formValidation.ts`      | No — preserved earlier work         |
| Modified | `frontend/src/classes/StudentSchedule.tsx`           | No — preserved earlier work         |
| Modified | `frontend/src/classes/classes.css`                   | No — preserved earlier work         |
| New      | `frontend/src/classes/scheduleAdapter.ts`            | No — preserved earlier work         |
| Modified | `frontend/src/classes/scheduleService.ts`            | No — preserved earlier work         |
| Modified | `frontend/src/classes/useStudentSchedule.ts`         | No — preserved earlier work         |
| Modified | `frontend/src/dashboard/CommunityWorkspace.tsx`      | No — preserved earlier work         |
| Modified | `frontend/src/dashboard/CourseCard.tsx`              | No — preserved earlier work         |
| Modified | `frontend/src/dashboard/DashboardContent.tsx`        | No — preserved earlier work         |
| Modified | `frontend/src/dashboard/StudentAccountPanel.tsx`     | No — preserved earlier work         |
| Modified | `frontend/src/dashboard/StudentDashboard.tsx`        | No — preserved earlier work         |
| Modified | `frontend/src/dashboard/StudentProfile.tsx`          | No — preserved earlier work         |
| New      | `frontend/src/dashboard/courseProgress.ts`           | No — preserved earlier work         |
| Modified | `frontend/src/dashboard/dashboard.css`               | No — preserved earlier work         |
| Modified | `frontend/src/dashboard/demoStudentAdapter.ts`       | No — preserved earlier work         |
| Modified | `frontend/src/dashboard/learning.css`                | No — preserved earlier work         |
| New      | `frontend/src/dashboard/learningErrors.ts`           | No — preserved earlier work         |
| Modified | `frontend/src/dashboard/skipCourseApi.ts`            | No — preserved earlier work         |
| Modified | `frontend/src/dashboard/useStudentOverview.ts`       | No — preserved earlier work         |
| Modified | `frontend/src/public-site/AboutPage.tsx`             | No — preserved earlier work         |
| Modified | `frontend/src/public-site/CommunityPage.tsx`         | No — preserved earlier work         |
| Modified | `frontend/src/public-site/HomePage.tsx`              | No — preserved earlier work         |
| Modified | `frontend/src/public-site/NotFoundPage.tsx`          | No — preserved earlier work         |
| Modified | `frontend/src/public-site/ProgramCards.tsx`          | No — preserved earlier work         |
| Modified | `frontend/src/public-site/ProgramsPage.tsx`          | No — preserved earlier work         |
| Modified | `frontend/src/public-site/StartBanner.tsx`           | No — preserved earlier work         |
| Modified | `frontend/src/public-site/public.css`                | No — preserved earlier work         |
| Modified | `frontend/src/registration/RegisterPage.tsx`         | No — preserved earlier work         |
| Modified | `frontend/src/registration/RegistrationComplete.tsx` | No — preserved earlier work         |
| Modified | `frontend/src/registration/RegistrationFields.tsx`   | No — preserved earlier work         |
| Modified | `frontend/src/registration/RegistrationReview.tsx`   | No — preserved earlier work         |
| New      | `frontend/src/registration/enrollmentContract.ts`    | No — preserved earlier work         |
| Modified | `frontend/src/registration/enrollmentService.ts`     | No — preserved earlier work         |
| Modified | `frontend/src/registration/registration.css`         | No — preserved earlier work         |
| Modified | `frontend/src/registration/useRegistration.ts`       | No — preserved earlier work         |
| Modified | `frontend/src/shared/SiteHeader.tsx`                 | No — preserved earlier work         |
| Modified | `frontend/src/shared/SiteLayout.tsx`                 | No — preserved earlier work         |
| Modified | `frontend/src/shared/services/serviceTypes.ts`       | No — preserved earlier work         |
| Modified | `frontend/src/shared/styles/base.css`                | No — preserved earlier work         |
| Modified | `frontend/src/shared/styles/forms.css`               | No — preserved earlier work         |
| Modified | `frontend/src/shared/styles/global.css`              | No — preserved earlier work         |
| Modified | `frontend/src/shared/styles/layout.css`              | No — preserved earlier work         |
| Modified | `frontend/src/shared/styles/shared.css`              | No — preserved earlier work         |

## Handoff documentation (8)

| Status   | File                                         | Changed during this delivery audit? |
| -------- | -------------------------------------------- | ----------------------------------- |
| Modified | `README.md`                                  | Yes — handoff documentation         |
| Modified | `project/docs/BACKEND_INTEGRATION_NEEDED.md` | Yes — handoff documentation         |
| New      | `project/docs/DELIVERY_REVIEW_FILES.md`      | Yes — handoff documentation         |
| Modified | `project/docs/DEPLOYMENT.md`                 | Yes — handoff documentation         |
| Modified | `project/docs/INTEGRATION.md`                | Yes — handoff documentation         |
| Modified | `project/docs/PROJECT_STRUCTURE.md`          | Yes — handoff documentation         |
| Modified | `project/docs/QUALITY_REVIEW.md`             | Yes — handoff documentation         |
| Modified | `project/docs/SPRINT_2.md`                   | Yes — handoff documentation         |

## Suggested commit plan — awaiting user confirmation

1. Review and commit a coherent current frontend demo snapshot after explicitly checking the broader earlier UI/service changes. Suggested title: `feat: prepare current frontend demo snapshot for team review`. Its description must mention that the scope includes earlier whole-product changes, not only SCRUM-46–49.
2. Where hunks can be separated safely, retain the delivery repair as `test: redact authenticator failure diagnostics and fix strict typing` and the handoff as `docs: document SCRUM-46–49 demo evidence and integration gaps`. Some affected tests already contain earlier pending work; review their full diffs before splitting commits.
3. Use an explicit reviewed file/hunk selection, verify the staged diff and rerun relevant checks. Do not use an indiscriminate `git add .`, add artifacts, or push an incomplete subset of interdependent UI/contracts/tests.

These are suggestions only. No commit/push/PR/merge/deploy is authorized yet. After approval, only a normal push to `team` branch `yichen` is proposed, with a fresh remote check and deployment-trigger explanation. `main` and `rewrite/nextjs` remain untouched.
