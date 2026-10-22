import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient } from "./support.mjs";

test("cross-site session navigation cannot create or replace a browser session", { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-session-navigation-http-"));
  const origin = "http://127.0.0.1:5173";
  const app = createApplication({ dataDir, allowedOrigins: [origin] });
  try {
    await new Promise((resolve, reject) => {
      app.server.once("error", reject);
      app.server.listen(0, "127.0.0.1", resolve);
    });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const client = new SyntheticHttpClient(base, origin);
    await client.bootstrap();
    const registration = await client.request("/api/auth/register", {
      method: "POST",
      json: { name: "Synthetic navigation account", email: `${randomUUID()}@example.test`, password: `Synthetic-only-${randomUUID()}`, accountType: "student" },
    });
    assert.equal(registration.status, 201);
    const uid = registration.json.session.uid;
    const cookie = client.cookies.get("tala_session");
    const sessionCount = app.db.prepare("SELECT count(*) AS n FROM sessions").get().n;
    for (const includeCookie of [false, true]) {
      const headers = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" };
      if (includeCookie) headers.Cookie = `tala_session=${cookie}`;
      const response = await fetch(`${base}/api/session`, { headers, signal: AbortSignal.timeout(5_000) });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, "ORIGIN_DENIED");
      assert.deepEqual(response.headers.getSetCookie(), [], "Cross-site requests must never replace the cookie");
      assert.equal(app.db.prepare("SELECT count(*) AS n FROM sessions").get().n, sessionCount, "Rejected navigations must not allocate or alter sessions");
    }
    for (const site of [undefined, "none", "same-origin", "same-site"]) {
      const headers = { Cookie: `tala_session=${cookie}` };
      if (site) headers["Sec-Fetch-Site"] = site;
      const response = await fetch(`${base}/api/session`, { headers, signal: AbortSignal.timeout(5_000) });
      assert.equal(response.status, 200, "Direct visits, same-site browsers and non-browser clients remain supported");
      assert.equal((await response.json()).session.uid, uid);
      assert.deepEqual(response.headers.getSetCookie(), []);
    }
    const invalidOrigin = await fetch(`${base}/api/session`, {
      headers: { Cookie: `tala_session=${cookie}`, Origin: "http://localhost:12345", "Sec-Fetch-Site": "same-site" },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(invalidOrigin.status, 403, "Fetch Metadata must not weaken the existing Origin check");
    await invalidOrigin.arrayBuffer();
    assert.equal((await client.request("/api/session")).json.session.uid, uid);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
