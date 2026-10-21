import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createApplication } from "../application.cjs";
import { SyntheticHttpClient, assertNoPrivateLocation } from "./support.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

test("the schema-v1 upgrade preserves existing synthetic sessions, ownership and private evidence bytes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-migration-test-"));
  let application;
  try {
    const filename = join(dataDir, "tala.sqlite");
    const old = new DatabaseSync(filename);
    const uid = randomUUID(),
      slotId = randomUUID(),
      appointmentId = randomUUID(),
      evidenceId = randomUUID();
    const opaque = randomBytes(32).toString("base64url"),
      csrf = randomBytes(32).toString("base64url");
    const now = Date.now();
    const bytes = Buffer.from(
      "Synthetic legacy evidence preserved across an additive schema upgrade.",
    );
    try {
      old.exec(
        await readFile(
          new URL("./fixtures/schema-v1.sql", import.meta.url),
          "utf8",
        ),
      );
      old
        .prepare(
          "INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          uid,
          `${randomUUID()}@example.test`,
          "Synthetic legacy student",
          "unused-synthetic-fixture",
          "student",
          now,
        );
      old
        .prepare("INSERT INTO sessions VALUES(?,?,?,?,?)")
        .run(digest(opaque), uid, csrf, now + 3_600_000, now);
      old
        .prepare("INSERT INTO slots VALUES(?,?,?,?,?)")
        .run(
          slotId,
          now - 3_600_000,
          now - 1_800_000,
          "Legacy synthetic booking",
          now,
        );
      old
        .prepare("INSERT INTO appointments VALUES(?,?,?,?,?,?)")
        .run(appointmentId, uid, slotId, "ended", now, now);
      old
        .prepare("INSERT INTO uploads VALUES(?,?,?,?,?,?,?,'submitted',?,?)")
        .run(
          evidenceId,
          uid,
          appointmentId,
          "Legacy private reflection",
          "text/plain",
          bytes.length,
          digest(bytes),
          now,
          now + 1_200_000,
        );
      old
        .prepare(
          "INSERT INTO evidence(id,owner_uid,appointment_id,title,content_type,size,sha256,submitted_at,review_status,review_note,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          evidenceId,
          uid,
          appointmentId,
          "Legacy private reflection",
          "text/plain",
          bytes.length,
          digest(bytes),
          now,
          "needs_revision",
          "Synthetic existing staff note",
          now,
        );
      assert.equal(old.prepare("PRAGMA user_version").get().user_version, 1);
    } finally {
      old.close();
    }
    await mkdir(join(dataDir, "evidence"), { mode: 0o700 });
    await writeFile(join(dataDir, "evidence", `${evidenceId}.bin`), bytes, {
      mode: 0o600,
    });
    application = createApplication({
      dataDir,
      allowedOrigins: ["http://127.0.0.1:5173"],
    });
    assert.equal(
      application.db.prepare("PRAGMA user_version").get().user_version,
      2,
    );
    assert.deepEqual(
      application.db.prepare("PRAGMA foreign_key_check").all(),
      [],
    );
    const backups = (await readdir(join(dataDir, "backups"))).filter((name) =>
      /^tala-v1-.*\.sqlite$/.test(name),
    );
    assert.equal(
      backups.length,
      1,
      "A consistent pre-migration backup must exist before upgrading old records",
    );
    const backupPath = join(dataDir, "backups", backups[0]);
    assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.equal(backup.prepare("PRAGMA user_version").get().user_version, 1);
      assert.equal(
        backup
          .prepare("SELECT owner_uid FROM evidence WHERE id=?")
          .get(evidenceId).owner_uid,
        uid,
      );
      assert.equal(
        backup
          .prepare("SELECT uid FROM sessions WHERE token_hash=?")
          .get(digest(opaque)).uid,
        uid,
      );
      assert.equal(
        backup.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
    } finally {
      backup.close();
    }
    await new Promise((resolve) =>
      application.server.listen(0, "127.0.0.1", resolve),
    );
    const client = new SyntheticHttpClient(
      `http://127.0.0.1:${application.server.address().port}`,
    );
    client.cookies.set("tala_session", opaque);
    const session = await client.bootstrap();
    assert.equal(session.json.session.uid, uid);
    const workspace = await client.request("/api/workspace");
    assert.equal(workspace.status, 200);
    assert.equal(workspace.json.evidence[0].id, evidenceId);
    assert.equal(workspace.json.evidence[0].ownerUid, uid);
    assert.equal(workspace.json.evidence[0].reviewStatus, "needs_revision");
    assert.equal(
      workspace.json.evidence[0].reviewNote,
      "Synthetic existing staff note",
    );
    assert.equal(workspace.json.progress.submittedEvidenceCount, 1);
    assertNoPrivateLocation(workspace.json);
    const download = await client.request(
      `/api/evidence/${evidenceId}/content`,
    );
    assert.equal(download.status, 200);
    assert.equal(download.bytes.equals(bytes), true);
    await application.close();
    application = undefined;

    // Refuse an unknown newer format without changing its record contents.
    const future = new DatabaseSync(filename);
    future.exec("PRAGMA user_version=999");
    future.close();
    assert.throws(() => createApplication({ dataDir }), /newer schema/i);
    const check = new DatabaseSync(filename, { readOnly: true });
    try {
      assert.equal(
        check.prepare("PRAGMA user_version").get().user_version,
        999,
      );
      assert.equal(
        check
          .prepare("SELECT owner_uid FROM evidence WHERE id=?")
          .get(evidenceId).owner_uid,
        uid,
      );
    } finally {
      check.close();
    }
    assert.equal(
      (await readFile(join(dataDir, "evidence", `${evidenceId}.bin`))).equals(
        bytes,
      ),
      true,
    );
  } finally {
    await application?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
