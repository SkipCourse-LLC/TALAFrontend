# Integrations register (SCRUM-88)

Every outside service Sprint 4 depends on, who owns it, whether we have access, and how the code switches between a mock and the real service.

Status as of 2026-11-14. Update the **Access status** column whenever a request is sent or answered, with the date.

## Register

| Integration | Used by | Owner | Access status | Contract | Today the server uses |
|---|---|---|---|---|---|
| Availability (1:1 and 20:1 pods; was EZAMU) | SCRUM-91, SCRUM-90 | Sherry | 2026-11-14: TALA is moving away from EZAMU. No replacement chosen; the placeholder stays until then. | `contract.json` → `integrations.availability` | `local`: Tina's published meeting times. `mock`: generated 1:1 and pod times |
| Payments and invoices (HubSpot today, Chase next) | SCRUM-94, SCRUM-95 | Shelby | 2026-11-14: on hold. TALA is moving from HubSpot to Chase; the Chase product and a test account are not confirmed. The two **live** HubSpot links still exist (`server/payments.cjs`). | `contract.json` → `/payments*` routes and `integrations.billing` | `hubspot_links`: the two live links. `mock`: in-memory test invoices |
| Email delivery (Gmail) | SCRUM-79, SCRUM-90 | Dylan | 2026-11-14: TALA's Google Workspace credentials received and accepted by Google (gmail.send granted). Tested against the stand-in; no real email sent yet. | `contract.json` → `integrations.email` | `disabled`. `mock`: in-memory outbox. `gmail`: real sending |
| Meeting links (Google Meet) | SCRUM-79, SCRUM-90 | Dylan | 2026-11-14: connected. A real test meeting returned a meet.google.com link on the TALA calendar and was deleted. | `contract.json` → `integrations.meeting` | `disabled`. `mock`: `meet.example.test` links. `google-meet`: real links |
| Firebase Authentication | SCRUM-89 | Dylan | Waiting on Karl's approval (`docs/auth-and-data-model.md`, open questions 1–3). Local sign-in with four roles is in use meanwhile. | `contract.json` → `/auth/*`, `/session` | Local server sessions |
| TALA student email (Google Workspace) | SCRUM-80 | Yichen | Manual: Tina issues the address. Format and any automation not yet agreed (`docs/flow-map.md`). | Admissions routes in `contract.json` | Manual entry during student setup |
| Firebase Hosting | SCRUM-97 | Dylan | `tala` target maps to the **live** site `tucsonala` in the shared project `skip-class-slsru4`. No staging target. Karl must confirm before any staging deploy. | `firebase.json`, `.firebaserc` | Manual deploy workflow to the live site |
| Hosted API (Cloud Run) | SCRUM-97 | Dylan | None. The local server refuses production mode and listens on localhost only. | `contract.json` | Not hosted |

## How switching works

`server/integrations.cjs` is the only code that knows which service backs an integration. Choose a mode with `createApplication({ integrations: { email: "mock" } })` or an environment variable:

| Integration | Variable | Modes (default first) |
|---|---|---|
| email | `TALA_EMAIL_ADAPTER` | `disabled`, `mock`, `gmail` |
| meeting | `TALA_MEETING_ADAPTER` | `disabled`, `mock`, `google-meet` |
| availability | `TALA_AVAILABILITY_ADAPTER` | `local`, `mock` |
| billing | `TALA_BILLING_ADAPTER` | `hubspot_links`, `mock` |

- `GET /api/health` reports the mode of each integration under `integrations`.
- A mistyped name or mode stops the server at startup with the allowed choices.
- `disabled` and `hubspot_links` return `503 INTEGRATION_UNAVAILABLE` for calls they cannot serve. They never pretend to succeed.
- Each real service is added as a new mode next to its mock, in the ticket that owns it (availability in SCRUM-91, payments in SCRUM-94/95, email and meeting links in SCRUM-90). Screens and routes do not change.
- `google-meet` reads `TALA_GOOGLE_CLIENT_ID`, `TALA_GOOGLE_CLIENT_SECRET` and `TALA_GOOGLE_REFRESH_TOKEN` from the server environment, never from the repository. `TALA_GOOGLE_CALENDAR_ID` picks the calendar (default `primary`). `TALA_PROVIDER_TIMEOUT_MS` caps each Google call (default 10000). Every adapter method returns a promise.
- `gmail` uses the same Google credentials plus `TALA_GMAIL_SENDER`, which must be the account that approved access. Subjects and recipients are single-line, so headers cannot be injected.
- `server/test/gmail.test.mjs` covers sending, non-English text, header injection, a shared token with Meet, rejected sign-in, rate limits and outages.
- `server/test/googleMeet.test.mjs` runs the Meet adapter against a local fake Google server (`server/test/fakeGoogle.mjs`): token reuse, early refresh, one retry on 401, revoked keys, quota, outages, pending conferences, timeouts and secret-free errors.
- Tests: `server/test/integrations.test.mjs` (T4-1, T4-3, T4-4) and `server/test/contract.test.mjs` (T4-2: every server route is in `contract.json` and every contract route is served).

## Where secrets live

- Real values go in a file outside the repository and outside OneDrive: `%USERPROFILE%\.tala\server.env`, readable only by your Windows account. `server/.env.example` lists the names with placeholders.
- Start the server with them: `node --env-file="%USERPROFILE%\.tala\server.env" index.cjs` (from `server/`).
- Never paste values into the repo, chat, email, Slack or Jira. Share them only through a password manager.
- Two checks stop a repeat of the leaked keys: a local pre-commit hook runs `.github/scripts/leak-scan.sh --staged` and refuses the commit, and CI runs the same scan on every push.
- If a value is ever exposed, delete that OAuth client (or secret) in Google Cloud first, then remove it from the code.

## Access requests

Requests for each item above are sent to the Product Owner outside this repository. Record the date sent and the answer in the **Access status** column.
