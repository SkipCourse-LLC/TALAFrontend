# TALA Hub

React and TypeScript frontend with an independent Node.js API, SQLite database and private file storage. The default application does not require Firebase or a cloud account.

## Screenshots

Captured from the local application using fictional accounts and files.

![Student workspace](project/screenshots/student-dashboard.png)

[Learning plan](project/screenshots/learning-plan.png) · [Meetings](project/screenshots/meetings.png) · [Evidence](project/screenshots/evidence.png) · [Mobile workspace](project/screenshots/student-mobile.png) · [HubSpot payments](project/screenshots/tala-hubspot-payments.png)

## Install and run

Use **Node.js 24 or newer**.

```sh
npm ci --prefix frontend
npm run dev --prefix frontend
```

Open **http://127.0.0.1:5173/#/register**. The launcher starts the website on port 5173 and the API on port 8787, and checks an existing API before reusing it. Ctrl+C stops the processes it started. No `.env` file is required; example environment files contain public placeholders only.

## Current functionality

- Interest-first registration: no account or password until Tina records the interview and approves an application. Optional private documents, saved interview reservations, audited admissions review and expiring one-use invitations create a parent account. Existing accounts retain login, logout and account security. Passwords use scrypt; sessions use HttpOnly cookies and mutations require CSRF protection. Email ownership verification, email recovery and MFA are not connected.
- Student sidebar with an Overview, Today tasks, updates, learning plans, meetings, learning records, Evidence and progress. Counts and records come from saved data.
- Calendar with Month, Week, Day and Agenda views, date navigation, teacher/topic/grade/attendance filters, saved meetings and goal dates. Open Classes shares persistent requests, seat counts and status with Calendar, Overview and Progress. Practice fixtures appear only in explicitly enabled previews with an empty local catalog.
- Staff-published local classes with Online/In Person choices, safe versioned editing, private roster CSV, duplicate prevention, capacity and FIFO waiting lists. Students can save classes for later, review full request history, and change a pending request without losing its queue position. Linked authorized parents approve or decline requests; free classes confirm, paid classes remain pending payment. No browser or operator endpoint can mark a payment paid. Cancelling or declining a seat promotes the next waiting request to parent review.
- Staff-published availability with student booking, rescheduling and cancellation. A reservation does not create a Zoom meeting or prove attendance.
- Private text/PDF Evidence up to 5 MiB from saved meetings or the student’s own confirmed classes that have started, written reflections, revision history and manual staff review. Private reflection drafts can be explicitly saved and resumed after signing in; drafts do not count as submitted Evidence.
- Personal goals, preparation notes and learning progress. Goal completion is self-reported; staff notes and review counts do not represent AI assessment or academic credit.
- Parent read-only access to a linked student's permitted records, plus narrowly scoped class approval, after an operator records an approved family connection. A connection is not proof of legal guardianship.

Accounts, sessions and application records persist in ignored `server/.runtime/tala.sqlite`; uploaded files stay under the same private runtime directory. `TALA_DATA_DIR` selects another directory. Data survives refresh, sign-out and server restart, but is stored on this machine with no cloud synchronization. Selected files and unsaved writing remain in memory until submitted or explicitly saved as a reflection draft.

The schema 8 upgrade verifies a private SQLite backup before upgrading an older database. Admissions documents are private SQLite data and included in verified backups. See [server/README.md](server/README.md) for local backup, restore and operator commands, and [server/contract.json](server/contract.json) for API contracts.

## Admin page

`/#/admin` lets allowlisted TALA admins draft, publish, unpublish and delete events and opportunities (Firebase Auth, Firestore `tala_drafts` and `jobs`, Storage `tala_uploads`). Set the `VITE_FIREBASE_*` values from `frontend/.env.example`; rules and schema are in [docs/firebase-rules-snippet.md](docs/firebase-rules-snippet.md).

## Project structure

```text
frontend/src/
  public-site/   public pages
  onboarding/    admission application flow
  product/       signed-in app and admin tools
  api/           API client
  admin/         Firebase-backed events and opportunities admin
  shared/        layout, header, form controls, styles
  authentication/ registration/ payment/ classes/ dashboard/   demo screens
server/          local API (see server/README.md)
docs/            Firebase rules and product documentation
legacy/          original one-page site
```

## Local operator setup

For a new local runtime, explicitly create a fictional admissions administrator:

```sh
node server/operator.cjs create-test-operator --email tina@example.test --name "Tina local test"
```

The command prints a generated test password once and never overwrites an account. Sign in, open Admissions, and publish an interview time. In a separate browser profile, open `/register`, submit a fictional interest form and book the interview. Record the fictional interview as staff, approve it, copy its invitation, and open that link in the parent's browser to create the parent account. No email or real meeting is sent. After parent enrollment, Admissions staff can authorize a seven-day student setup. The signed-in enrolled parent sets separate student credentials and confirms family access; the student account and family link are created together. No public registration or email match bypasses this approval. Additional family links still require separate authorized staff decisions; accounts are never merged automatically by email.

## Checks and service limits

```sh
npm run check --prefix server
npm run lint --prefix frontend
npm run build --prefix frontend
```

For an isolated product review, run `npm run dev:review --prefix frontend`. It starts localhost:5181 with a new temporary fictional runtime on API port 8791, leaves the normal runtime untouched, and writes generated review account instructions into that private temporary directory. The student demo needs no password; review staff can authorize Sam’s setup from Admissions.

The earlier visual demo remains available through `npm run dev:demo --prefix frontend`. Its identities, availability and payments are fixtures. Legacy Firebase tooling is opt-in and separate from the default independent backend.

### Firebase sign-in and access

The `taladev` hosting workflow builds with `VITE_BACKEND_MODE=firebase` and the repository's public Firebase Web App variables. Google or email/password sign-in uses Firebase Auth; after sign-in and each token change the frontend sends the Firebase ID token as a bearer token to `GET https://us-central1-skip-class-slsru4.cloudfunctions.net/me-access/me/access`. Only a verified response matching the signed-in UID, `tala` school and supported student, parent or `talaadmin` role opens the corresponding dashboard. The backend remains responsible for authorization; the frontend route is not a security boundary. Auth, access and network failures do not grant access.

The live dashboards use the student/family hub and operations layouts, without demo records or the local server API. The student Learning Profile calls the authenticated `get-student-graph/curriculum` with the Firebase UID as `student_id` and displays SCV1's curriculum map. It also calls `get-course-progress` and `list-student-projects/mine`; admin statistics use `manage-relationships` and `get-aggregate-admin-stats`. The TALA admissions service lists a parent's active relationships and checks the active link and recorded consent before proxying a selected student's read-only assessment data. Results are shown in the corresponding sections; HTTP, network, authentication and response-contract failures appear in the affected section and in the browser console (`[TALA dashboard]`). Refresh retries the requests.

The map requires the updated `get-student-graph` deployment and its Firestore read permissions. It reuses SCV1 staging's map layout and grouping logic; project links open TALA's existing project detail service. SCV1's account-saved map color customization and mock-data switch are not enabled in TALA.

The student Overview and Evidence sections include file uploads and recent projects. Uploads send a ZIP via authenticated multipart POST to `agentic-pre-processor`; multiple files are packaged locally, and processing may take several minutes. Files total at most 15 MiB and 50 files per submission; the preprocessor skips non-image files over 1 MB and images over 10 MB, and image processing requires its AI model. Audio, video and text-only submissions are not supported here. Projects includes pending and failed jobs as well as completed assessments; completed projects can show extracted submission text and feedback (not the original files). Use Refresh to see updates. The updated backend services must be deployed before these features work. A network failure can occur after a submission is saved; check Projects before retrying.

Classes, updates, learning plans, parent evidence, family learning/progress, evidence review, calendar, booking and billing do not have confirmed matching read contracts in this backend. Their `tala-*` URLs are **diagnostic placeholders**, not working services. Requests still run to expose the actual errors, and a successful JSON response is not treated as an integration until its contract is implemented. The placeholder URLs can be set at build time with `VITE_TALA_CLASSES_URL`, `VITE_TALA_UPDATES_URL`, `VITE_TALA_LEARNING_PLAN_URL`, `VITE_TALA_EVIDENCE_URL`, `VITE_TALA_FAMILY_LEARNING_URL`, `VITE_TALA_FAMILY_PROGRESS_URL`, `VITE_TALA_EVIDENCE_REVIEW_URL`, `VITE_TALA_CALENDAR_URL`, `VITE_TALA_BOOKING_URL` and `VITE_TALA_BILLING_URL`. These requests send the Firebase ID token: configure only trusted endpoints. CSP must also permit any configured origin.

The live admin Admissions panel creates or updates parent and student accounts and links every parent to every student in the submitted family. The admin confirms the overwrite and attests to existing parental consent, including when it was obtained. Other schools' existing school/role values can be overwritten; existing passwords and custom claims are not changed, so permissions granted by other services may remain. The service requires a recently signed-in verified `talaadmin`, and disabled accounts, the current admin's account, and inactive or revoked links require manual review. Account, link, and email operations are not atomic; the panel reports partial failures and supports retry. Firebase password-reset requests are not proof of delivery; existing Google-only users may need to use Google sign-in. Email/password sign-in and email verification are available alongside Google sign-in, but Firebase provider settings and email delivery must be enabled. Existing non-enrolled TALA accounts are not automatically removed.

The admissions service must be deployed separately from `skipcourse-backend-cloud-run` before the panel and linked-student reads work. Its deployment and IAM requirements are documented in that repository's `talaAdmissions/README.md`. Do not deploy or use real student records until those controls, consent evidence and the existing backend security gaps have been reviewed.

The existing backend contracts need security and deployment work before they can safely serve real school records: the student reads and relationship GET routes do not enforce ownership; campus statistics are not TALA-scoped and require `admin`, not `talaadmin`; and service CORS allowlists may reject taladev. Do not rely on the frontend to enforce record access. Browser CORS failures do not by themselves create Cloud Logging entries.

The Web App configuration must identify the `skip-class-slsru4` project and its Firebase Auth domain. Firebase Auth rejects domains that are not authorized in the project. The function must be deployed and reachable, and its origin-to-school/CORS configuration must explicitly allow the HTTPS hosting origin. Localhost is not supported unless configured on the backend. The hosting CSP permits the specific function origin, but CSP alone does not configure backend CORS or Firebase authorized domains. The `tala` workflow uses the default API mode unless separately configured; this change does not deploy or enable Firebase mode there. Emulator and test-cloud modes retain their separate synthetic-data workflows. Run `npm run test:firebase-core --prefix frontend` and `npm run test:me-access --prefix frontend` for isolated mocked checks; these do not verify live access or deployment.

HubSpot's official quarterly and individual-session Checkout links are connected to staff-authorized, persisted payment items in the family portal. Automatic receipt verification still requires authorized server API access and exact receipt-to-item reconciliation; a return URL never proves payment. The legacy visual demo remains separate. See [HubSpot Payments](server/HUBSPOT-PAYMENTS.md) for the implemented boundary, Sponsor confirmations and transaction-free local testing.

Zoom, email delivery/recovery, production MFA and AI assessment remain unconnected. The server binds to loopback and refuses production mode until hosting, HTTPS, recovery, backups and privacy controls are reviewed. Use invented accounts and files; real minors' records, medical information and recordings require sponsor-approved collection and access policies. These commands do not deploy the application.
