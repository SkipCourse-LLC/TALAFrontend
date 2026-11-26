// Gmail adapter against the local fake Google server. No real Google account,
// network access or secret is used.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createIntegrations, resolveModes } from "../integrations.cjs";
import { buildMime } from "../gmailAdapter.cjs";
import { startFakeGoogle, FAKE_GOOGLE_CREDENTIALS } from "./fakeGoogle.mjs";

const noLocalTimes = { publicOpenTimes: () => ({ times: [], hasMore: false, timeZone: "America/Phoenix" }) };
const SENDER = "admissions@school.example.test";
const message = { to: "parent@example.test", subject: "Your TALA interview", text: "Hello,\nYour interview is booked.\n\nTALA" };
let google;

before(async () => { google = await startFakeGoogle(); });
after(async () => { await google.close(); });
beforeEach(() => {
  Object.assign(google.state, { tokenMode: "ok", gmailMode: "ok", expiresIn: 3600, tokenCalls: 0 });
  google.state.issued.length = 0;
  google.state.messages.length = 0;
  google.state.revoked.clear();
});

const gmail = (extraEnv = {}) => createIntegrations({ email: "gmail" }, noLocalTimes, google.env({ TALA_GMAIL_SENDER: SENDER, ...extraEnv })).email;
const unavailable = (pattern) => (error) => error.status === 503 && error.code === "INTEGRATION_UNAVAILABLE" && pattern.test(error.message)
  && !Object.values(FAKE_GOOGLE_CREDENTIALS).some((secret) => error.message.includes(secret));
const headers = (decoded) => Object.fromEntries(decoded.split("\r\n\r\n")[0].split("\r\n").map((line) => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 2)]));
const body = (decoded) => Buffer.from(decoded.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");

test("gmail is an allowed email mode chosen by configuration", () => {
  assert.equal(resolveModes({}, { TALA_EMAIL_ADAPTER: "gmail" }).email, "gmail");
  assert.equal(gmail().mode, "gmail");
});

test("sends a plain-text message from the configured TALA sender", async () => {
  const receipt = await gmail().send(message);
  assert.deepEqual(receipt, { id: "fakemessage1", status: "sent" });
  const [sent] = google.state.messages;
  const head = headers(sent.decoded);
  assert.equal(head.from, SENDER);
  assert.equal(head.to, "parent@example.test");
  assert.equal(head.subject, "Your TALA interview");
  assert.equal(head["content-type"], "text/plain; charset=UTF-8");
  assert.equal(body(sent.decoded), "Hello,\r\nYour interview is booked.\r\n\r\nTALA");
});

test("non-English subjects and bodies survive encoding", async () => {
  await gmail().send({ ...message, subject: "Entrevista confirmada — TALA", text: "¡Hola! Nos vemos pronto." });
  const [sent] = google.state.messages;
  assert.match(headers(sent.decoded).subject, /^=\?UTF-8\?B\?/);
  assert.equal(Buffer.from(headers(sent.decoded).subject.slice(10, -2), "base64").toString("utf8"), "Entrevista confirmada — TALA");
  assert.equal(body(sent.decoded), "¡Hola! Nos vemos pronto.");
});

test("header injection is refused before anything is sent", async () => {
  const adapter = gmail();
  for (const bad of [
    { ...message, subject: "Hi\r\nBcc: victim@example.test" },
    { ...message, to: "parent@example.test\r\nBcc: victim@example.test" },
    { ...message, to: "parent@example.test, other@example.test" },
    { ...message, extra: "field" },
  ]) await assert.rejects(adapter.send(bad), (error) => error.status === 400);
  assert.equal(google.state.messages.length, 0);
  assert.equal(google.state.tokenCalls, 0, "validation happens before Google is contacted");
});

test("the token is fetched once and shared with the meeting adapter", async () => {
  const integrations = createIntegrations({ email: "gmail", meeting: "google-meet" }, noLocalTimes, google.env({ TALA_GMAIL_SENDER: SENDER }));
  await integrations.email.send(message);
  await integrations.meeting.createMeeting({ title: "Interview", startsAt: "2030-01-07T16:00:00Z", endsAt: "2030-01-07T16:30:00Z" });
  await integrations.email.send(message);
  assert.equal(google.state.tokenCalls, 1);
});

test("a rejected sign-in asks staff to reconnect; outages and rate limits return 503", async () => {
  google.state.gmailMode = "unauthorized";
  await assert.rejects(gmail().send(message), unavailable(/reconnect/));
  for (const gmailMode of ["rate_limited", "error500"]) {
    google.state.gmailMode = gmailMode;
    await assert.rejects(gmail().send(message), unavailable(/unavailable right now/), gmailMode);
  }
  assert.equal(google.state.messages.length, 0);
});

test("a missing or invalid sender stops startup with a setup message", () => {
  assert.throws(() => createIntegrations({ email: "gmail" }, noLocalTimes, google.env()), /TALA_GMAIL_SENDER/);
  assert.throws(() => createIntegrations({ email: "gmail" }, noLocalTimes, google.env({ TALA_GMAIL_SENDER: "1 admissions@school.example.test" })), /TALA_GMAIL_SENDER/);
});

test("mock email keeps line breaks and uses the same validation as Gmail", async () => {
  const mock = createIntegrations({ email: "mock" }, noLocalTimes, {}).email;
  await mock.send(message);
  assert.equal(mock.outbox()[0].text, message.text);
  await assert.rejects(mock.send({ ...message, subject: "a\nb" }), (error) => error.status === 400);
});

test("MIME output has no bare line feeds in the headers", () => {
  const mime = buildMime({ from: SENDER, to: "parent@example.test", subject: "Hi", text: "a\nb" });
  assert.ok(!/[^\r]\n/.test(mime));
});
