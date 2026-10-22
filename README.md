# TALA Frontend

The website and student hub for Tucson Adaptive Learning Academy (TALA). A React and TypeScript app built with Vite, plus a small Node.js API with a SQLite database for local development.

## Run it locally

Requires Node.js 24 or newer.

```sh
npm ci --prefix frontend
npm run dev --prefix frontend
```

This starts the API on `127.0.0.1:8787` and the site on <http://127.0.0.1:5173>, with live reload. Data is saved to `server/.runtime/`, which Git ignores.

To click through every screen with sample data and no API, run `npm run dev:demo --prefix frontend` instead.

### Admin access

Create an account on the site, then promote it:

```sh
node server/operator.cjs promote --email you@example.test
```

Sign out and back in to open the operator workspace, where you publish meeting times, review bookings and uploads, and follow up contact requests.

## What works today

| Area | Status |
| --- | --- |
| Accounts, password sign-in, sessions | Real, through the local API |
| Admin meeting availability (add, edit, withdraw) | Real |
| Open meeting times for parents without an account (`/schedule`) | Real, read-only |
| "Contact me" requests (`/contact`) and the admin request list | Real, through the local API |
| Booking, rescheduling and cancelling meetings | Real, for signed-in students |
| Evidence uploads and staff review | Real |
| Parent read-only access to a linked student | Real, once an admin links them |
| Two-factor sign-in, payment, class schedule, enrollment wizard | Demo screens with sample data |
| Email, Zoom, payments, SkipCourse backend | Not connected |

## Project layout

```text
frontend/          the website
  src/public-site/   home, about, programs and community pages
  src/onboarding/    Contact me form and public open times
  src/product/       the signed-in app: meetings, workspaces, operator tools
  src/api/           client for the local API
  src/authentication/ sign-in, plus the demo two-factor flow
  src/registration/  demo enrollment wizard
  src/payment/       demo payment and approval screens
  src/classes/       demo class schedule
  src/dashboard/     demo student dashboard
  src/shared/        layout, header, form controls and styles
server/            the local API (see server/README.md)
docs/              onboarding flow map; sign-in and data model proposal
legacy/            the original one-page site
```

## Checks

```sh
npm run typecheck --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
npm test --prefix server
npm run test:product --prefix frontend
npm run test:onboarding --prefix frontend
```

## Deployment

The site is hosted on Firebase Hosting in the `skip-class-slsru4` project, target `tala` (site `tucsonala`, domain `talaedu.com`). `npm run build:hosting --prefix frontend` builds the site into `public/`, which is the folder `firebase.json` serves.

The **Deploy to Firebase Hosting (tala)** workflow runs only when started by hand from the Actions tab. Hosting serves static files only. The local API does not run there, so sign-in and booking need a hosted backend before they work on the live site.

## Data and privacy

The site handles information about children, families and health needs. Use invented accounts and files when testing, and never commit the `server/.runtime/` data, backups or real student records.
