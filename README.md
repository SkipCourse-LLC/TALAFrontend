# TALA Hub

Tucson Adaptive Learning Academy, built with React, TypeScript and Vite. `frontend/` contains the application; `backend/` contains Firebase services for the local Emulator and a separately approved, synthetic-data test project. No actual cloud project is connected. SkipClass production is disabled and has not been modified.

## Firebase integration (local, synthetic data only)

Requires Java 21 and Node.js `^22.13.0 || >=24`. Backend tooling pins its own Node 24.12 runtime without changing the system installation.

```sh
npm ci --prefix backend
npm ci --prefix backend/functions
npm ci --prefix frontend
npm run emulators --prefix backend
```

Leave that terminal open. In another terminal:

```sh
npm run seed --prefix backend
npm run dev:firebase --prefix frontend
```

Open **http://127.0.0.1:5176/#/register**. Create an invented `@example.test` student with a unique test password. Firebase Auth creates the account; a callable provisions `users/{uid}` and issues the student claim. No client role selector grants access. Use the email-verification action link printed in the emulator terminal, then select **I have verified my email** in the workspace. No real email is sent locally.

You can save a profile name, reserve/cancel/reschedule a synthetic slot, and submit a synthetic `.txt`/`.pdf` file up to 5 MiB. Published meeting records and staff outcomes can be read and marked reviewed; review counts persist without awarding grades. Server-confirmed family links are read-only. Auth sessions survive refresh and sign-out/sign-in; Firestore/Storage hold profiles, bookings, records, reviews, Evidence and submission counts. Stop the backend once with Ctrl+C and wait for export to complete: the next launch imports ignored `backend/.emulator-data/`. This is local persistence, not permanent cloud storage or a production backup. Do not use real student, medical, disability, payment or recording data.

The backend verifies UID, current server-issued role, verified email, revoked sessions, slot availability, upload ownership, bytes, SHA-256, type/size and idempotency. Submitted files are promoted to immutable server-only storage and their staging uploads removed. The UI creates no public download links; unfinished Firebase staging uploads still require a retention/cleanup policy before real data is permitted. File download is not yet exposed. A saved booking or an elapsed appointment is **not** a Zoom meeting or attendance confirmation. Submitted Evidence and reviewed outcomes are **not** AI assessments or academic mastery results.

The existing 2FA UI is preserved in preview mode. The Firebase security page has genuine SDK TOTP enrollment/sign-in integration behind explicit approval flags; local Auth Emulator does not support TOTP. Identity Platform, enabled factors, recovery and role-based MFA policy still need team confirmation. No new universal MFA restriction is imposed. Payment UI remains; Firebase mode cannot grant payment eligibility or charge money until the team approves a provider and authoritative eligibility API.

`dev:firebase` forces all four services to loopback `demo-tala-local` and disables cloud access. An unavailable emulator never falls back to SkipClass. Browser Firebase SDK config is public app configuration, **not** an Admin SDK credential. Never place private keys or service credentials in client code or `VITE_*`.

## Approved isolated test cloud (configuration ready; not connected)

Sponsor must first provide an authorized **separate test project**, Web App configuration, service permissions and reviewed test deployment. Do not use SkipClass or deploy the example Rules automatically. `backend/test-cloud.firebase.json` is a review artifact; its Storage rule deliberately denies access until the approved bucket placeholder is replaced during an authorized deployment. Server configuration uses managed identity, an explicit synthetic-student allowlist and approved origins. See [backend/README.md](backend/README.md).

After that approval and service setup, copy `frontend/.env.firebase-test.example` to ignored `frontend/.env.firebase-test.local`; fill only the supplied public SDK settings and set the test approval flag. Then run:

```sh
npm run dev:test-cloud --prefix frontend
```

Open **http://127.0.0.1:5177/#/login**. The same Auth/data/upload adapters use `tala_test_*` collections. Before initializing any Firebase SDK service, a read-only public Auth configuration request must confirm the approved Project ID, Web App and Auth domain. Invalid, unavailable or mismatched configuration stops initialization. Production mode and `skip-class-slsru4` are rejected even if old approval flags are set.

Only invented `@example.test` accounts are supported; the backend allowlist controls profile provisioning. Test email verification/recovery requires the authorized operator; no email is sent to synthetic addresses. Google sign-in is disabled to avoid creating real Google users. Test-cloud account creation, deployment and any billing changes still require Sponsor approval. No cloud end-to-end verification has been performed.

Targeted verification (emulators running):

```sh
npm run check --prefix backend
npm run test:runtime --prefix backend
npm run test:integration --prefix backend
cd frontend
npm run typecheck
npm run lint
npm run build
npm run test:firebase-core
npm run test:firebase-browser
npm run test:cloud-boundary
```

See [backend/README.md](backend/README.md) for the provisional local contract and [integration blockers](project/docs/BACKEND_INTEGRATION_NEEDED.md) for the read-only SkipCourse audit. Nothing in `backend/` is approved for production deployment.

## Existing presentation preview

Use Node.js `^22.13.0 || >=24`:

```sh
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/#/`.

To check and preview a build locally:

```sh
npm run build
npm run preview
```

The build includes TypeScript checking. No `.env` file is required for the default presentation preview (`VITE_BACKEND_MODE=demo`). `frontend/.env.example` contains public flags and empty SDK configuration placeholders. Disabling `VITE_DEMO_MODE` alone does not enable live APIs. The limitations below describe this preserved preview, not the Firebase Emulator integration above.

- **Authentication:** signup offers a locally generated Authenticator QR/manual key and browser-side TOTP verification. Email uses public sample code `246810` without sending a message. Login, roles and sessions are demo fixtures; no real identity provider or server-enforced MFA is connected. Existing sample login remains available without universal 2FA enforcement.
- **Checkout:** sample Parent login → Enrollment status & payment → Approved (demo) → Continue to payment → Private → Use demo card → acknowledge → Pay with demo card. Approval is a mock enrollment/payment state, separate from meeting appointments. Card, bank, billing and contact details are fixed fake samples; the $0.00 result is simulated and makes no charge.
- **Data:** learning records and class choices are sample data. Use invented details. Registration drafts, verification challenges, approvals and payment receipts reset on refresh; demo identity/class choices may survive within the same browser tab. Real registration, authorization, recovery, eligibility and payment confirmation require agreed backend integrations.
