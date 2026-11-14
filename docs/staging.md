# Staging for client demos (SCRUM-97)

There are two ways to show the site without anyone else running it locally. Neither touches the live site or real family data.

## 1. Hosted preview (demo mode)

A temporary Firebase Hosting **preview channel** on the existing `tala` site. It gets its own URL (`https://tucsonala--staging-<hash>.web.app`) and expires on its own. The live site at `tucsonala.web.app` is not changed.

**Before the first run:** confirm with Karl that a preview channel on `tala` in the shared `skip-class-slsru4` project is OK (SCRUM-97 risk 1).

**Deploy or redeploy**

1. GitHub → Actions → **Deploy staging preview (tala)** → **Run workflow**.
2. Pick the branch to show and an expiry (1d–30d, default 14d).
3. The run log prints the preview URL. Running it again replaces the preview at the same channel.

**Roll back:** run the workflow again from the earlier commit or branch. To take the preview down early: `firebase hosting:channel:delete staging --site tucsonala --project skip-class-slsru4`.

**What the Product Owner sees**

- Demo mode. Every record lives in the visitor's own browser, and nothing is sent to a server (T4-35: no real family data on staging).
- Sign in on `/#/login` with any test email, password and a role, or create a demo profile (T4-34). Use `example.test` addresses.
- Payment buttons are inert in demo mode, and no payment links are built into this bundle.

**Not included:** the hosted API. The TALA server is local-only by design: it refuses `NODE_ENV=production`, listens on `127.0.0.1` and stores data in a local SQLite file. Hosting it on Cloud Run needs a container, a production database, an `/api/**` Hosting rewrite, a CSP update and Karl's approval. That is tracked as a follow-up, not part of this preview.

## 2. Full local demo (real server, synthetic data)

To show the real flows (admissions, Tina's availability, contact requests, classes, roles), run the review launcher on the demo laptop:

```bash
cd frontend
npm run dev:review
```

It creates a fresh temporary database with fictional `example.test` accounts (student, parent, staff, a second student) and prints:

- the URL, `http://localhost:5181/#/login`
- the path of a private notes file with the generated passwords

Stop it with Ctrl+C. Each run starts clean; nothing is kept.

## Checks before a demo

```bash
cd server && npm test
```

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

```bash
cd frontend && npm run test:roles && npm run test:onboarding
```
