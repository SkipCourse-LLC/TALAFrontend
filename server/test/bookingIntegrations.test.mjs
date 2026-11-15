// Interview bookings and contact requests use the meeting and email
// integrations: real Google modes against the local fake, plus mock and
// disabled modes. No real Google account or network access is used.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient } from "./support.mjs";
import { startFakeGoogle } from "./fakeGoogle.mjs";

let google;
before(async () => { google = await startFakeGoogle(); });
after(async () => { await google.close(); });

function resetGoogle(changes = {}) {
  Object.assign(google.state, { tokenMode: "ok", eventMode: "ok", gmailMode: "ok", deleteMode: "ok", delayMs: 0, tokenCalls: 0, unauthorizedServed: false, ...changes });
  for (const list of [google.state.issued, google.state.events, google.state.messages, google.state.deleted, google.state.deleteQueries]) list.length = 0;
}

async function fixture(integrations, { googleEnv = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "tala-booking-integrations-"));
  const app = createApplication({ dataDir: join(root, "private"), integrations,
    ...(googleEnv ? { integrationEnv: google.env({ TALA_GMAIL_SENDER: "admissions@school.example.test" }) } : {}) });
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const applicant = new SyntheticHttpClient(base);
  await applicant.bootstrap();
  const submitted = await applicant.request("/api/admissions/applications", { method: "POST", json: { parentName: "Alex Sample", email: "alex-family@example.test", studentName: "Sample learner", gradeBand: "6–8", interest: "Synthetic.", requestId: randomUUID() } });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.json));
  const start = Date.UTC(2030, 0, 7, 16, 0); // Monday 9:00 AM in Tucson
  const slots = [0, 1].map((day) => app.operator.addInterviewTime({ startsAt: new Date(start + day * 86400000).toISOString(), endsAt: new Date(start + day * 86400000 + 1800000).toISOString() }));
  let application = submitted.json.application;
  return {
    app, base, slots, applicant,
    get application() { return application; },
    async book(slot, requestId = randomUUID()) {
      const response = await applicant.request("/api/admissions/interview", { method: "POST", headers: { "X-TALA-Application": application.id }, json: { slotId: slot.id, requestId, version: application.version } });
      assert.equal(response.status, 200, JSON.stringify(response.json));
      application = response.json.application;
      return response;
    },
    async close() { await app.close(); await rm(root, { recursive: true, force: true }); },
  };
}

test("Google modes: booking creates a Meet link, emails it, and shows it to the family", async () => {
  resetGoogle();
  const f = await fixture({ meeting: "google-meet", email: "gmail" }, { googleEnv: true });
  try {
    const booked = await f.book(f.slots[0]);
    assert.deepEqual(booked.json.integrations, { email: "available", meeting: "available" });
    const { appointment } = booked.json.application;
    assert.equal(appointment.meeting.status, "ready");
    assert.match(appointment.meeting.joinUrl, /^https:\/\/meet\.google\.com\//);
    assert.equal(appointment.confirmationEmail, "sent");
    assert.equal(google.state.events.length, 1);
    assert.equal(google.state.events[0].body.start.dateTime, "2030-01-07T16:00:00.000Z");
    const [mail] = google.state.messages;
    assert.match(mail.decoded, /^To: alex-family@example\.test$/m);
    const body = Buffer.from(mail.decoded.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
    assert.match(body, /Monday, January 7, 2030 at 9:00 AM \(Tucson time\)/);
    assert.ok(body.includes(appointment.meeting.joinUrl), "the email carries the same link the page shows");
    const current = await f.applicant.request("/api/admissions/current");
    assert.equal(current.json.application.appointment.meeting.joinUrl, appointment.meeting.joinUrl, "the link is saved");
  } finally { await f.close(); }
});

test("rebooking removes the old Google event without notices and books a new one", async () => {
  resetGoogle();
  const f = await fixture({ meeting: "google-meet", email: "gmail" }, { googleEnv: true });
  try {
    await f.book(f.slots[0]);
    const second = await f.book(f.slots[1]);
    assert.deepEqual(google.state.deleted, ["fakeevent1"]);
    assert.deepEqual(google.state.deleteQueries, [{ sendUpdates: "none" }]);
    assert.equal(google.state.events.length, 2);
    assert.equal(second.json.application.appointment.meeting.status, "ready");
    const old = f.app.db.prepare("SELECT m.cleanup_status FROM admissions_meetings m JOIN admissions_appointments a ON a.id=m.appointment_id WHERE a.status='cancelled'").get();
    assert.equal(old.cleanup_status, "removed");
  } finally { await f.close(); }
});

test("a resent booking request never creates a second meeting or email", async () => {
  resetGoogle();
  const f = await fixture({ meeting: "google-meet", email: "gmail" }, { googleEnv: true });
  try {
    const requestId = randomUUID();
    const version = f.application.version;
    await f.book(f.slots[0], requestId);
    const replay = await f.applicant.request("/api/admissions/interview", { method: "POST", headers: { "X-TALA-Application": f.application.id }, json: { slotId: f.slots[0].id, requestId, version } });
    assert.equal(replay.status, 200, JSON.stringify(replay.json));
    assert.equal(google.state.events.length, 1);
    assert.equal(google.state.messages.length, 1);
  } finally { await f.close(); }
});

test("a Google outage keeps the booking, records the failure and never shows a made-up link", async () => {
  resetGoogle({ eventMode: "error500" });
  const f = await fixture({ meeting: "google-meet", email: "gmail" }, { googleEnv: true });
  try {
    const booked = await f.book(f.slots[0]);
    const { application } = booked.json;
    assert.equal(application.status, "interview_scheduled");
    assert.deepEqual(application.appointment.meeting, { status: "failed", joinUrl: null });
    assert.equal(application.appointment.confirmationEmail, "sent");
    const body = Buffer.from(google.state.messages[0].decoded.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
    assert.match(body, /We will email you the video link before your interview\./);
    assert.doesNotMatch(body, /https:\/\//);
  } finally { await f.close(); }
});

test("an email outage keeps the booking and records the failed confirmation", async () => {
  resetGoogle({ gmailMode: "error500" });
  const f = await fixture({ meeting: "google-meet", email: "gmail" }, { googleEnv: true });
  try {
    const booked = await f.book(f.slots[0]);
    assert.equal(booked.json.application.appointment.meeting.status, "ready");
    assert.equal(booked.json.application.appointment.confirmationEmail, "failed");
  } finally { await f.close(); }
});

test("mock modes give the same booking flow without any network", async () => {
  const f = await fixture({ meeting: "mock", email: "mock" });
  try {
    const booked = await f.book(f.slots[0]);
    assert.match(booked.json.application.appointment.meeting.joinUrl, /^https:\/\/meet\.example\.test\//);
    const outbox = f.app.integrations.email.outbox();
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, "alex-family@example.test");
  } finally { await f.close(); }
});

test("disabled modes book normally and report both services as unavailable", async () => {
  const f = await fixture({});
  try {
    const booked = await f.book(f.slots[0]);
    assert.deepEqual(booked.json.integrations, { email: "unavailable", meeting: "unavailable" });
    assert.deepEqual(booked.json.application.appointment.meeting, { status: "unavailable", joinUrl: null });
    assert.equal(booked.json.application.appointment.confirmationEmail, "unavailable");
  } finally { await f.close(); }
});

test("contact requests get one acknowledgement email, even when the form is resent", async () => {
  resetGoogle();
  const f = await fixture({ email: "gmail" }, { googleEnv: true });
  try {
    const visitor = new SyntheticHttpClient(f.base);
    await visitor.bootstrap();
    const request = { parentName: "Synthetic Parent", email: "family@example.test", phone: "(520) 555-0100", preferredMethod: "text",
      availability: [{ day: "tuesday", startTime: "09:00", endTime: "12:00" }], notes: "Please call after 5. <b>not echoed</b>", requestId: randomUUID() };
    assert.equal((await visitor.request("/api/contact-requests", { method: "POST", json: request })).status, 201);
    assert.equal((await visitor.request("/api/contact-requests", { method: "POST", json: request })).status, 201);
    assert.equal(google.state.messages.length, 1);
    const body = Buffer.from(google.state.messages[0].decoded.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
    assert.match(body, /reach out by text message soon/);
    assert.doesNotMatch(body, /not echoed/, "the family's notes are never repeated in email");
    assert.equal(f.app.db.prepare("SELECT email_status FROM contact_request_notifications").get().email_status, "sent");
  } finally { await f.close(); }
});
