# TALA Frontend

Website and student hub for Tucson Adaptive Learning Academy. React + TypeScript (Vite), with a local Node.js/SQLite API for development.

## Run

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

## Layout

```text
frontend/src/
  public-site/   public pages
  onboarding/    Contact me form, public open times
  product/       signed-in app and admin tools
  api/           API client
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

## Deploy

Firebase Hosting, project `skip-class-slsru4`, target `tala` (`talaedu.com`). `npm run build:hosting --prefix frontend` builds into `public/`. The deploy workflow runs only when started from the Actions tab. Hosting is static, so sign-in and booking need a hosted backend first.

Use invented data only. Never commit `server/.runtime/` or real student records.
