# TALA Hub

TALA's React/TypeScript frontend with an independent Node.js HTTP API, SQLite database and private file storage. The default application does not use Firebase, Firebase Emulator, SkipCourse services or browser-only identity fixtures.

## Install and run

Use **Node.js 24 or newer**. The server uses built-in Node modules and needs no dependency installation.

```sh
npm ci --prefix frontend
npm run dev --prefix frontend
```

Open **http://127.0.0.1:5173/#/register**. The launcher starts the API on `127.0.0.1:8787` and the website on `127.0.0.1:5173`. It reuses an API only after checking its TALA health identity, refuses unknown occupied ports, and stops only child processes it created. Ctrl+C stops both new processes. An already-running API is left running.

No `.env` file or cloud account is required. `frontend/.env.example` contains public placeholders only. The Vite development and preview servers forward `/api` to the local backend.

## What is persistent

Register a student or parent account and sign in using the server's password authentication. Passwords are hashed with scrypt; opaque session cookies are HttpOnly and SameSite, and mutations require a CSRF nonce. Passwords and session credentials are never stored in localStorage. Email delivery is not configured: the application does not claim email ownership verification or send fake verification messages.

Profiles, accounts, sessions, appointments, Evidence metadata, staff-published outcomes, reviews and progress counts are stored in ignored `server/.runtime/tala.sqlite` by default (`TALA_DATA_DIR` can select another directory). Private files live under that runtime directory. Data survives refresh, logout/login and server restart. Stop the API cleanly before copying the whole runtime directory for a local backup. It is local disk persistence, with no cloud sync or hosted production backup.

Operators publish actual availability; the product does not create fictional times or accounts. Students can book, reschedule or cancel available appointments, upload text/PDF Evidence up to 5 MiB, explicitly cancel unfinished uploads, and download their submitted files through an authenticated API. SHA-256, ownership, limits and submission idempotency are checked by the server. Staff can publish meeting outcomes and manually review Evidence. Reviewing Evidence is separate from automated assessment or academic mastery.

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
npm run typecheck --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
```

The earlier visual demo remains explicitly available with `npm run dev:demo --prefix frontend`; its identities, meeting availability and payments are fixtures. Existing Firebase commands and source remain opt-in legacy tooling, separate from the independent product. No Firebase configuration, production deployment, real payment or team branch integration is performed by the commands above.
