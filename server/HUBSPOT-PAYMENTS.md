# HubSpot Payments: implemented boundary and local review

The default Node/SQLite application now persists approved payment items, checkout attempts, provider references, verification checks and receipt deduplication. `/payment` uses this same backend, not the legacy demo payment adapter. No card number, CVV or HubSpot secret is collected by TALA.

## What works now

1. Staff open **Payments** in the staff workspace and authorize a payment item against an existing approved family or parent-approved class request.
2. The assigned parent opens **Payments** from the family portal, reviews the item and selects **Pay Now**. TALA commits its pending attempt before returning the appropriate official HubSpot URL.
3. Returning with the browser Back button or opening `/#/payment` reloads the saved ledger and requests server verification. Return parameters such as `paid=true` have no authority. Without a configured trusted receipt adapter the state stays **Awaiting verification**. Do not pay again while a receipt is unresolved.
4. An authorized, exact trusted receipt can settle the item. A matching class request becomes confirmed in the existing Calendar store. Quarterly payment never approves admissions, creates accounts or provisions students.
5. ESA creates a separate **ESA review pending** request. It neither moves funds nor confirms enrollment.

The initial quarterly checkout is **recurring**, currently $1,250 today and each quarter. Only one initial subscription item is issued per application; later periods need subscription reconciliation rather than a fresh checkout. The individual link currently describes a $240 **2-hour In Person** session. Staff cannot assign it to other amounts, durations or online requests. Public links can still be opened outside TALA: local attempt deduplication does not guarantee prevention of duplicate provider charges.

These terms were read passively on November 2, 2026; no transaction was submitted. Merchant shown: SkipCourse LLC. HubSpot's current configuration and Sponsor-approved terms determine the actual charge. Display references are editable server configuration, not fixed business prices:

```sh
TALA_HUBSPOT_QUARTERLY_DISPLAY_CENTS=125000 TALA_HUBSPOT_SESSION_DISPLAY_CENTS=24000 npm run dev --prefix frontend
```

Existing issued items retain their snapshot. A changed display configuration blocks inconsistent checkout pending staff review; changing a display reference does not update HubSpot.

## Authorization still needed

No private HubSpot credential, real account permission or exact receipt-to-item binding was available in this workspace. **Automatic HubSpot API reconciliation and webhooks are not connected.** The server does not expose a `mark paid`, simulated-success or unsigned webhook endpoint.

Karl/Tina must approve a server app with [`crm.objects.commercepayments.read`](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/commerce-payments/get-commerce-payment#required-scopes) and [`commerce.payment_links.read`](https://developers.hubspot.com/docs/api-reference/latest/revenue/payment-links/get-payment-link#required-scopes), the portal and numeric link IDs, and an audited binding of each provider receipt to one internal payment item. Shared link query parameters, buyer email and amount alone are insufficient. Confirm the merchant, recurrence/cancellation terms, eligible class product and the quarterly checkout copy that currently describes an entrance interview after payment; TALA continues to require approval first.

The trusted server extension is `createApplication({paymentProvider})`. The adapter implements `mode: 'authorized_server_adapter'` and async `verify(context)`. `server/payments.cjs` defines its exact evidence checks: provider/source, transaction and receipt IDs, exact immutable business reference, expected link, amount/currency, processor, raw status, event time and refunds. It must independently query authorized HubSpot records and return `null` when binding is ambiguous. A fabricated object satisfying this interface is not a real integration. No token belongs in `VITE_*`, browser storage or source control.

Official read APIs: [`/crm/objects/2026-09/commerce_payments/{id}`](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/commerce-payments/guide) and [`/commerce/payment-links/2026-09/payment-links/{paymentLinkId}`](https://developers.hubspot.com/docs/api-reference/latest/revenue/payment-links/guide). Link slugs are not numeric object IDs. Recurring renewals, disputes and fulfillment after refunds need a reviewed operational policy.

If webhooks are later authorized, [generic Commerce payment subscriptions](https://developers.hubspot.com/docs/apps/legacy-apps/public-apps/create-generic-webhook-subscriptions) must be enabled for that app. Add a reviewed HTTPS callback using [v3 request validation](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/request-validation), pinned external URI, bounded raw body, timestamp/portal/app validation, replay protection and server re-fetch. Event values are notifications, never payment proof. This local-only server currently has no callback route.

## Local test without a transaction

```sh
node --test server/test/payments.test.mjs
npm run build --prefix frontend
TALA_REVIEW_WEB_PORT=5182 TALA_REVIEW_API_PORT=8792 npm run dev:review --prefix frontend
```

The review launcher creates a fresh temporary fictional database and prints the private account-instructions file path. Sign in with the review parent and open `http://localhost:5182/#/payment`; staff use the same file to access the issuance panel. **The official checkout destinations are live: do not submit payment for fictional review items.**

The targeted tests inject an `isolated_test_adapter` into disposable databases using only `example.test` accounts. They exercise successful/failed/cancelled receipts, mismatches, duplicate processing, revoked authorization, persistent pending states and spoofed browser success. There is no browser-accessible test payment switch. Production configuration and real provider records are untouched.

## Files changed for this integration

Earlier uncommitted changes in these files were retained; this list describes this task's touch points, not every dirty file in the repository.

- Backend: `server/payments.cjs`, `server/database.cjs`, `server/application.cjs`, `server/backup.cjs`, `server/runtimeIdentity.cjs`, `server/package.json`, `server/contract.json`, `server/test/payments.test.mjs`.
- Existing payment page and new server-backed components: `frontend/src/payment/PaymentPage.tsx`, `HubSpotPaymentPage.tsx`, `ParentPaymentSummary.tsx`, `OperatorPaymentsPanel.tsx`, `hubspotPayment.css`, `operatorPayments.css` (all under `frontend/src/payment/`).
- API: `frontend/src/api/client.ts`, `index.ts`, `paymentClient.ts`, `paymentContract.ts`, `paymentDecoders.ts` (all under `frontend/src/api/`).
- Portal integration: `frontend/src/product/ServerApplication.tsx`, `ServerWorkspace.tsx`, `OperatorWorkspace.tsx`, `WorkspaceSidebar.tsx`, `WorkspaceHeader.tsx`, `serverDashboard.css` (under `frontend/src/product/`), `frontend/src/product/calendar/ParentClassApprovals.tsx`, `frontend/src/shared/SiteLayout.tsx`.
- Local launcher and documentation: `frontend/scripts/startApplication.mjs`, `frontend/scripts/startReviewPreview.cjs`, `README.md`, `server/README.md`, this document. Preview image: `project/screenshots/tala-hubspot-payments.png`.
