// Opt-in: node --test server/test/sessionNavigation.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");

test("a genuine Chromium cross-site link preserves the existing signed-in cookie", { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-session-navigation-browser-"));
  const origin = "http://127.0.0.1:5173";
  let app, links, browser;
  try {
    app = createApplication({ dataDir, allowedOrigins: [origin] });
    await new Promise((resolve, reject) => {
      app.server.once("error", reject);
      app.server.listen(0, "127.0.0.1", resolve);
    });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    links = createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<html><body><a href="${base}/api/session">Open TALA account</a></body></html>`);
    });
    await new Promise((resolve, reject) => {
      links.once("error", reject);
      links.listen(0, "127.0.0.1", resolve);
    });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const bootstrap = await context.request.get(`${base}/api/session`);
    const csrf = (await bootstrap.json()).csrfToken;
    const registration = await context.request.post(`${base}/api/auth/register`, {
      headers: { Origin: origin, "X-CSRF-Token": csrf },
      data: { name: "Synthetic navigation account", email: `${randomUUID()}@example.test`, password: `Synthetic-only-${randomUUID()}`, accountType: "student" },
    });
    assert.equal(registration.status(), 201);
    const uid = (await registration.json()).session.uid;
    const page = await context.newPage();
    const direct = await page.goto(`${base}/api/session`);
    assert.equal((await direct.json()).session.uid, uid);
    const before = (await context.cookies(`${base}/api/session`)).find(cookie => cookie.name === "tala_session");
    assert.ok(before);
    assert.equal(before.sameSite, "Strict");
    await page.goto(`http://localhost:${links.address().port}`);
    const [navigation] = await Promise.all([
      page.waitForResponse(response => response.url() === `${base}/api/session`),
      page.getByRole("link", { name: "Open TALA account" }).click(),
    ]);
    await page.waitForURL(`${base}/api/session`);
    const requestHeaders = await navigation.request().allHeaders();
    assert.equal(requestHeaders["sec-fetch-site"], "cross-site", "The browser must generate the cross-site metadata itself");
    assert.equal(requestHeaders["sec-fetch-mode"], "navigate");
    assert.equal(requestHeaders.cookie, undefined, "Strict cookies are omitted by the browser on this real navigation");
    assert.equal(requestHeaders.origin, undefined);
    assert.equal(navigation.status(), 403);
    assert.equal((await navigation.allHeaders())["set-cookie"], undefined);
    const after = (await context.cookies(`${base}/api/session`)).find(cookie => cookie.name === "tala_session");
    assert.equal(after?.value, before.value, "The existing signed-in cookie must not be overwritten");
    const final = await context.request.get(`${base}/api/session`);
    assert.equal((await final.json()).session.uid, uid);
  } finally {
    await browser?.close();
    if (links) await new Promise(resolve => links.close(resolve));
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
