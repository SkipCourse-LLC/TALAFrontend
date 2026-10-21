# Deployment process

## Current delivery: `yichen`, no publishing authorization

The current handoff targets the independent `yichen` branch in [the team Frontend repository](https://github.com/Tucson-Adaptive-Learning-Academy/Frontend). Delivering source code does not authorize a merge into `main` or `rewrite/nextjs`, a hosting release, DNS/CNAME changes, or a real school service. Login, enrollment, funding, learning records and payments remain frontend demos. Current handoff details and verification evidence are in [INTEGRATION.md](INTEGRATION.md) and [SPRINT_2.md](SPRINT_2.md).

The local `yichen` tree has no GitHub Actions workflow or hosting deployment configuration. `frontend/package.json` has build and local preview commands, not a deploy or publish command. `vite.config.ts` uses relative assets for static hosting; this is not a deployment trigger. Local Git hooks are only inactive `.sample` files, and no custom hooks path is configured. The existing `CNAME` is retained unchanged.

A read-only check of the team's `rewrite/nextjs` branch found `.github/workflows/ci.yml`: it runs checks for pull requests and pushes to `main`, with no deployment job. That workflow does not establish the hosting behavior of `yichen`. GitHub Pages configuration, connected hosting projects, webhooks and other external triggers have not been verified. A future push to `yichen` could still trigger an external deployment; the repository/hosting owner must confirm those settings before a push that must not deploy. No deployment configuration was modified as part of this handoff.

## Earlier `staging` preview plan: reference only

The following guide records the earlier preview plan. `staging` is its historical source branch, not the current delivery target or an approved hosting branch. Apply publishing steps only after the hosting owner confirms the project, environment, branch, automatic triggers and release permission. Remote hosting settings and a remote deployment have not been verified.

## 1. Prepare the release

- Confirm the intended preview branch with its owner; the earlier plan used `staging`. Record the commit being reviewed.
- Obtain access to the approved hosting project from its owner.
- Use a Node.js version supported by `frontend/package.json` (`^22.13.0 || >=24`). Use the same version locally and on the host.
- Keep production separate. Publishing from `main` requires team approval; this guide does not authorize a merge or production release.

From the repository root:

```sh
git branch --show-current
git rev-parse HEAD
cd frontend
npm ci
```

## 2. Run the checks

```sh
npm run lint
npm run typecheck
npm run build
npx playwright install chromium webkit
npm test
npx playwright test -c tests/sprint2Unit.config.ts
npx playwright test -c tests/sprint2Browser.config.ts
```

The main Playwright suite uses port 4173; isolated module browser checks use 4175. Browser projects cover 320, 390, 768 and 1440 pixels; pure service checks do not start a browser. The test servers require those ports to be available. Do not publish if a check fails. Only format the files being changed; do not run the repository-wide `npm run format` as a handoff prerequisite.

Tests build the site with QA controls enabled. **Build again with those controls off before publishing:**

```sh
VITE_DEMO_MODE=true VITE_DEMO_TOOLS=false npm run build
npm run preview -- --port 4173 --strictPort
```

Open `http://127.0.0.1:4173/#/` and check the demo. This preview server is for local verification, not production hosting.

## 3. Configure the preview build

Use these values in the approved static hosting project:

| Setting           | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Source branch     | Owner-confirmed preview branch; `staging` was the earlier plan |
| Application root  | `frontend`                                                     |
| Install command   | `npm ci`                                                       |
| Build command     | `npm run build`                                                |
| Output directory  | `dist`, relative to `frontend`                                 |
| `VITE_DEMO_MODE`  | `true`                                                         |
| `VITE_DEMO_TOOLS` | `false`                                                        |

Set both environment variables for the preview build, then rebuild. They are public build settings, not secrets. Never put credentials in `VITE_*` variables. Setting demo mode to false does not connect a real backend; account and data services become unavailable.

If publishing static files manually, publish the contents of `frontend/dist/`. Do not upload source files, dependencies, environment files or Playwright reports.

## 4. Publish and verify

1. Confirm publishing permission, automatic triggers, the preview environment and the intended commit with the hosting owner.
2. Start the preview build using the host's deployment mechanism. The exact platform steps must be confirmed by the hosting owner.
3. Check the build log for success. Record the commit, preview URL and deployment identifier.
4. Open the remote preview URL and complete: Home → Registration → Parent Account → Student Information → Enrollment → Documents → Funding → Review → 2FA Setup → Verification (current authenticator code; Email demo only uses `246810`) → Parent Workspace → Student Login → Dashboard → Add Class → Calendar.
5. Also check Enrollment status → Approved (demo) → Payment → Private → **Use demo card**. Fixed brands, card number, expiry, CVV, billing and contact text appear inline; The fixed-sample card/bank chooser opens through **Add demo payment method** before selection or **Change demo payment method** afterwards. Confirm these fixtures cannot accept financial input, no payment provider is connected and the result says no money was paid. Check parent/student switching, mobile navigation and keyboard navigation. Refresh a direct route such as `/#/register`.
6. Confirm there are no broken assets, browser console errors, horizontal overflow or QA controls. Demo labels must remain visible.

Local tests do not replace this check on the deployed URL. Attach the build result, URL and check results to the release record.

## 5. If a deployment fails

Do not promote a failed preview to production. Save the failing build log and commit identifier. Have the hosting owner restore the previous successful deployment using the host's supported rollback process, then check its URL again. If the host has no rollback option, rebuild the previously approved commit as a separate deployment. Do not rewrite Git history or force-push to recover a release.

## Production handoff — still to confirm

Before this guide can be used for a production release, the team must record:

- The hosting provider, project, release owner and access requirements.
- How preview and production are separated and what triggers each deployment.
- The platform-specific publish and rollback steps, including the last known good deployment.
- Approval to release from `main`, and the production URL and post-release checks.
- Backend readiness and approved school content; see [the backend checklist](BACKEND_INTEGRATION_NEEDED.md).

Do not change CNAME, DNS or production settings as part of preview setup. No remote deployment was performed when writing this guide.
