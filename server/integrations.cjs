"use strict";
// SCRUM-88: the only module that knows which outside service backs each
// integration. Routes and services ask this registry for an adapter, so moving
// from a mock to the real service is a configuration change, never a screen or
// route change. Configure with createApplication({ integrations: { email: "mock" } })
// or the TALA_*_ADAPTER environment variables. Unknown modes stop startup.
// Every adapter method is async in every mode, so callers never change.
const { randomUUID } = require("node:crypto");
const { fail, object, text } = require("./security.cjs");
const { createGoogleTokenSource, googleSettings } = require("./googleAuth.cjs");
const { createGoogleMeetAdapter } = require("./googleMeetAdapter.cjs");
const { createGmailAdapter, emailMessage } = require("./gmailAdapter.cjs");

const SCHOOL_TIME_ZONE = "America/Phoenix"; // Tucson: UTC-7 all year, no daylight saving.
const PHOENIX_OFFSET_MS = 7 * 3600000;
const OUTBOX_LIMIT = 200;
const MAX_INVOICE_LINES = 20;

const SPECS = Object.freeze({
  email: { env: "TALA_EMAIL_ADAPTER", fallback: "disabled", modes: ["disabled", "mock", "gmail"] },
  meeting: { env: "TALA_MEETING_ADAPTER", fallback: "disabled", modes: ["disabled", "mock", "google-meet"] },
  availability: { env: "TALA_AVAILABILITY_ADAPTER", fallback: "local", modes: ["local", "mock"] },
  billing: { env: "TALA_BILLING_ADAPTER", fallback: "hubspot_links", modes: ["hubspot_links", "mock"] },
});

async function unavailable(kind) {
  fail(503, "INTEGRATION_UNAVAILABLE", `The ${kind} integration is not connected on this server.`);
}
const iso = (value) => new Date(value).toISOString();

// ---- email --------------------------------------------------------------
function emailAdapter(mode, google) {
  if (mode === "disabled") return { mode, send: () => unavailable("email") };
  if (mode === "gmail") return createGmailAdapter({ tokens: google.tokens(), apiBase: google.settings.apiBase, sender: google.settings.gmailSender });
  const outbox = [];
  return {
    mode,
    /** Mock delivery: nothing leaves this process. Messages are kept for tests and staging review. */
    async send(message) {
      const saved = { id: randomUUID(), ...emailMessage(message), sentAt: iso(Date.now()) };
      outbox.push(saved);
      if (outbox.length > OUTBOX_LIMIT) outbox.shift();
      return { id: saved.id, status: "delivered_to_mock_outbox" };
    },
    outbox: () => outbox.map((message) => ({ ...message })),
  };
}

// ---- meeting links ------------------------------------------------------
function meetingAdapter(mode, google) {
  if (mode === "disabled") return { mode, createMeeting: () => unavailable("meeting") };
  if (mode === "google-meet") return createGoogleMeetAdapter({ tokens: google.tokens(), apiBase: google.settings.apiBase, calendarId: google.settings.calendarId });
  return {
    mode,
    async createMeeting(input) {
      object(input, ["title", "startsAt", "endsAt"]);
      const starts = Date.parse(input.startsAt), ends = Date.parse(input.endsAt);
      if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) fail(400, "INVALID_INPUT", "Choose a valid meeting time.");
      const id = randomUUID();
      return { provider: "mock", meetingId: id, status: "ready", joinUrl: `https://meet.example.test/${id}`, title: text(input.title, "meeting title", 120), startsAt: iso(starts), endsAt: iso(ends) };
    },
  };
}

// ---- availability (provider not chosen; TALA is moving away from EZAMU) ---
// Every mode returns the same shape:
// { source, timeZone, sessions: [{ id, sessionType: "one_on_one"|"pod", label, startsAt, endsAt, capacity, remaining }] }
function phoenixDate(dayStart, hour, minute) {
  return dayStart + hour * 3600000 + minute * 60000 + PHOENIX_OFFSET_MS;
}
function mockSessions(now, days) {
  const sessions = [];
  const todayUtcMidnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  for (let offset = 0; offset <= days; offset += 1) {
    const dayStart = todayUtcMidnight + offset * 86400000;
    const weekday = new Date(dayStart).getUTCDay();
    const key = new Date(dayStart).toISOString().slice(0, 10);
    const planned = [];
    if (weekday === 1 || weekday === 3) planned.push(["one_on_one", 9, 0, 30, 1, "1:1 session with an expert"], ["one_on_one", 10, 0, 30, 1, "1:1 session with an expert"]);
    if (weekday === 2 || weekday === 4) planned.push(["pod", 13, 0, 60, 20, "20:1 learning pod"]);
    for (const [sessionType, hour, minute, length, capacity, label] of planned) {
      const startsAt = phoenixDate(dayStart, hour, minute);
      if (startsAt <= now) continue;
      const remaining = sessionType === "pod" ? Math.max(0, capacity - ((offset * 7) % (capacity + 1))) : 1;
      sessions.push({ id: `mock-${sessionType}-${key}-${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`, sessionType, label, startsAt: iso(startsAt), endsAt: iso(startsAt + length * 60000), capacity, remaining });
    }
  }
  return sessions;
}
function availabilityAdapter(mode, dependencies) {
  if (mode === "local") {
    return {
      mode,
      /** Tina's published meeting times, as 1:1 sessions. */
      async listSessions() {
        const open = dependencies.publicOpenTimes();
        return { source: "local", timeZone: open.timeZone, sessions: open.times.map((time) => ({ id: time.id, sessionType: "one_on_one", label: "Meeting with Tina", startsAt: time.startsAt, endsAt: time.endsAt, capacity: 1, remaining: 1 })) };
      },
    };
  }
  return {
    mode,
    /** Placeholder 1:1 and 20:1 pod times, generated without any network access, until a provider is chosen. */
    async listSessions({ now = Date.now(), days = 21 } = {}) {
      return { source: "mock", timeZone: SCHOOL_TIME_ZONE, sessions: mockSessions(now, days) };
    },
  };
}

// ---- billing / invoices --------------------------------------------------
// Creating an invoice never sends it. Sending needs admin sign-off (SCRUM-94).
function billingAdapter(mode) {
  if (mode === "hubspot_links") {
    // Today the server only knows the two fixed HubSpot payment links (payments.cjs).
    // On hold: TALA is moving payments to Chase; the product is not chosen yet.
    return { mode, createInvoice: () => unavailable("billing"), getInvoice: () => unavailable("billing") };
  }
  const invoices = new Map();
  return {
    mode,
    async createInvoice(input) {
      object(input, ["familyUid", "lines", "reference"]);
      if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > MAX_INVOICE_LINES) fail(400, "INVALID_INPUT", `Add 1 to ${MAX_INVOICE_LINES} invoice lines.`);
      const lines = input.lines.map((line) => {
        object(line, ["description", "amountCents"]);
        if (!Number.isSafeInteger(line.amountCents) || line.amountCents < 0) fail(400, "INVALID_INPUT", "Invoice amounts must be whole cents.");
        return { description: text(line.description, "invoice line", 200), amountCents: line.amountCents };
      });
      const invoice = { id: `mock-invoice-${randomUUID()}`, familyUid: text(input.familyUid, "family", 128), reference: text(input.reference, "invoice reference", 120), lines, totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0), status: "draft", provider: "mock", createdAt: iso(Date.now()) };
      invoices.set(invoice.id, invoice);
      return structuredClone(invoice);
    },
    async getInvoice(id) {
      const invoice = invoices.get(id);
      if (!invoice) fail(404, "NOT_FOUND", "This invoice is unavailable.");
      return structuredClone(invoice);
    },
  };
}

function resolveModes(configured = {}, env = process.env) {
  if (configured === null || typeof configured !== "object") throw new Error("Integration configuration must be an object.");
  for (const kind of Object.keys(configured)) if (!SPECS[kind]) throw new Error(`Unknown integration "${kind}". Choose ${Object.keys(SPECS).join(", ")}.`);
  const modes = {};
  for (const [kind, spec] of Object.entries(SPECS)) {
    const mode = configured[kind] ?? env[spec.env] ?? spec.fallback;
    if (!spec.modes.includes(mode)) throw new Error(`Integration ${kind} cannot use mode "${mode}". Choose ${spec.modes.join(", ")} (set ${spec.env}).`);
    modes[kind] = mode;
  }
  return modes;
}

/** Google settings and one shared token cache, created only when a Google mode is chosen. */
function googleProvider(env) {
  let settings, tokens;
  return {
    get settings() { return settings ??= googleSettings(env); },
    tokens() { return tokens ??= createGoogleTokenSource(this.settings); },
  };
}

function createIntegrations(configured, dependencies, env = process.env) {
  const modes = resolveModes(configured, env);
  const google = googleProvider(env);
  const adapters = {
    email: emailAdapter(modes.email, google),
    meeting: meetingAdapter(modes.meeting, google),
    availability: availabilityAdapter(modes.availability, dependencies),
    billing: billingAdapter(modes.billing),
  };
  return { ...adapters, describe: () => ({ ...modes }) };
}

module.exports = { createIntegrations, resolveModes, INTEGRATION_SPECS: SPECS };
