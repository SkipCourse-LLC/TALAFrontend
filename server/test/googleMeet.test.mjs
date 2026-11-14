// Google Meet adapter against the local fake Google server. No real Google
// account, network access or secret is used.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createIntegrations, resolveModes } from "../integrations.cjs";
import { createGoogleTokenSource, googleSettings } from "../googleAuth.cjs";
import { providerBase } from "../providerHttp.cjs";
import { startFakeGoogle, FAKE_GOOGLE_CREDENTIALS } from "./fakeGoogle.mjs";

const noLocalTimes = { publicOpenTimes: () => ({ times: [], hasMore: false, timeZone: "America/Phoenix" }) };
const slot = { title: "Admissions interview", startsAt: "2030-01-07T16:00:00Z", endsAt: "2030-01-07T16:30:00Z" };
let google;

before(async () => { google = await startFakeGoogle(); });
after(async () => { await google.close(); });
beforeEach(() => {
  Object.assign(google.state, { tokenMode: "ok", eventMode: "ok", expiresIn: 3600, delayMs: 0, tokenCalls: 0, unauthorizedServed: false });
  google.state.issued.length = 0;
  google.state.events.length = 0;
  google.state.revoked.clear();
});

const meeting = (extraEnv = {}) => createIntegrations({ meeting: "google-meet" }, noLocalTimes, google.env(extraEnv)).meeting;
const isUnavailable = (pattern) => (error) => error.status === 503 && error.code === "INTEGRATION_UNAVAILABLE" && pattern.test(error.message);
const leaksNothing = (error) => !Object.values(FAKE_GOOGLE_CREDENTIALS).some((secret) => error.message.includes(secret)) && !/fake-access-token/.test(error.message);

test("google-meet is an allowed meeting mode chosen by configuration", () => {
  assert.equal(resolveModes({}, { TALA_MEETING_ADAPTER: "google-meet" }).meeting, "google-meet");
  assert.equal(meeting().mode, "google-meet");
});

test("creates a Calendar event with a Meet link in Tucson time and sends no Google invites", async () => {
  const result = await meeting({ TALA_GOOGLE_CALENDAR_ID: "admissions@example.test" }).createMeeting(slot);
  assert.equal(result.provider, "google-meet");
  assert.equal(result.status, "ready");
  assert.match(result.joinUrl, /^https:\/\/meet\.google\.com\/[a-z0-9-]+$/);
  assert.equal(result.startsAt, "2030-01-07T16:00:00.000Z");
  const [sent] = google.state.events;
  assert.equal(sent.calendarId, "admissions@example.test");
  assert.deepEqual(sent.query, { conferenceDataVersion: "1", sendUpdates: "none" });
  assert.equal(sent.body.start.timeZone, "America/Phoenix");
  assert.equal(sent.body.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
  assert.match(sent.body.conferenceData.createRequest.requestId, /^[0-9a-f-]{36}$/);
});

test("one access token is fetched and reused across meetings, even when they start together", async () => {
  const adapter = meeting();
  await Promise.all([adapter.createMeeting(slot), adapter.createMeeting(slot), adapter.createMeeting(slot)]);
  await adapter.createMeeting(slot);
  assert.equal(google.state.tokenCalls, 1);
  assert.equal(google.state.events.length, 4);
});

test("an access token near expiry is refreshed before use", async () => {
  google.state.expiresIn = 30; // inside the 60-second early-refresh window
  const adapter = meeting();
  await adapter.createMeeting(slot);
  await adapter.createMeeting(slot);
  assert.equal(google.state.tokenCalls, 2);
});

test("a 401 from Calendar refreshes the token once and retries once", async () => {
  google.state.eventMode = "unauthorized_once";
  const result = await meeting().createMeeting(slot);
  assert.equal(result.status, "ready");
  assert.equal(google.state.tokenCalls, 2);
});

test("a revoked token keeps failing after one retry and asks staff to reconnect", async () => {
  const adapter = meeting();
  await adapter.createMeeting(slot);
  google.state.revoked.add(google.state.issued[0]);
  google.state.tokenMode = "invalid_grant";
  await assert.rejects(adapter.createMeeting(slot), (error) => isUnavailable(/reconnect/)(error) && leaksNothing(error));
});

test("wrong credentials are reported as a sign-in problem without echoing them", async () => {
  const adapter = createIntegrations({ meeting: "google-meet" }, noLocalTimes, google.env({ TALA_GOOGLE_REFRESH_TOKEN: "some-other-refresh-token" })).meeting;
  await assert.rejects(adapter.createMeeting(slot), (error) => isUnavailable(/reconnect/)(error) && !error.message.includes("some-other-refresh-token"));
});

for (const [eventMode, label] of [["quota", "403 quota"], ["error500", "500 outage"], ["failure", "conference failure"], ["no_link", "a non-Meet link"]]) {
  test(`${label} returns 503 and never a made-up link`, async () => {
    google.state.eventMode = eventMode;
    await assert.rejects(meeting().createMeeting(slot), (error) => isUnavailable(/unavailable right now/)(error) && leaksNothing(error));
  });
}

test("a token endpoint outage or bad response returns 503", async () => {
  for (const tokenMode of ["error500", "bad_json"]) {
    google.state.tokenMode = tokenMode;
    await assert.rejects(meeting().createMeeting(slot), isUnavailable(/unavailable right now/), tokenMode);
  }
});

test("a pending conference is reported as pending with no link", async () => {
  google.state.eventMode = "pending";
  const result = await meeting().createMeeting(slot);
  assert.equal(result.status, "pending");
  assert.equal(result.joinUrl, null);
});

test("a slow provider times out instead of hanging the request", async () => {
  google.state.delayMs = 1500;
  const started = Date.now();
  await assert.rejects(meeting({ TALA_PROVIDER_TIMEOUT_MS: "300" }).createMeeting(slot), isUnavailable(/unavailable right now/));
  assert.ok(Date.now() - started < 1400, "gave up at the configured timeout");
});

test("bad meeting input is rejected before Google is called", async () => {
  await assert.rejects(meeting().createMeeting({ ...slot, endsAt: slot.startsAt }), (error) => error.status === 400);
  assert.equal(google.state.tokenCalls, 0);
});

test("missing credentials stop the adapter with a setup message, not a secret", async () => {
  const env = google.env({ TALA_GOOGLE_CLIENT_SECRET: "" });
  assert.throws(() => createIntegrations({ meeting: "google-meet" }, noLocalTimes, env).meeting, /clientSecret is missing/);
  assert.throws(() => createGoogleTokenSource({ ...googleSettings(env) }), /clientSecret is missing/);
});

test("provider addresses must be HTTPS except a local test server", () => {
  assert.equal(providerBase("https://oauth2.googleapis.com/token", "X"), "https://oauth2.googleapis.com/token");
  assert.equal(providerBase("http://127.0.0.1:9999/", "X"), "http://127.0.0.1:9999");
  assert.throws(() => providerBase("http://oauth2.googleapis.com/token", "X"), /HTTPS/);
  assert.throws(() => providerBase("https://user:pass@example.com", "X"), /credentials/);
  assert.throws(() => googleSettings({ TALA_PROVIDER_TIMEOUT_MS: "5" }), /100 to 60000/);
});
