# Plan: Hannah's redesign on main's copy

Status: analysis only. Nothing in this plan is implemented yet.

Snapshot used (2026-11-19):

| Ref | Commit | Notes |
| --- | --- | --- |
| Live site (talaedu.com) | `c9b161a` (PR #13) | The locally built bundle matches the live bundle byte for byte, except CRLF in one inlined SVG (Windows checkout). |
| `origin/main` | `dc33c57` (PR #14) | Adds the Tina interview calendar link to `/register` and `/application`. Not deployed yet. |
| `dylan/public-site` | this branch | `origin/main` plus dev-affordance removal, lint fixes and test updates. Use it as the base for the port. |
| `dylan/sprint4-deliverables` | `d40dfb2` (committed state only) | Redesign branch. Another session is still committing to it; redo the inventory below if it moves. |
| Merge base | `efe2412` (2026-11-03) | Main has 49 commits since; the redesign branch has 47. |

Main's public copy is newer than the copy on the redesign branch. PR #13 (2026-11-16) rewrote Home, About, Programs and Community and added Admissions, Tuition and FAQ. The redesign branch forked before that. Most of the text differences between the two branches are therefore old copy on the branch, not design work. Port only the branch's layout, components and styles. Never port its text.

## 1. How copy is checked

Two scripts are committed in `docs/copy-check/`:

- `copy-snapshot.mjs` serves a built `public/` folder, opens 19 routes in Chromium and records the title, meta description, visible text, links (`text -> href [target]`), image alt text, button labels and aria-labels. `/api` returns 404, as on Firebase Hosting.
- `copy-diff.mjs` prints every string that is in one snapshot and not the other, and exits 1 on any difference.

Baseline workflow:

```sh
# once, on origin/main (or this branch before the port)
npm ci --prefix frontend
npm run build:hosting --prefix frontend
node docs/copy-check/copy-snapshot.mjs public baseline.json 4391

# after every port step
npm run build:hosting --prefix frontend
node docs/copy-check/copy-snapshot.mjs public step.json 4392
node docs/copy-check/copy-diff.mjs baseline.json step.json
```

Rules for reading the diff:

- Any `-` line means main copy or a link target was lost. That is a failure.
- A `+` line is allowed only when the owner has approved that exact string (section 5).
- Moving the same text to a new place gives no diff. Changing its case does: `innerText` applies `text-transform`. Do not put `text-transform: uppercase` on main's text. To get the mockup's small-caps eyebrow look, use letter-spacing and font size only.
- Build both snapshots on the same machine. The SVG hero image is inlined as a data URI, so CRLF and LF checkouts give different image hashes.

Reference result: `origin/main` against `dylan/public-site` gives exactly 22 `-` lines and no `+` lines. They are "Local workspace" on all 19 routes, "Local test · Fictional family details only" on `/register` and `/application`, and "Local test enrollment" on `/enroll`. Every CSS asset is byte-identical. Use `dylan/public-site` as the baseline for the port, not `origin/main`.

Two more checks for every step:

1. `npm run lint`, `npm run typecheck`, `npm run build:hosting --prefix frontend` and the six unit configs (`src/api/apiUnit`, `src/product/learningPlanUnit`, `src/product/learningExperienceUnit`, `src/product/meetingUnit`, `tests/sprint2Unit`, `src/backend/firebaseCore`). All of them pass on `dylan/public-site` today.
2. `npx playwright test tests/publicContent.spec.ts` (demo-mode copy test that already exists on main).

## 2. What differs, page by page

"Main" is `origin/main`. "Branch" is `d40dfb2`.

### Shared frame (header, footer, titles, meta)

| Item | Main says / links to | Branch changes |
| --- | --- | --- |
| Header nav (`shared/SiteHeader.tsx`) | Home `/`, About `/learn-more`, Programs `/programs`, Admissions `/admissions`, Tuition `/tuition`, FAQs `/faq`, Contact `/contact`; "Sign in" `/login` (or "Workspace" `/dashboard`). | Different labels and items: "Learn More", "Enrollment" `/register`, "Community Events" `/events`, "Community Login", and a new filled "Start registration" `/register` button (`.nav-cta`). No Admissions, Tuition or FAQs. |
| Footer (`shared/SiteLayout.tsx`, API mode) | Quiet footer: brand; About `/about`, Programs, Admissions, Tuition, FAQs, Contact; "Tucson Adaptive Learning Academy · Accredited K-12 education and pediatric clinical care." | Full three-column footer on public pages with new text: "Room to learn. Space to become yourself.", "Your learning. Your next step.", "Accounts, bookings and documents use the TALA server...", "TALA-Hub · Independent server", "Built for different ways to learn.", "© {year} TALA. All rights reserved." The quiet footer is kept only on `/dashboard`, `/payment`, `/two-factor`. |
| Banner | Removed on this branch. Main showed "Local workspace". | Still shows "Local workspace". |
| Page titles (`shared/RouteFocus.tsx`) | `<page> \| Tucson Adaptive Learning Academy`, including Admissions, Tuition and Funding, FAQs, "Special Needs School Programs". `/application` and `/enroll` fall back to "Page not found" (a main defect). | Suffix `\| TALA`, old titles ("Ways to learn"), adds titles for `/application`, `/enroll`, `/contact-request`, `/schedule`, and a "Test checkout" title. |
| `index.html` | SEO title, school description, `application/ld+json` School schema. | Replaced with "TALA — Room to grow" and the description "Explore TALA learning opportunities and a preview of the student learning hub. Frontend demonstration; no live account services." JSON-LD removed. |

### Home `/` (`public-site/HomePage.tsx`)

Main, in order:

1. Hero: H1 "A School Designed Around Health, Dignity & True Potential"; subtitle "Accredited K-12 Education with Dedicated On-Site Pediatric Clinical Care"; one paragraph; buttons "Schedule a Family Interview" (`https://calendar.app.google/YapTB4MQLus16DATA`) and "Explore Programs" (`/programs`); illustration `learning-desk.svg` with alt "An illustrated learning journal with a seedling and a mountain sketch."
2. "What Sets TALA Apart": six items (2:1 ratio, on-site nurse, sensory-controlled micro-campus, dual-enrollment bridge, 50-week calendar, diplomas and milestones).
3. "Education built around the learner" with "Explore Programs" `/programs`, then `ProgramCards`: two cards, "In-Person Campus Program" (`/programs?program=campus`) and "Virtual Academy" (`/programs?program=virtual`).
4. "A school where care and learning belong together" with one paragraph and "Our philosophy" `/about`.
5. `StartBanner`: "Let's talk about your learner." / "Meet with our team to explore whether TALA is right for your family." / "Schedule a Free One-Hour Family Interview" (calendar link).

Branch (Hannah, `1-home-page.png`), in order:

1. Hero: eyebrow "TUCSON ADAPTIVE LEARNING ACADEMY", H1 "Room to learn. Space to grow.", paragraph, three buttons ("Send inquiry" `#home-inquiry`, "Explore programs", "Learn more" `/learn-more`), footnote "Explore a frontend preview. No application is submitted.", illustration plus a floating "Student hub" card ("A sample of your learning space", "Preview the student hub" `/login`, "Sample data. No enrollment required.").
2. Three-step strip ("Start with your family." and two more).
3. "PROGRAMS / ENROLLMENT / Different paths. Same curiosity." with four cards (tutoring, group courses, experiential learning, interview consulting), each linking to `/programs`.
4. `HomeProjects`: a "Student projects & events" carousel of three example stories, labeled "Sample stories for preview", with pause, previous and next controls.
5. Two panels: "A school taking shape" ("Let's start a conversation" `#home-inquiry`) and a teal "A community worth exploring." ("Community Events" `/events`).
6. `HomeInquiry`: "Big questions. A simple first step." and an inquiry form that hands off to `/contact-request`, a server-backed page.

New files on the branch: `HomeProjects.tsx`, `HomeInquiry.tsx`, `UpcomingSessions.tsx`, `home.css` (730 lines), `assets/home/*.svg`, plus additions to `public.css`, `shared/styles/layout.css`, `base.css`, `global.css` and `shared/Icon.tsx`.

### Other public pages

| Route | Main | Branch |
| --- | --- | --- |
| `/about`, `/learn-more` | PR #13 copy: "Education grounded in health, dignity, and possibility", philosophy values, interview CTA. | Pre-#13 copy. No design changes to `AboutPage.tsx` (only the shared frame). |
| `/programs` | PR #13 copy, "Special Needs School Programs", campus and virtual programs, interview CTA. | Pre-#13 copy, plus `UpcomingSessions` (reads `/api` session times). |
| `/admissions`, `/tuition`, `/faq` | `InformationPages.tsx` (PR #13), each with the interview calendar link. | Routes missing. They render "Page not found". |
| `/contact`, `/events` | PR #13 copy with the interview CTA. | Pre-#13 copy. Contact adds "Ask us to contact you" `/contact-request` and "See open meeting times" `/schedule`, both server-backed. |
| `/register`, `/application` | PR #14: "Schedule an Interview with Tina" (calendar link, new tab) in `registration/InterviewBooking.tsx`. | Own `AdmissionStartPage` changes plus `interviewConnection.ts`. No PR #14 component. |
| `/login` | "Welcome back." form; on live, "TALA is unavailable." because there is no `/api`. | Adds "Open student demo" and "Open parent demo" buttons. |

### Portals (student, parent, operator)

On the live site the portals cannot be reached. Firebase Hosting has no `/api`, so `/login` shows "TALA is unavailable." and `/dashboard` redirects to it. The branch rebuilds the student portal (sidebar shell, calendar Month/Week/Day, Open Classes, `studentShell.css`), the parent and alumni portals, and the operator workspace (about 2,100 changed lines). It also changes `WorkspaceHeader`, `WorkspaceSidebar`, `ServerWorkspace`, `StudentOverview`, the calendar components and the server under `server/`. The portal holds many main strings that the branch rewords, for example page titles and labels.

## 3. How to port

### Port these from the branch (design only)

- `public-site/home.css`, plus the branch's additions to `public.css`, `shared/styles/layout.css`, `base.css` and `global.css` (the `.nav-cta` forced-colors rule).
- The new icons in `shared/Icon.tsx`.
- The visual structure of `HomePage.tsx`: hero grid, card styles, section rhythm, panel styles and the footer grid. Rebuild it with main's text. Do not copy the branch file.
- The branch `SiteHeader` styles: outline login button, active underline, spacing. Port the styling only. Keep main's nav items, labels and targets.
- The branch footer layout, with only main's footer content.

### Keep main's version as-is

- All public page components except the Home layout: `AboutPage.tsx`, `ProgramsPage.tsx`, `ProgramCards.tsx`, `programContent.ts`, `InformationPages.tsx`, `CommunityPage.tsx`, `StartBanner.tsx`, `NotFoundPage.tsx`. They only gain the new shared styles.
- `registration/InterviewBooking.tsx`, `interviewBooking.css`, and main's `product/admissions/AdmissionStartPage.tsx` (PR #14). Do not take the branch's `AdmissionStartPage.tsx` or `interviewConnection.ts`.
- `shared/RouteFocus.tsx` (titles and the "Tucson Adaptive Learning Academy" suffix), `index.html` (title, description, JSON-LD), `App.tsx`, `DemoApplication.tsx` and `FirebaseApplication.tsx`.
- The routes for `/admissions`, `/tuition` and `/faq` in `ServerApplication.tsx`.
- `firebase.json` (both `tala` and `taladev` targets, CSP, noindex header) and `.github/workflows/firebase-deploy-tala.yml` and `firebase-deploy-taladev.yml`.

### Home page: where main's text goes in Hannah's layout

| Mockup section | Main content placed there | Gap |
| --- | --- | --- |
| Hero eyebrow | Nothing by default. | D2 |
| Hero H1 and paragraph | Main H1, subtitle (as the line under the H1) and paragraph, unchanged. | none |
| Hero buttons | Primary filled: "Schedule a Family Interview" -> calendar URL. Outline: "Explore Programs" -> `/programs`. | D3: the mockup's third button ("Learn more") has no main copy. Default: leave it out. |
| Hero footnote "Explore a frontend preview..." | Removed (dev text). | none |
| Hero art | `learning-desk.svg` with main's alt text. Use main's SVG file, not the branch's. | none |
| Floating "Student hub" card | Removed (demo entry and sample-data text). | D1 |
| Three-step strip | No main copy. | D4: leave it out, or show main's six "What Sets TALA Apart" items in the mockup's card style. Recommended: a 3 x 2 card grid under main's H2, unchanged text. |
| Programs section | Main H2 "Education built around the learner", "Explore Programs" `/programs` on the right where the mockup has "View all programs", and `ProgramCards` (two cards) in the mockup's card style. Card links stay `/programs?program=campus` and `/programs?program=virtual`. | No eyebrow: main has none. The mockup's four program concepts do not exist on main and are not ported. |
| Student projects carousel | Removed. All of it is sample content ("Sample stories for preview"). | D5 |
| "A school taking shape" panel | Main's "A school where care and learning belong together", its paragraph and "Our philosophy" `/about`. | The badge "Centered on each learner" has no main copy, so leave it out. |
| Teal "A community worth exploring." panel | No main copy. | D6: leave it out, or use the teal panel for `StartBanner`. |
| Inquiry section and form | `StartBanner` text and button, styled with the mockup's left column or the teal panel. | D7: the form needs the server (`/contact-request`), which the public hosting lacks. Leave it out. |
| Footer | Mockup grid with main's brand, main's six footer links and main's one-line description. | D8: the "©" line and branch taglines are new copy. |

## 4. What the branch would break on main

Do not merge the branch into the public line. Port by hand, step by step. A merge would:

- Drop `/admissions`, `/tuition` and `/faq` (routes and `InformationPages.tsx`), and with them six links to the interview calendar.
- Revert PR #13 copy on Home, About, Programs and Community, and the nav, footer and titles.
- Lose PR #14 (the Tina calendar link on `/register` and `/application`) or conflict in `AdmissionStartPage.tsx`.
- Replace `index.html` SEO: title, description and School JSON-LD. The new description says "Frontend demonstration; no live account services."
- Change every page title suffix from "Tucson Adaptive Learning Academy" to "TALA".
- Remove the `taladev` hosting target from `firebase.json` and delete `firebase-deploy-taladev.yml`. Change `firebase-deploy-tala.yml` (adds HubSpot payment-link env values). Add `ci.yml` and `staging-preview.yml`. `staging-preview.yml` deploys a Firebase preview channel on the `tala` site; the port must not bring it in without the owner's approval.
- Bump Vite to 8.3.8. That is harmless on its own, but keep it out of the port and do it in a separate commit.
- Bring back the "Local workspace" banner and the demo sign-in buttons.
- Analytics: none on main or the branch. CSP: the branch home images are inline SVG, allowed by `img-src data:`. No web fonts are used, so `font-src 'self'` is fine.

## 5. Decisions for the owner

| # | Decision | Default if no answer |
| --- | --- | --- |
| D1 | The hero "Student hub" card advertises the portal with demo text. Drop it, or design a version with approved text. | Drop. |
| D2 | Hero eyebrow: none on main. Leave it empty, or approve text such as the school name. | Empty. |
| D3 | Third hero button ("Learn more" `/learn-more`) is new copy. | Leave out. |
| D4 | Three-step strip: leave it out, or show main's six "What Sets TALA Apart" items in that style. | Six items as a 3 x 2 card grid. |
| D5 | Projects carousel: sample stories only. Needs real, approved stories and photos (with consent) before it can appear. | Leave out. |
| D6 | Teal community panel: no main copy. | Use it for `StartBanner`'s text and button. |
| D7 | Inquiry form: needs the backend and approved text. | Leave out until the server is hosted. |
| D8 | Header "Start registration" button and footer "©", taglines and "TALA-Hub" lines are new copy. | Leave out. Main's "Sign in" keeps the outline style. |
| D9 | Main titles `/application` and `/enroll` as "Page not found". Fixing it adds new title text. | Leave as is; report separately. |
| D10 | Portal redesign: port only after a production backend exists, with a separate copy review of every portal string. | Not part of this port. |
| D11 | Admissions screens that appear only when the API answers still say "Local test meeting", "Local test reservation saved...", "This is a fictional test file...", "Save test file", and "Local test environment" (operator review). The calendar shows "Local preview · practice data" and practice-class labels only for server fixture data. HubSpot shows notices only for `@example.test` accounts or server test mode. These are honest labels for the local test backend. Rewrite them, or keep them until a real backend exists. | Keep (never shown on the live site). |

## 6. Never bring these to the public branch

- `ServerAccessPage.tsx` "Open student demo" / "Open parent demo", `api/client.ts` `localStudentPreviewAvailable`, `enterLocalStudentPreview`, `enterLocalParentPreview`, and server `/api/auth/local-student-preview`, `/api/auth/local-parent-preview` and `localStudentPreview` mode (`server/application.cjs`, `server/calendar.cjs`, `server/services.cjs`).
- The `tala_local_preview_student_v1` labels ("Student demo", "Demo · test data") in `ServerWorkspace.tsx`, `WorkspaceHeader.tsx` and `WorkspaceSidebar.tsx`.
- The "Local workspace" banner and the dev footer text in `SiteLayout.tsx`.
- `payment/TestCheckoutPage.tsx`, the `/payment/test-checkout/:paymentId` route, the "Test checkout" title in `RouteFocus.tsx`, `server/testCheckout.cjs` and the test-mode payment paths in `HubSpotPaymentPage.tsx` and `api/payment*.ts`.
- Mock and fake adapters and seed data: `server/test/fakeGoogle.mjs`, seeded demo schedules (`d40dfb2` "Seed a full, realistic school schedule..."), `product/browserHarness.ts`, `product/browserTestAccounts.ts`, `frontend/scripts/startReviewPreview.cjs` review data.
- Google Meet and Gmail adapters (`server/googleMeetAdapter.cjs`, `server/gmailAdapter.cjs`, `server/googleAuth.cjs`). These are server code and do not belong in the hosting build. Ship them only with a reviewed backend deployment.
- Home text marked as preview or sample: the "Student hub" card, "Explore a frontend preview...", "Sample stories for preview" and the example projects.

## 7. Port steps

Each step is one commit on a branch cut from `dylan/public-site`. Each one builds on its own and passes the checks in section 1. Stop and ask the owner when a step needs a section 5 decision.

1. **Baseline.** Build `dylan/public-site`, save `baseline.json`, and save screenshots of `/` at 1440, 768 and 390 px. No code changes.
2. **Shared tokens and base styles.** Port the branch additions to `shared/styles/base.css`, `global.css` and `layout.css` (selectors for the new header and footer only) and the new icons in `shared/Icon.tsx`. Expected copy diff: none. Check that the other pages look unchanged.
3. **Header styling.** Restyle `SiteHeader` to the mockup (outline "Sign in" button, active underline, spacing). Keep main's items, labels and targets. Copy diff: none. Check the mobile menu at 390 px and 320 px.
4. **Footer layout.** Put main's footer content (brand, six links, one-line description) in the mockup's grid. Copy diff: none, unless D8 is approved.
5. **Home skeleton.** Add `home.css` and restructure `HomePage.tsx` into the mockup's hero, programs, about and CTA sections, filled only with main's text. Remove nothing from main. Copy diff: none. Link targets unchanged (two calendar links, `/programs`, two program query links, `/about`).
6. **Home cards.** Restyle `ProgramCards` (home only, or behind a prop so `/programs` keeps its look) and the "What Sets TALA Apart" grid per D4. Copy diff: none.
7. **Optional sections.** Only the sections the owner approved in D1 to D7, each in its own commit, with the approved text. The copy diff must show only the approved `+` lines.
8. **Responsive and accessibility pass.** Run the existing `tests/publicContent.spec.ts` and `tests/frontend.spec.ts` (demo mode) and the axe checks already in the suite. Check focus order, the reduced-motion setting and forced colors.
9. **Release candidate.** Final `npm ci`, lint, typecheck, `build:hosting` and unit tests. Final copy diff against `baseline.json` (no `-` lines). Hand screenshots to the owner. Deploy stays a manual owner action (`firebase-deploy-tala.yml`); never run it from this work.

The portal (D10) is a separate track: deploy the backend first, then port `studentShell.css` and the portal components from the branch with a portal copy review, keeping section 6 out.
