# TALA Hub

Tucson Adaptive Learning Academy frontend demo, built with React, TypeScript and Vite. The application and its pinned dependencies live in `frontend/`.

Use Node.js `^22.13.0 || >=24`:

```sh
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/#/`.

To check and preview a build locally:

```sh
npm run build
npm run preview
```

The build includes TypeScript checking. No `.env` file is required for the default demo. `frontend/.env.example` contains public flags only: `VITE_DEMO_MODE=true` and `VITE_DEMO_TOOLS=false`. Never put credentials in `VITE_*` variables. Disabling demo mode makes unconnected services unavailable; it does not enable live APIs.

- **Authentication:** signup offers a locally generated Authenticator QR/manual key and browser-side TOTP verification. Email uses public sample code `246810` without sending a message. Login, roles and sessions are demo fixtures; no real identity provider or server-enforced MFA is connected. Existing sample login remains available without universal 2FA enforcement.
- **Checkout:** sample Parent login → Enrollment status & payment → Approved (demo) → Continue to payment → Private → Use demo card → acknowledge → Pay with demo card. Approval is a mock enrollment/payment state, separate from meeting appointments. Card, bank, billing and contact details are fixed fake samples; the $0.00 result is simulated and makes no charge.
- **Data:** learning records and class choices are sample data. Use invented details. Registration drafts, verification challenges, approvals and payment receipts reset on refresh; demo identity/class choices may survive within the same browser tab. Real registration, authorization, recovery, eligibility and payment confirmation require agreed backend integrations.
