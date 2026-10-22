# Authentication provider and data model

SCRUM-75. Status: **proposal, needs team and PO approval** (see [Approval](#approval)). Nothing in this document changes the sign-in provider. Sprint 3 only built the parts of the model that SCRUM-76 and SCRUM-77 need: availability editing, the public open-times read and the `contact_requests` table.

## 1. What runs today

### Sign-in in the local API

The local API (`server/`) has its own accounts. There is no outside provider.

| Part | How it works today | Code |
| --- | --- | --- |
| Accounts | `users` table in SQLite. Email is unique (case-insensitive). People sign up as `student` or `parent`; `operator` (admin) is only granted with `node server/operator.cjs promote`. | `server/application.cjs` (`/api/auth/register`), `server/database.cjs` |
| Passwords | 12–128 characters, hashed with scrypt (N=131072, r=8, p=1) and a random salt. Hashes run one at a time, and more than 8 waiting requests are refused. | `server/security.cjs` |
| Sessions | A random 256-bit token in an `HttpOnly; SameSite=Strict; Path=/api` cookie named `tala_session`. Only its SHA-256 hash is stored in `sessions`. | `server/application.cjs` |
| CSRF | Each session has a CSRF token. Every POST, PUT and PATCH must send it as `X-CSRF-Token` and come from an allowed `Origin`. | `server/application.cjs` |
| Identity check | The client sends `X-TALA-User` with the UID it thinks is signed in. A mismatch returns 401, so a tab never acts as a different account after another tab switches users. | `frontend/src/api/client.ts` |
| Not built | Email verification, password reset, two-factor sign-in (the 2FA screens are demo only). | |

### Dev setup (T3-40)

- `npm ci --prefix frontend` then `npm run dev --prefix frontend` starts the API on `127.0.0.1:8787` and the site on `127.0.0.1:5173`. Vite proxies `/api` so the cookie stays same-origin.
- No keys or provider config are needed. `frontend/.env.example` holds only `VITE_BACKEND_MODE`, `VITE_DEMO_MODE` and `VITE_DEMO_TOOLS`.
- Data lives in `server/.runtime/` (git-ignored). Make an admin with `node server/operator.cjs promote --email you@example.test`.
- `npm run dev:demo --prefix frontend` runs every screen with sample data and no API.

### Hosting

The site is static on Firebase Hosting (project `skip-class-slsru4`, site `tucsonala`). `firebase.json` rewrites every path to `index.html`, so there is no `/api` on the live site and sign-in only works locally. Whatever we choose, the API needs a hosted home before parents can use it.

## 2. Provider options

| | A. Firebase Authentication | B. Keep our own sign-in and host it | C. Another managed provider (Auth0, Clerk, Supabase Auth) |
| --- | --- | --- | --- |
| Fits our hosting | Same Google Cloud project as Hosting (`skip-class-slsru4`). | Needs a hosted Node service and a database that is not a local SQLite file. | Another vendor and account to manage. |
| SkipCourse | Can share users with SkipCourse if SkipCourse uses the same Firebase project. **Needs confirming.** | No shared identity. | No shared identity. |
| Password reset, email verification | Built in, with email templates. | We would have to build them and choose an email provider. | Built in. |
| Two-factor sign-in | Available after upgrading to Identity Platform. | We would build it. | Built in on most paid plans. |
| Roles | Custom claims set by our server with the Admin SDK, mirrored in our database. | Already in `users.role`. | Provider metadata or our database. |
| Sessions | Keep HttpOnly cookies by exchanging the ID token for a Firebase session cookie on our server (5 minutes to 2 weeks; can be revoked). | Already built and tested. | Provider SDK sessions, usually tokens in the browser. |
| Cost | Free for a school of this size on current tiers. Identity Platform features are billed per active user. Confirm on the pricing page. | Hosting and database cost; our time to build and run it. | Free tiers, then per user. |
| Risks | Vendor lock-in; a new client SDK dependency; the API still has to verify every request. | We own every security fix; more to build before launch. | Same as A, without the SkipCourse or hosting fit. |

### Recommendation

**Option A, Firebase Authentication**, as Jira suggests, because it lives in the same project as our hosting, may share users with SkipCourse, and gives us password reset and email verification without building them. Keep these parts of today's design:

- **Server-side session cookies.** The browser signs in with the Firebase SDK, sends the ID token once to `POST /api/auth/session`, and our API sets an `HttpOnly; SameSite=Strict` session cookie (Admin SDK `createSessionCookie`). No tokens in `localStorage`.
- **Roles in our database**, copied into custom claims for fast checks. The API still checks the database before any admin action.
- **The API decides access.** Firestore or Storage security rules are not our access layer unless the team decides to move data there.

Open questions before approval:

1. Does SkipCourse use `skip-class-slsru4` for its users, and may TALA accounts live there?
2. Where will the API run (Cloud Run behind a Hosting rewrite of `/api/**` keeps cookies same-origin)? And which database (Cloud SQL Postgres is the closest match to today's tables)?
3. Do we need parental consent records for students under 13 (COPPA), and what FERPA duties apply? Check with Karl.

### What configuring Firebase Auth in dev would take

1. Install `firebase-tools` and add an `emulators.auth` block to `firebase.json` so local sign-in never touches the real project.
2. Add the public web config as `VITE_FIREBASE_*` values in `.env.example` (these are not secrets) and connect the client SDK to the emulator in dev.
3. Give the API the Admin SDK with Application Default Credentials. Never commit a service account key; `.gitignore` already blocks `service-account*.json`.
4. Add `POST /api/auth/session` (ID token → session cookie) and replace the password checks in `server/application.cjs` with `verifySessionCookie(cookie, true)`. CSRF, origin checks and `X-TALA-User` stay.
5. Existing local accounts are test data, so they do not need migrating. If real accounts exist by then, `firebase auth:import` accepts standard scrypt hashes; test it with one synthetic account first.

## 3. Roles

| Role | In code | How someone gets it | Can do |
| --- | --- | --- | --- |
| Visitor (parent before an account) | no session, or an anonymous session | Visiting the site | Read open times, send a contact request. Proposed: book an intake meeting. |
| Parent | `parent` | Signs up, or (proposed) Tina invites them after the meeting | Read a linked student's records. Proposed: pay, approve class choices. |
| Student | `student` | Today: signs up. Proposed: claims the account Tina provisions | Book and manage their own meetings, upload work, read their records. Proposed: choose classes. |
| Admin (Tina) | `operator` | `node server/operator.cjs promote` | Everything below marked admin. |

## 4. Data model

Existing tables are schema 3 in `server/database.cjs`. Proposed tables are not built.

| Entity | Table | Status | Key fields |
| --- | --- | --- | --- |
| User | `users` | Exists | `uid`, `email` (unique), `name`, `password_hash`, `role` (student, parent, operator), `email_verified`, `disabled`, `created_at`. With Firebase, `uid` becomes the Firebase UID and `password_hash` goes away. |
| Session | `sessions` | Exists | `token_hash`, `uid` (null for anonymous), `csrf_token`, `expires_at`, `created_at` |
| Parent–student link | `family_links` | Exists | `student_uid`, `parent_uid`, `consent_reference`, `status` (active, revoked), `recorded_at` |
| Student record | `student_records` | Proposed | `student_uid`, `preferred_name`, `tala_email` (issued by Tina), `grade_band`, `status` (invited, active, withdrawn), `provisioned_by`, `source_request_id` (contact request or booking), `created_at` |
| Availability | `slots`, `availability_state` | Exists | `id`, `starts_at`, `ends_at`, `label` (staff only), `status` (published, withdrawn), `updated_by`. Times are never changed in place; an edit publishes a new slot. |
| Contact request | `contact_requests` | **Built in Sprint 3** | `id`, `request_id` (unique, for retries), `fingerprint`, `parent_name`, `email`, `phone`, `preferred_method` (email, phone, text), `availability_json` (weekday and `HH:MM` windows, Tucson time), `notes`, `status` (new, contacted, closed), `created_at`, `updated_at`, `updated_by` |
| Booking (student) | `appointments` | Exists | `id`, `owner_uid` (student), `slot_id`, `status` (reserved, cancelled, ended). One active booking per student and per slot. |
| Booking (parent intake) | `intake_bookings` | Proposed | `id`, `request_id`, `slot_id` (one active per slot), `parent_name`, `email`, `phone`, `meeting_type` (zoom, phone), `meeting_link`, `status` (booked, cancelled, held, no_show), `created_at`. Separate from `appointments` because there is no account yet. |
| Payment | `payments` | Proposed | `id`, `student_uid`, `payer_uid` (parent), `amount_cents`, `currency`, `provider`, `provider_reference`, `status` (pending, paid, failed, refunded), `created_at`. Card details never touch our servers. |
| Class | `classes` | Proposed (or read from SkipCourse) | `id`, `title`, `term`, `schedule`, `capacity` |
| Class enrollment | `class_enrollments` | Proposed | `id`, `student_uid`, `class_id`, `status` (selected, confirmed, dropped), `selected_at`, `confirmed_by`. Unique per student and class. |
| Idempotency log | `operations` | Exists | `uid`, `kind`, `request_id`, `fingerprint`, `result_json`. Stores IDs only, never contact details. |

Privacy rules that apply to every table: contact details and student records are never logged, never sent to the browser of anyone without access, and test data is always synthetic.

## 5. Session contract

| Topic | Contract today | With Firebase (proposed) |
| --- | --- | --- |
| Login state | `GET /api/session` returns `{ session: User or null, csrfToken }`. It creates an anonymous session when there is none. | Same response; the API reads the Firebase session cookie. |
| Sign in | `POST /api/auth/login` checks the password, deletes the old session and sets a new cookie and CSRF token. | Client signs in with Firebase, then `POST /api/auth/session` sets the cookie. |
| Expiry | Signed in: 12 hours from sign-in, not extended by activity. Anonymous: 1 hour. Expired sessions read as signed out. | Session cookie lifetime set to 12 hours to match. |
| Logout | `POST /api/auth/logout` deletes the session and returns a fresh anonymous one. The old cookie stops working. | Same, plus `revokeRefreshTokens(uid)` when signing out everywhere. |
| Sign out elsewhere | `POST /api/account/sessions/revoke` and `/revoke-others`. A password change ends every other session. | `revokeRefreshTokens` and `verifySessionCookie(cookie, true)`. |
| Client behaviour | On 401 the app returns to sign-in and never retries a change automatically. Forms keep their request ID so a manual retry is safe. | Unchanged. |

## 6. Access rules

The API enforces these on every request; the screens only hide what people cannot use. "Linked" means an active `family_links` row.

| Action | Visitor | Parent | Student | Admin |
| --- | --- | --- | --- | --- |
| Read open meeting times (`GET /api/public/open-times`) | Yes | Yes | Yes | Yes |
| Send a contact request (`POST /api/contact-requests`) | Yes (rate limited) | Yes | Yes | Yes |
| Read or change contact requests | No | No | No | Yes |
| Add, edit, withdraw availability | No | No | No | Yes |
| Book a meeting | Proposed: intake booking only | No (read-only today) | Own | For a student |
| Read a student's workspace, evidence, learning records | No | Linked student, read-only | Own | All |
| Upload evidence | No | No | Own | For a student |
| Acknowledge learning summaries | No | No | Own | No |
| Review evidence, publish summaries | No | No | No | Yes |
| Create a student account (proposed) | No | No | No | Yes |
| Pay (proposed) | No | For a linked student | No | Read |
| Choose classes (proposed) | No | Read, maybe approve | Own | All |

## 7. Test coverage

| Test | What it checks | Evidence |
| --- | --- | --- |
| T3-40 | Provider configured in dev | The current provider (local API) runs in dev with no setup, described in [Dev setup](#dev-setup-t3-40). The recommended provider is **not** configured yet because it needs approval; [the steps](#what-configuring-firebase-auth-in-dev-would-take) are listed. |
| T3-41 | Users and roles are defined | [Roles](#3-roles), [Data model](#4-data-model); `server/test/sessionContract.test.mjs` checks that people can only sign up as parent or student. |
| T3-42 | Login state, expiry and logout behave as documented | [Session contract](#5-session-contract); `server/test/sessionContract.test.mjs` (expiry, logout, cookie flags) and `server/test/account.test.mjs` (session revocation). |
| T3-43 | Role-based access is enforced | [Access rules](#6-access-rules); `server/test/availabilityManagement.test.mjs` (T3-50), `server/test/contactRequests.test.mjs` (T3-55), `server/test/readAuthorization.test.mjs`. |
| T3-44 | Data model covers users, roles, students, availability, contact requests, bookings, payments and enrollments | [Data model](#4-data-model), then [Approval](#approval). |

## Approval

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Product owner | | ☐ Option A ☐ Option B ☐ Option C ☐ Needs changes | |
| Team | | ☐ Data model agreed | |
| SkipCourse contact | | ☐ Shared Firebase project confirmed | |

Comments:
