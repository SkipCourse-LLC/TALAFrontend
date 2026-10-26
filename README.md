# TALA Hub

TALA's React/TypeScript frontend with an independent Node.js HTTP API, SQLite database and private file storage. The default application does not use Firebase, Firebase Emulator, SkipCourse services or browser-only identity fixtures.

## Install and run

Use **Node.js 24 or newer**. The server uses built-in Node modules and needs no dependency installation.

```sh
npm ci --prefix frontend
npm run dev --prefix frontend
```

Open **http://127.0.0.1:5173/#/register**. The launcher starts the API on `127.0.0.1:8787` and the website on `127.0.0.1:5173`. It reuses an API only after checking its TALA health identity, loaded source revision and selected data directory. An older process or another test database on that port is refused. Ctrl+C stops both new processes; an existing API is never stopped by the launcher.

The student workspace has separate Overview, Updates, Learning plan, Meetings, Learning records, Evidence and Progress views. The address preserves the selected view through refresh and browser navigation. Selected files stay in memory through internal workspace/account navigation; refreshing or closing the tab loses an unsent local file. Server-created unfinished uploads can be recovered separately. Files and credentials are not saved in browser storage.

Learning plans save up to 100 personal goals per student, with optional notes, calendar target dates and up to eight checklist steps per goal. Students can edit, complete or reopen a goal and connect up to 20 saved Evidence versions to it. Unlinking preserves the original files and review history. Saved goals survive refresh, logout and server restart. Parents may view their currently authorized linked student's plan but cannot change it. Version checks reject conflicting edits from another window; retrying the same operation does not create duplicate goals or links. Goal completion and checked steps are self-reported, with no academic credit or verified skill assessment.

Plans can be searched across saved names, notes and checklist steps, and sorted by target date, latest update or name. Text and JSON exports re-read the full saved plan through the authenticated API; filters and unsent edits are excluded. Downloads contain private learning notes, omit account and record-ID fields, and do not include Evidence files or provide account restoration.

Updates collect saved booking changes, published learning summaries and current manual Evidence feedback. Opening a record does not mark it as read; explicit read actions are saved on the server. Parents see the linked student's read status without changing it. This is an in-app view of saved records, with no email or push delivery. Older updates open their corresponding record directly, beyond the first history page.

Before an upcoming meeting, students can save a preparation note, connect a personal goal and mark materials ready. Unsaved notes must be saved or explicitly discarded before rescheduling. Preparation stays with its original reservation after a change or cancellation. This planning state does not confirm meeting attendance. Progress brings together saved goals, checklist steps, Evidence and reviewed learning notes without inferring grades or mastery.

Documents, booking history, availability and learning records support loading older pages. Document searches, learning-summary searches and staff review filters run on the server before pagination, so older work remains discoverable. Booking history also supports an inclusive local From/Through date range, applied to reservation start times before pagination and across daylight-saving boundaries. Learning records use smaller bounded pages. Returning to a tab rechecks the current session and family access before revealing cached records; a failed check keeps them hidden with an explicit retry.

Account security supports changing the current password and viewing or ending your server sessions. Changing a password signs out all other sessions and rotates the current cookie. It requires the current password; email-based password recovery and MFA are still unavailable. Personal calendar exports come from saved reservations; later booking changes do not automatically update an imported calendar file.

No `.env` file or cloud account is required. `frontend/.env.example` contains public placeholders only. The Vite development and preview servers forward `/api` to the local backend.

## What is persistent

Register a student or parent account and sign in using the server's password authentication. Passwords are hashed with scrypt; opaque session cookies are HttpOnly and SameSite, and mutations require a CSRF nonce. Passwords and session credentials are never stored in localStorage. Email delivery is not configured: the application does not claim email ownership verification or send fake verification messages.

Profiles, accounts, sessions, appointments, Evidence metadata, staff-published outcomes, reviews and progress counts are stored in ignored `server/.runtime/tala.sqlite` by default (`TALA_DATA_DIR` can select another directory). Private files live under that runtime directory. Data survives refresh, logout/login and server restart. Stop the API cleanly before copying the whole runtime directory for a local backup. It is local disk persistence, with no cloud sync or hosted production backup.

Operators publish actual availability; the product does not create fictional times or accounts. Students can book, reschedule or cancel available appointments, upload text/PDF Evidence up to 5 MiB, explicitly cancel unfinished uploads, and download their submitted files through an authenticated API. SHA-256, ownership, limits and submission idempotency are checked by the server. Staff can publish meeting outcomes and manually review Evidence. Reviewing Evidence is separate from automated assessment or academic mastery.

Students may also write a reflection of up to 5,000 characters directly in the Evidence form. It becomes a private plain-text file through the same authenticated, checksum-verified upload and review flow. Unsent reflections remain in memory while navigating workspace views; refreshing or closing the tab loses unsent text. Switching formats or signing out asks before discarding unsent work. Saved reflections can be read in document history or downloaded and survive signing out. Text previews verify the private file, render plain text and explicitly shorten content beyond 20,000 characters.

Operators can withdraw unbooked future times without deleting reservation history. Evidence needing revision can receive one new version at a time; earlier files and review notes remain available in authorized document history. Review-version checks reject stale staff edits. Submission totals include all versions; revision counts do not represent grades or academic credit.

The Evidence view can find unexpired unfinished server uploads after navigation or refresh. Finish an already-uploaded file, or reselect the exact original file when its bytes still need uploading. Saved Evidence storage has explicit local limits; no automatic retention deletes existing documents. [Private backup and separate-directory restore commands](server/README.md#explicit-private-backups) are available for local evaluation, without cloud deployment.

The local schema v1/v2/v3→v4 upgrade creates and verifies a private SQLite backup before adding tables. See [server/README.md](server/README.md) for upgrade and separate-directory recovery instructions. The launcher rejects an incompatible older API instead of silently reusing it.

Parent accounts can read a linked student's permitted records after an operator records an approved family connection. They cannot mutate student bookings, files or reviews. A stored connection is not proof of legal guardianship and does not authorize medical data or recordings.

## Operator setup

Create the intended account through the website first. An authorized local operator can then promote that existing account:

```sh
node server/operator.cjs promote --email existing@example.test
```

Sign out and back in to open the operator workspace, where availability and learning outcomes can be published. No role selector grants operator access. The same CLI supports explicit `add-availability` and `link-family` operations; their accepted fields and all HTTP contracts are documented in [server/contract.json](server/contract.json). These commands change only the selected local database, not any team cloud project.

## Limits before hosted production

Zoom links and confirmed attendance, email delivery/recovery, production MFA, AI assessment and real payments are not connected. A saved reservation does not create a Zoom meeting; an elapsed meeting period does not confirm attendance. Staff outcomes, Evidence submissions and review counts are real saved records, without fabricated AI results or charges.

The server binds to loopback and refuses production mode until HTTPS hosting, secure cookie/proxy configuration, backup and retention procedures, recovery and sponsor-approved data/consent policies have been reviewed. Use invented accounts and files for evaluation. Do not introduce real minors' records, medical/disability details or recordings without approved scope and access controls.

## Focused checks and legacy previews

```sh
npm run check --prefix server
npm test --prefix server
npm run test:api-client --prefix frontend
npm run test:product --prefix frontend
npm run test:product-pagination --prefix frontend
npm run test:operator-paging --prefix frontend
npm run test:learning-plan --prefix frontend
npm run test:learning-plan-unit --prefix frontend
npm run test:workspace-updates --prefix frontend
npm run test:learning-workflow --prefix frontend
npm run test:learning-organization --prefix frontend
npm run test:editor-recovery --prefix frontend
npm run test:evidence-notes --prefix frontend
npm run typecheck --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
```

The earlier visual demo remains explicitly available with `npm run dev:demo --prefix frontend`; its identities, meeting availability and payments are fixtures. Existing Firebase commands and source remain opt-in legacy tooling, separate from the independent product. No Firebase configuration, production deployment, real payment or team branch integration is performed by the commands above.
