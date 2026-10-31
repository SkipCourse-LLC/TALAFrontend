# TALA Frontend

The public-facing website for **Tucson Adaptive Learning Academy (TALA)**, a year-round school serving medically fragile and wheelchair-dependent children in Tucson, Arizona.

## Live site

<https://talaedu.com> (Firebase Hosting). The earlier one-page site ran at [talaedu.vercel.app](https://talaedu.vercel.app); its code and original README are in `legacy/`.

## Overview

The website and student hub: public pages, a "Contact me" request form, Tina's open meeting times, and a signed-in workspace for students, parents and admins. Built with React and TypeScript (Vite), plus a local Node.js/SQLite API for development. Sign-in and other backend features are not hosted yet.

## Run locally

Node.js 24+.

```sh
npm ci --prefix frontend
npm run dev --prefix frontend
```

Site: <http://127.0.0.1:5173>. API: `127.0.0.1:8787`. Data: `server/.runtime/` (git-ignored).
Sample data, no API: `npm run dev:demo --prefix frontend`.

**Admin:** register on the site, then `node server/operator.cjs promote --email you@example.test` and sign in again.

## Status

| Real (local API) | Demo only | Not connected |
| --- | --- | --- |
| Accounts and sessions; meeting availability (add, edit, withdraw); public open times (`/schedule`); Contact me requests (`/contact`) and the admin request list; student booking; Evidence uploads and review; parent read access | Two-factor, payment, class schedule, enrollment wizard | Email, Zoom, payments, SkipCourse backend |

## Admin page

`/#/admin` lets allowlisted TALA admins draft, publish, unpublish and delete events and opportunities (Firebase Auth, Firestore `tala_drafts` and `jobs`, Storage `tala_uploads`). Set the `VITE_FIREBASE_*` values from `frontend/.env.example`; rules and schema are in [docs/firebase-rules-snippet.md](docs/firebase-rules-snippet.md).

## Project structure

```text
frontend/src/
  public-site/   public pages
  onboarding/    Contact me form, public open times
  product/       signed-in app and admin tools
  api/           API client
  admin/         Firebase-backed events and opportunities admin
  shared/        layout, header, form controls, styles
  authentication/ registration/ payment/ classes/ dashboard/   demo screens
server/          local API (see server/README.md)
docs/            onboarding flow map; sign-in and data model proposal
legacy/          original one-page site
```

## Checks

```sh
npm run typecheck --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
npm test --prefix server
npm run test:onboarding --prefix frontend
```

## Deployment

Firebase Hosting, project `skip-class-slsru4`, target `tala`. `npm run build:hosting --prefix frontend` builds into `public/`, which `firebase.json` serves. The **Deploy to Firebase Hosting (tala)** workflow runs only when started from the Actions tab. Hosting is static: public pages work there, while sign-in, booking and contact requests need a hosted backend.

## Accessibility

The site includes semantic landmarks and headings, a skip-to-content link, keyboard-accessible controls, visible focus styles, ARIA labels and live regions, reduced-motion handling, and responsive layouts.

When adding interactive content, preserve keyboard access, focus management, meaningful labels, and sufficient color contrast.

## Content and privacy

This website includes information related to children, families, health support, enrollment, and education. Do not add personally identifiable information or protected health information to the repository. Production authentication, enrollment, scheduling, and messaging should use approved secure services. Test with invented data only, and never commit `server/.runtime/`.

## Contact

For questions about TALA, call **+1 520 639 5411**.
