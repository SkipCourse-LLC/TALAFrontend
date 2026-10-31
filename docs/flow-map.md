# Onboarding flow map and reuse audit

SCRUM-67. Status: **draft, waiting for PO approval** (see [Approval](#approval)).

This maps every step of the new parent onboarding flow to what already exists in this repo, says whether each screen is reused, adapted or new, lists the fields every screen shares, and names the two registration wizards to retire.

Labels:

- **Reuse**: works for the new flow as it is.
- **Adapt**: an existing screen or API is the starting point but needs changes.
- **New**: nothing usable exists yet. "Built" means a functional version landed in Sprint 3 and is ready for design.

Paths are relative to `frontend/src/` unless they start with `server/`.

## The flow

1. Parent presses **Start**.
2. Parent chooses **Contact me** or **Schedule a time**.
   - **Contact me:** pick the days and times they are free → choose how to be contacted → enter contact details → confirm → request submitted.
   - **Schedule a time:** pick one of Tina's open times → choose Zoom or phone → enter contact details → confirm → meeting booked.
3. Email confirmation.
4. Zoom (or phone) meeting with Tina.
5. Tina creates the student's TALA email and login.
6. Student signs up.
7. Parent pays.
8. Student chooses classes.

## Step-by-step map

### Start

| # | Step | Existing screen or API | Label | Notes | Design owner |
| --- | --- | --- | --- | --- | --- |
| 1 | Start button | Home hero "Start registration" button (`public-site/HomePage.tsx`), header "Enrollment" link (`shared/SiteHeader.tsx`), "Explore registration demo" on `public-site/CommunityPage.tsx` | Adapt | Point these at the new start choice instead of `/register`. | Shelby |
| 2 | Choose Contact me or Schedule a time | None | New | A two-option screen. `/contact` and `/schedule` already link to each other. | Shelby |

### Contact me path

| # | Step | Existing screen or API | Label | Notes | Design owner |
| --- | --- | --- | --- | --- | --- |
| 3 | Pick days and times | `onboarding/ContactRequestPage.tsx` step 1 | New (built) | Weekday × morning/afternoon/evening grid in Tucson time. The API accepts any `HH:MM` window, so the design can change the grid freely. | Shelby |
| 4 | How to be contacted | `ContactRequestPage.tsx` step 2 | New (built) | Email, phone call or text message. | Shelby |
| 5 | Contact details | `ContactRequestPage.tsx` step 3, using `shared/TextField.tsx` | Adapt | Same name and email rules as `registration/enrollmentContract.ts` and Sherry's parent step; adds phone. | Shelby |
| 6 | Confirm | `ContactRequestPage.tsx` step 4 | Adapt | Follows the review pattern of `registration/RegistrationReview.tsx`. | Shelby |
| 7 | Submitted | `ContactRequestPage.tsx` receipt view; `POST /api/contact-requests` | New (built) | Shown only after the server returns a receipt. No email is sent yet. | Shelby |
| – | Tina sees the request | `product/ContactRequestsPanel.tsx` (Contact requests tab in the operator workspace) | New (built) | Lists requests by status; Tina marks them contacted or closed. | Yichen |

### Schedule a time path

| # | Step | Existing screen or API | Label | Notes | Design owner |
| --- | --- | --- | --- | --- | --- |
| 8 | Calendar of Tina's open times | `onboarding/OpenTimesPage.tsx` at `/schedule`; `GET /api/public/open-times`. Signed-in booking calendar in `product/MeetingPanel.tsx` | Adapt | The public list is built and read-only. MeetingPanel's day grouping and calendar are the base for a pickable calendar. | Sherry |
| 9 | Zoom or phone | None. Sherry's `ZoomMeetingStep` (old branch) collects a date, time and notes | New | Needs a `meetingType` field on the booking. | Sherry |
| 10 | Contact details | `ContactRequestPage.tsx` step 3 | Reuse | Same fields and rules as step 5. | Sherry |
| 11 | Confirm | `ContactRequestPage.tsx` step 4 pattern | Reuse | | Sherry |
| 12 | Booked | `POST /api/appointments` (`server/services.cjs` `reserve`) | Adapt | Booking requires a signed-in student today. A parent has no account yet, so this needs a public, rate-limited booking endpoint and its own table (see the data model doc). | Sherry |

### After the first contact

| # | Step | Existing screen or API | Label | Notes | Design owner |
| --- | --- | --- | --- | --- | --- |
| 13 | Email confirmation | None. The server has no email provider (`/api/health` reports `emailDelivery: unavailable`) | New | Needs a provider decision and templates. | Sherry |
| 14 | Zoom meeting | None. Appointments report `meetingIntegration: unavailable` | New | Tina can paste a Zoom link by hand until an integration exists. | Sherry |
| 15 | Tina creates the student's TALA email and login | None. Today accounts are self-service (`POST /api/auth/register`) and the only admin tool is the `promote` CLI | New | Admin screen plus an operator-only provisioning API. | Yichen |
| 16 | Student signs up | `product/ServerAccessPage.tsx` (register) | Adapt | Change from open sign-up to claiming the account Tina created (set a password on first sign-in). | Yichen |
| 17 | Parent pays | `payment/PaymentPage.tsx`, `payment/ApprovalPage.tsx` (demo only); api mode shows "Payment service not connected" | Adapt (UI), New (provider) | No provider or fee schedule is approved. | TBD |
| 18 | Student chooses classes | `classes/StudentSchedule.tsx` and the "Available class slots" view in `dashboard/StudentDashboard.tsx` (demo data) | Adapt | Needs real class data, probably from SkipCourse. | TBD |

### Admin screens used along the way

| Screen | Where | Label |
| --- | --- | --- |
| Tina's availability (add, edit, withdraw) | Operator workspace → Meetings (`product/OperatorWorkspace.tsx`) | Reuse. Edit was added in Sprint 3. |
| Booked meetings | Operator workspace → Meetings → Recent bookings | Adapt once parents can book without an account. |
| Contact requests | Operator workspace → Contact requests | New (built). |
| Student account provisioning | None | New. |

## Shared fields and validation

One set of rules for parent, student and admin screens. The server is the authority; screens check the same rules first so people see errors early. Contact request rules live in `server/contactRequests.cjs` and `onboarding/contactRequestForm.ts`.

| Field | Used on | Rule |
| --- | --- | --- |
| Parent or guardian name | Contact details (both paths), admin lists | Required. 1–80 characters after trimming. No control characters. |
| Email | Contact details, sign-in | Required. Up to 254 characters, `name@domain.tld` shape. Stored in lowercase. |
| Phone | Contact details | Required. 10–15 digits. Only digits, spaces and `+ ( ) . -`, up to 30 characters. |
| Preferred contact method | Contact me | Required. `email`, `phone` or `text`. |
| Availability windows | Contact me | 1–21 windows. Each is a weekday plus `HH:MM` start and end (24-hour), end after start, no repeats. Tucson time (`America/Phoenix`, no daylight saving). |
| Meeting type | Schedule a time | Proposed: `zoom` or `phone`. |
| Meeting time | Schedule a time, admin availability | An existing open time ID. Admin times: ISO 8601 with an explicit offset, in the future, 15 minutes to 4 hours, no overlap with another published time. |
| Notes | Contact me, Schedule a time | Optional. Up to 1,000 characters. The form asks people not to include medical or other sensitive details. |
| Student name | Admin provisioning, student sign-up | Required. 1–80 characters. |
| Student TALA email | Admin provisioning | Issued by Tina. Format still to be agreed. |
| Password | Student sign-up, sign-in | 12–128 characters (server rule). The demo wizard's 8-character rule is retired with it. |
| Role | All signed-in screens | `parent`, `student` or admin (`operator` in code). People can sign up only as parent or student. |
| Request ID | Every create or change request | 16–128 characters of `A-Z a-z 0-9 _ -`, generated once per form so retries are not duplicated. |

We deliberately do **not** collect these before the first conversation: passwords, government ID numbers or documents, dates of birth, gender, home address, or anything about health or disability. Sherry's old wizard asked for most of these up front.

**Still to confirm with Tina and Karl:** which contact fields are required (the code currently requires name, email, phone, method and at least one time window, with notes optional), whether phone should be optional when the parent picks email, and the time windows offered.

## Registration wizards to retire

### 1. Yichen's six-step demo wizard (this repo)

- **Files:** `frontend/src/registration/` (`RegisterPage.tsx`, `RegistrationFields.tsx`, `RegistrationReview.tsx`, `RegistrationComplete.tsx`, `enrollmentContract.ts`, `enrollmentService.ts`, `useRegistration.ts`, `registration.css`).
- **Steps:** parent account, student information, enrollment information, required documents, funding preference, review.
- **Where it runs:** `/register` in demo mode only (`App.tsx` `DemoApplication`). The demo two-factor page and dashboard read its `EnrollmentReceipt`. `tests/frontend.spec.ts` and `tests/sprint2.spec.ts` cover it.
- **Keep:** the step indicator markup, the review screen pattern and the field checks that match the table above.
- **Why retire:** it creates passwords and collects enrollment and funding choices before anyone has talked to TALA, which the new flow moves to after the meeting.

### 2. Sherry's five-step EnrollmentWizard (old Next.js branch)

- **Location:** branch `origin/Sherry` of `Tucson-Adaptive-Learning-Academy/Frontend` (not this repo), last commit `1ef4ea5` "Registration UI" (5 Oct 2026). Files: `components/register/*` and `app/(marketing)/register/page.tsx`.
- **Steps:** parent/guardian, ID verification, students, review, Zoom meeting.
- **Keep:** the idea of the Zoom step (date, time, notes) for the Schedule path, and the stepper.
- **Why retire:** it asks for parent and student passwords, a government ID number, date of birth and an ID document upload before the first conversation.

**Retirement plan:** nothing is deleted yet. After PO approval, one change removes `frontend/src/registration/`, its demo routes and tests, and points `/register` and the "Enrollment" link at the new start screen. Sherry's branch is left as is and marked superseded.

## Test coverage

The Jira test IDs below map to sections of this document.

| Test | What it checks | Where |
| --- | --- | --- |
| T3-1 | Every step of both paths, through class selection, is mapped to existing screens | [Step-by-step map](#step-by-step-map) |
| T3-2 | Each step is labelled reuse, adapt or new | Label column in every table |
| T3-3 | One shared field list with validation rules for parent, student and admin screens | [Shared fields and validation](#shared-fields-and-validation); enforced by `server/test/contactRequests.test.mjs` (T3-52) and `frontend/src/onboarding/onboarding.browser.ts` |
| T3-4 | The two registration wizards to retire are identified | [Registration wizards to retire](#registration-wizards-to-retire) |
| T3-5 | PO approval | [Approval](#approval) |

## Approval

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Product owner | | ☐ Approved ☐ Changes needed | |
| Design (Shelby, Sherry, Yichen) | | ☐ Agreed | |
| Tina (admin) | | ☐ Required fields confirmed | |

Comments:
