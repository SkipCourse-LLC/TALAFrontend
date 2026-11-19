import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient } from "./support.mjs";

// Role-aware sign-in: student, parent, alumni and staff. "staff" is the
// display name of the stored operator role.
test("each role signs in to its own access, set by an administrator and never by the sign-in form", { timeout: 60_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-role-access-test-"));
  const origin = "http://127.0.0.1:5173", app = createApplication({ dataDir, allowedOrigins: [origin] });
  try {
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    // Seed one fictional account per role through the administrator commands.
    async function account(label, role) {
      const seeded = await app.operator.createTestOperator({ email: `${label}@example.test`, name: `Synthetic ${label}` });
      const user = app.operator.setRole(seeded.email, role);
      const client = new SyntheticHttpClient(base, origin);
      await client.bootstrap();
      const login = () => client.request("/api/auth/login", { method: "POST", json: { email: seeded.email, password: seeded.password } });
      return { user, client, login, credentials: { email: seeded.email, password: seeded.password } };
    }
    const student = await account("student", "student"), other = await account("other-student", "student");
    const parent = await account("parent", "parent"), alumni = await account("alumni", "alumni"), staff = await account("staff", "staff");
    app.operator.linkFamily({ studentUid: student.user.uid, parentUid: parent.user.uid, consentReference: "approved-synthetic-access-reference" });
    assert.throws(() => app.operator.setRole(student.credentials.email, "administrator"), (error) => error.status === 400);

    // The role comes from the server session. A role sent by the form is refused.
    const forged = await student.client.request("/api/auth/login", { method: "POST", json: { ...student.credentials, role: "operator" } });
    assert.equal(forged.status, 400, "The sign-in form cannot choose a role");
    const expected = [[student, "student"], [parent, "parent"], [alumni, "alumni"], [staff, "operator"]];
    for (const [who, role] of expected) {
      const signedIn = await who.login();
      assert.equal(signedIn.status, 200);
      assert.equal(signedIn.json.session.role, role);
      assert.equal((await who.client.request("/api/session")).json.session.role, role, "A restored session keeps the stored role");
    }

    // No role can use another role's API.
    for (const who of [student, parent, alumni]) assert.equal((await who.client.request("/api/operations")).status, 403, "Only staff can open staff operations");
    assert.equal((await staff.client.request("/api/operations")).status, 200);
    for (const who of [other, alumni]) {
      if (who === other) await who.login();
      assert.equal((await who.client.request(`/api/workspace?studentUid=${student.user.uid}`)).status, 403, "Another account cannot read a student's workspace");
    }
    assert.equal((await alumni.client.request("/api/family")).status, 200);
    assert.deepEqual((await alumni.client.request("/api/family")).json.linkedProfiles, [], "An alumni account has no linked students");

    // A parent can view a linked student and no other student.
    assert.equal((await parent.client.request(`/api/workspace?studentUid=${student.user.uid}`)).status, 200);
    assert.equal((await parent.client.request(`/api/workspace?studentUid=${other.user.uid}`)).status, 403);

    // Signing out ends the session for every role.
    for (const [who] of expected) {
      assert.equal((await who.client.request("/api/auth/logout", { method: "POST", json: {} })).status, 200);
      assert.equal((await who.client.request("/api/session")).json.session, null);
      assert.equal((await who.client.request("/api/workspace")).status, 401);
    }

    // An expired session is refused for every role.
    for (const [who] of expected) assert.equal((await who.login()).status, 200);
    app.db.prepare("UPDATE sessions SET expires_at=0").run();
    for (const [who] of expected) assert.equal((await who.client.request("/api/workspace")).status, 401);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
