"use strict";
const { createHmac } = require("node:crypto");
const { transaction } = require("./database.cjs");
const { fail, object, password, requestId, hash, token, verifyPassword, hashPassword, constantEqual } = require("./security.cjs");

const iso = (value) => new Date(value).toISOString();
const PASSWORD_OPERATION = "account-password-change";

// Handles can't authenticate: they differ from cookies, and password changes revoke them all.
function sessionHandle(user, session) {
  return `session_${createHmac("sha256", user.password_hash).update("tala-session-handle\0").update(session.token_hash).digest("base64url")}`;
}

function createAccountServices(db, { context, sessionTtl, userDTO }) {
  function receiptFor(uid, id) {
    return db.prepare("SELECT * FROM operations WHERE uid=? AND kind=? AND request_id=?").get(uid, PASSWORD_OPERATION, id);
  }
  function accountRate(uid) {
    const key = hash(`account-password-change\0${uid}`), now = Date.now(), window = 15 * 60000;
    transaction(db, () => {
      const previous = db.prepare("SELECT * FROM rate_limits WHERE key=?").get(key);
      if (!previous || previous.window_start <= now - window) db.prepare("INSERT INTO rate_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,hits=1").run(key, now);
      else {
        if (previous.hits >= 6) fail(429, "RATE_LIMITED", "Too many password-change attempts. Try again later.");
        db.prepare("UPDATE rate_limits SET hits=hits+1 WHERE key=?").run(key);
      }
    });
  }
  function sameContext(req, initial) {
    const fresh = context(req, true);
    if (fresh.user.uid !== initial.user.uid || fresh.session.token_hash !== initial.session.token_hash || fresh.user.password_hash !== initial.user.password_hash) fail(401, "AUTH_REQUIRED", "Your account security changed. Sign in again before continuing.");
    return fresh;
  }
  function receiptDTO(stored) {
    return { status: "completed", changedAt: stored.changedAt, revokedSessionCount: stored.revokedSessionCount };
  }
  function passwordReplay(req, current, previous, newSecret) {
    const stored = JSON.parse(previous.result_json);
    if (!constantEqual(stored.replacementSessionId, sessionHandle(current.user, current.session))) fail(409, "CONFLICT", "This password change belongs to a different security session. Refresh and sign in if needed.");
    // Don't store a fast password hash for fingerprinting; it would be a cheap offline verifier.
    return verifyPassword(newSecret, current.user.password_hash).then((matches) => {
      const fresh = sameContext(req, current);
      if (!matches) fail(409, "CONFLICT", "This request identifier already completed a different password change.");
      return { response: { session: userDTO(fresh.user), csrfToken: fresh.session.csrf_token, passwordChanged: true, changedAt: stored.changedAt, revokedSessionCount: stored.revokedSessionCount } };
    });
  }
  function revoke(req, input, others) {
    object(input, others ? ["requestId"] : ["sessionId", "requestId"]);
    requestId(input.requestId);
    if (!others && (typeof input.sessionId !== "string" || !/^session_[A-Za-z0-9_-]{43}$/.test(input.sessionId))) fail(400, "INVALID_INPUT", "Choose a valid session from your current session list.");
    return transaction(db, () => {
      const current = context(req, true);
      const kind = others ? "account-revoke-other-sessions" : "account-revoke-session";
      const fingerprint = hash(others ? "others" : input.sessionId);
      const previous = db.prepare("SELECT * FROM operations WHERE uid=? AND kind=? AND request_id=?").get(current.user.uid, kind, input.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409, "CONFLICT", "This request identifier was used for a different session operation.");
        return JSON.parse(previous.result_json);
      }
      let count;
      if (others) count = db.prepare("DELETE FROM sessions WHERE uid=? AND token_hash!=? AND expires_at>?").run(current.user.uid, current.session.token_hash, Date.now()).changes;
      else {
        const rows = db.prepare("SELECT * FROM sessions WHERE uid=? AND expires_at>?").all(current.user.uid, Date.now());
        const selected = rows.find((row) => constantEqual(sessionHandle(current.user, row), input.sessionId));
        if (!selected) fail(404, "NOT_FOUND", "This session is unavailable.");
        if (selected.token_hash === current.session.token_hash) fail(409, "CONFLICT", "Use Sign out to end the session you are currently using.");
        count = db.prepare("DELETE FROM sessions WHERE token_hash=? AND uid=?").run(selected.token_hash, current.user.uid).changes;
      }
      const result = { revokedSessionCount: count, currentSessionRevoked: false };
      db.prepare("INSERT INTO operations VALUES(?,?,?,?,?,?)").run(current.user.uid, kind, input.requestId, fingerprint, JSON.stringify(result), Date.now());
      return result;
    });
  }
  return {
    sessions(req) {
      const current = context(req);
      const rows = db.prepare("SELECT * FROM sessions WHERE uid=? AND expires_at>? ORDER BY (token_hash=?) DESC,created_at DESC,token_hash LIMIT 101").all(current.user.uid, Date.now(), current.session.token_hash);
      if (!rows.some((row) => row.token_hash === current.session.token_hash)) fail(401, "AUTH_REQUIRED", "Your security session expired. Sign in again.");
      return { sessions: rows.slice(0, 100).map((row) => ({ id: sessionHandle(current.user, row), current: row.token_hash === current.session.token_hash, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) })), hasMore: rows.length > 100 };
    },
    revoke(req, input) { return revoke(req, input, false); },
    revokeOthers(req, input) { return revoke(req, input, true); },
    passwordChangeReceipt(req, id) {
      requestId(id);
      const current = context(req);
      const previous = receiptFor(current.user.uid, id);
      const stored = previous && JSON.parse(previous.result_json);
      if (!stored || !constantEqual(stored.replacementSessionId, sessionHandle(current.user, current.session))) fail(404, "NOT_FOUND", "No completed password change is available for this session.");
      return receiptDTO(stored);
    },
    async changePassword(req, input) {
      object(input, ["currentPassword", "newPassword", "requestId"]);
      requestId(input.requestId);
      const oldSecret = password(input.currentPassword, false), newSecret = password(input.newPassword);
      const initial = context(req, true);
      accountRate(initial.user.uid);
      const previous = receiptFor(initial.user.uid, input.requestId);
      if (previous) return passwordReplay(req, initial, previous, newSecret);
      if (constantEqual(oldSecret, newSecret)) fail(400, "INVALID_INPUT", "Choose a new password that differs from your current password.");
      const matches = await verifyPassword(oldSecret, initial.user.password_hash);
      sameContext(req, initial);
      if (!matches) fail(401, "INVALID_CREDENTIALS", "The current password is incorrect.");
      const encoded = await hashPassword(newSecret);
      sameContext(req, initial);
      const opaque = token(), csrfToken = token();
      return transaction(db, () => {
        const current = sameContext(req, initial);
        const now = Date.now();
        if (receiptFor(current.user.uid, input.requestId)) fail(409, "CONFLICT", "This password change already completed. Refresh its completion status.");
        const count = db.prepare("SELECT count(*) AS n FROM sessions WHERE uid=? AND token_hash!=? AND expires_at>?").get(current.user.uid, current.session.token_hash, now).n;
        const changed = db.prepare("UPDATE users SET password_hash=? WHERE uid=? AND password_hash=? AND disabled=0").run(encoded, current.user.uid, initial.user.password_hash);
        if (changed.changes !== 1) fail(401, "AUTH_REQUIRED", "Your account security changed. Sign in again.");
        db.prepare("DELETE FROM sessions WHERE uid=?").run(current.user.uid);
        const replacement = { token_hash: hash(opaque), uid: current.user.uid, csrf_token: csrfToken, expires_at: now + sessionTtl, created_at: now };
        db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").run(replacement.token_hash, replacement.uid, replacement.csrf_token, replacement.expires_at, replacement.created_at);
        const user = db.prepare("SELECT * FROM users WHERE uid=? AND disabled=0").get(current.user.uid);
        const stored = { changedAt: iso(now), revokedSessionCount: count, replacementSessionId: sessionHandle(user, replacement) };
        db.prepare("INSERT INTO operations VALUES(?,?,?,?,?,?)").run(current.user.uid, PASSWORD_OPERATION, input.requestId, hash("password-change-receipt-v1"), JSON.stringify(stored), now);
        return { cookie: { opaque, ttl: sessionTtl }, response: { session: userDTO(user), csrfToken, passwordChanged: true, changedAt: stored.changedAt, revokedSessionCount: count } };
      });
    },
  };
}

module.exports = { createAccountServices };
