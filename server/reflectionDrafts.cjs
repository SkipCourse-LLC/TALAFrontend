"use strict";
const { fail, object, wellFormedText } = require("./security.cjs");

function createReflectionDraftServices(db, { operation, read }) {
  function studentOnly(actor) {
    if (actor.role !== "student") fail(403, "FORBIDDEN", "Only students can access their own private reflection draft. Parent and operator access is unavailable.");
  }
  function noQuery(params) {
    if ([...params.keys()].length) fail(400, "INVALID_INPUT", "A private reflection draft does not accept query parameters.");
  }
  function version(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) fail(400, "INVALID_INPUT", "Reload your private reflection draft and include its current version.");
    return value;
  }
  function dto(owner, row) {
    return { ownerUid: owner, title: row?.title ?? "", text: row?.body ?? "", status: row?.status ?? "empty",
      version: row?.version ?? 0, updatedAt: row ? new Date(row.updated_at).toISOString() : null };
  }
  const current = (owner) => db.prepare("SELECT * FROM reflection_drafts WHERE owner_uid=?").get(owner);
  function store(actor, expectedVersion, title, body, status) {
    const previous = current(actor.uid);
    if ((previous?.version ?? 0) !== expectedVersion) fail(409, "CONFLICT", "Your private reflection draft changed in another view. Reload it before saving or clearing again.");
    const nextVersion = expectedVersion + 1, now = Math.max(Date.now(), (previous?.updated_at ?? 0) + 1);
    db.prepare(`INSERT INTO reflection_drafts(owner_uid,title,body,status,version,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(owner_uid) DO UPDATE SET title=excluded.title,body=excluded.body,status=excluded.status,version=excluded.version,updated_at=excluded.updated_at`).run(actor.uid, title, body, status, nextVersion, now);
    // Retain only confirmation metadata in the idempotency ledger. A saved
    // reflection's words must not accumulate in historical operation receipts.
    return { version: nextVersion };
  }
  function confirmed(actor, receipt) {
    // A different local writer may have saved or cleared after COMMIT. Never
    // replay old content or claim that a superseded draft is still current.
    return read(actor, () => {
      studentOnly(actor);
      const row = current(actor.uid);
      if (!row || row.version !== receipt.version) fail(409, "CONFLICT", "This reflection save was superseded. Reload the current private draft before continuing.");
      return dto(actor.uid, row);
    });
  }
  return {
    get(actor, params) {
      studentOnly(actor); noQuery(params);
      return dto(actor.uid, current(actor.uid));
    },
    save(actor, input, params) {
      studentOnly(actor); noQuery(params); object(input, ["title", "text", "version", "requestId"]);
      if (!wellFormedText(input.title) || input.title.length > 120 || /[\x00-\x1f\x7f]/.test(input.title)) fail(400, "INVALID_INPUT", "Use a reflection draft title of 120 characters or fewer without unsupported characters.");
      if (!wellFormedText(input.text) || input.text.length > 5000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(input.text.replace(/\r\n/g, "\n"))) fail(400, "INVALID_INPUT", "Use a reflection draft of 5,000 characters or fewer in plain paragraphs.");
      if (!input.title.trim() && !input.text.trim()) fail(400, "INVALID_INPUT", "Write a draft title or reflection before saving. Use Clear draft to remove a saved draft.");
      const expectedVersion = version(input.version);
      const receipt = operation(actor, "save-reflection-draft", input.requestId, [input.title, input.text, expectedVersion], () => store(actor, expectedVersion, input.title, input.text, "saved"));
      return confirmed(actor, receipt);
    },
    clear(actor, input, params) {
      studentOnly(actor); noQuery(params); object(input, ["version", "requestId"]);
      const expectedVersion = version(input.version);
      const receipt = operation(actor, "clear-reflection-draft", input.requestId, [expectedVersion], () => store(actor, expectedVersion, "", "", "empty"));
      return confirmed(actor, receipt);
    },
  };
}
module.exports = { createReflectionDraftServices };
