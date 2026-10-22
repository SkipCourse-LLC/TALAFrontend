"use strict";
const { runtimeRevision, dataScope, assertCurrentRevision } = require("./runtimeIdentity.cjs");
const http = require("node:http");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { openDatabase, transaction } = require("./database.cjs");
const { createServices, userDTO, MAX_FILE_BYTES } = require("./services.cjs");
const { createAccountServices } = require("./accountServices.cjs");
const { ApiError, fail, object, text, email, password, hash, token, hashPassword, verifyPassword, constantEqual } = require("./security.cjs");
assertCurrentRevision();

function createApplication(options = {}) {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24 or newer is required.");
  if (process.env.NODE_ENV === "production") throw new Error("Production hosting requires a reviewed HTTPS, mail, backup and data-protection configuration. This launcher is local-only.");
  const downloadTtl = options.downloadTtlMs === undefined ? 30_000 : options.downloadTtlMs;
  if (!Number.isSafeInteger(downloadTtl) || downloadTtl < 100 || downloadTtl > 30_000) throw new Error("Private download deadlines must be 100 to 30000 milliseconds.");
  process.umask(0o077);
  const dataDir = path.resolve(options.dataDir || path.join(__dirname, ".runtime"));
  const instanceScope = dataScope(dataDir);
  const allowedOrigins = new Set(options.allowedOrigins || ["http://127.0.0.1:5173", "http://127.0.0.1:5176", "http://localhost:5173", "http://localhost:5176", "http://127.0.0.1:8787"]);
  if (!allowedOrigins.size || [...allowedOrigins].some((origin) => { try { return new URL(origin).origin !== origin; } catch { return true; } })) throw new Error("Configure explicit application origins, never a wildcard.");
  const db = openDatabase(dataDir);
  const { services, operator, lists, contactRequests } = createServices(db, dataDir);
  const sessionTtl = options.sessionTtlMs || 12 * 3600000;
  const cookieName = "tala_session";
  function currentSession(req) {
    const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter((parts) => parts.length === 2));
    const value = cookies[cookieName];
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    const session = db.prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?").get(hash(value), Date.now());
    if (!session) return null;
    const user = session.uid ? db.prepare("SELECT * FROM users WHERE uid=? AND disabled=0").get(session.uid) : null;
    if (session.uid && !user) { db.prepare("DELETE FROM sessions WHERE token_hash=?").run(session.token_hash); return null; }
    return { ...session, user };
  }
  function rotate(req, res, user) {
    const opaque = token(), csrfToken = token(), ttl = user ? sessionTtl : 3600000;
    let responseUser;
    transaction(db, () => {
      // Re-read after acquiring the writer lock; earlier reads can't authorize the new session.
      if (req.method !== "GET") {
        mutation(req);
        if (req.headers["x-tala-user"] !== undefined) actorFor(req);
      }
      const previous = currentSession(req), now = Date.now();
      // Create the account in the same transaction so a failed session write doesn't reserve the email.
      responseUser = typeof user === "function" ? user() : user;
      if (responseUser) {
        const fresh = db.prepare("SELECT * FROM users WHERE uid=? AND disabled=0").get(responseUser.uid);
        if (!fresh || fresh.password_hash !== responseUser.password_hash) fail(401, "INVALID_CREDENTIALS", "The account credentials changed. Sign in again.");
        responseUser = fresh;
      }
      if (previous) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(previous.token_hash);
      db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
      db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").run(hash(opaque), responseUser?.uid || null, csrfToken, now + ttl, now);
    });
    setSessionCookie(res, opaque, ttl);
    return { session: responseUser ? userDTO(responseUser) : null, csrfToken };
  }
  function setSessionCookie(res, opaque, ttl) {
    res.setHeader("Set-Cookie", `${cookieName}=${opaque}; Path=/api; Max-Age=${Math.floor(ttl / 1000)}; HttpOnly; SameSite=Strict`);
  }
  function rate(req, group, max = 40, client = req.socket.remoteAddress || "unknown") {
    const key = hash(`${group}\0${client}`), now = Date.now(), window = 15 * 60000;
    transaction(db, () => {
      const previous = db.prepare("SELECT * FROM rate_limits WHERE key=?").get(key);
      if (!previous || previous.window_start <= now - window) db.prepare("INSERT INTO rate_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,hits=1").run(key, now);
      else {
        if (previous.hits >= max) fail(429, "RATE_LIMITED", "Too many requests. Try again later.");
        db.prepare("UPDATE rate_limits SET hits=hits+1 WHERE key=?").run(key);
      }
    });
  }
  function actorFor(req) {
    const session = currentSession(req);
    if (!session?.user) fail(401, "AUTH_REQUIRED", "Sign in before continuing.");
    const expectedUid = req.headers["x-tala-user"];
    if (expectedUid !== undefined && expectedUid !== session.user.uid) fail(401, "AUTH_REQUIRED", "Your signed-in account changed. Refresh before continuing.");
    Object.defineProperty(session.user, "sessionTokenHash", { value: session.token_hash, enumerable: false });
    return session.user;
  }
  function mutation(req) {
    const session = currentSession(req);
    if (!session || !constantEqual(req.headers["x-csrf-token"], session.csrf_token)) fail(403, "CSRF_INVALID", "Your security session changed. Refresh and try again.");
  }
  const accounts = createAccountServices(db, {
    sessionTtl, userDTO,
    context(req, changing = false) {
      if (changing) mutation(req);
      const user = actorFor(req), session = currentSession(req);
      if (!session?.user || session.user.uid !== user.uid) fail(401, "AUTH_REQUIRED", "Your security session expired or changed. Sign in again.");
      return { user: session.user, session };
    },
  });
  async function perform(req, action, raw = false) {
    const input = await body(req, raw);
    mutation(req);
    return action(actorFor(req), input);
  }
  async function body(req, raw = false) {
    const limit = raw ? MAX_FILE_BYTES : 65536;
    if (!raw && (req.headers["content-type"] || "").split(";")[0].trim() !== "application/json") fail(415, "UNSUPPORTED_TYPE", "Send this request as JSON.");
    const declared = req.headers["content-length"];
    if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > limit)) fail(413, "TOO_LARGE", "This request is too large.");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) fail(413, "TOO_LARGE", "This request is too large.");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (raw) return bytes;
    try { return JSON.parse(bytes.toString("utf8")); } catch { fail(400, "INVALID_INPUT", "Send a valid JSON object."); }
  }
  function json(res, value, status = 200) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(value));
  }
  let downloads = 0;
  let uploads = 0;
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    try {
      if (!/^(127\.0\.0\.1|localhost)(:[0-9]+)?$/.test(req.headers.host || "")) fail(403, "ORIGIN_DENIED", "This local server does not accept this host.");
      const origin = req.headers.origin;
      const changing = !["GET", "HEAD"].includes(req.method);
      if ((origin && !allowedOrigins.has(origin)) || (changing && !origin)) fail(403, "ORIGIN_DENIED", "This application origin is not authorized.");
      const url = new URL(req.url, "http://127.0.0.1");
      const route = url.pathname;
      if (!route.startsWith("/api/")) fail(404, "NOT_FOUND", "This endpoint is unavailable.");
      if (changing) mutation(req);
      if (req.method === "GET" && route === "/api/health") return json(res, { application: "tala-independent-server", version: 1, contractVersion: 5, schemaVersion: 3, runtimeRevision, instanceScope, status: "ok", authentication: "local-server", emailDelivery: "unavailable", zoom: "unavailable", ai: "unavailable", payment: "unavailable" });
      if (req.method === "GET" && route === "/api/session") {
        // Cross-site navigations omit SameSite=Strict cookies; don't replace a signed-in session.
        if (req.headers["sec-fetch-site"] === "cross-site") fail(403, "ORIGIN_DENIED", "This application origin is not authorized.");
        const existing = currentSession(req);
        if (existing) return json(res, { session: existing.user ? userDTO(existing.user) : null, csrfToken: existing.csrf_token });
        rate(req, "session", 200);
        return json(res, rotate(req, res, null));
      }
      if (req.method === "POST" && route === "/api/auth/register") {
        rate(req, "authentication");
        const input = object(await body(req), ["name", "email", "password", "accountType"]);
        const name = text(input.name, "display name", 80), address = email(input.email), secret = password(input.password);
        if (!["student", "parent"].includes(input.accountType)) fail(400, "INVALID_INPUT", "Choose a student or parent account.");
        if (db.prepare("SELECT uid FROM users WHERE email=? COLLATE NOCASE").get(address)) fail(409, "ACCOUNT_EXISTS", "An account with this email already exists. Sign in instead.");
        if (currentSession(req)?.user) fail(409, "CONFLICT", "Sign out before creating another account.");
        const encoded = await hashPassword(secret);
        return json(res, rotate(req, res, () => {
          if (currentSession(req)?.user) fail(409, "CONFLICT", "Sign out before creating another account.");
          if (db.prepare("SELECT uid FROM users WHERE email=? COLLATE NOCASE").get(address)) fail(409, "ACCOUNT_EXISTS", "An account with this email already exists. Sign in instead.");
          const uid = randomUUID();
          db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(uid, address, name, encoded, input.accountType, Date.now());
          return db.prepare("SELECT * FROM users WHERE uid=?").get(uid);
        }), 201);
      }
      if (req.method === "POST" && route === "/api/auth/login") {
        rate(req, "authentication");
        const input = object(await body(req), ["email", "password"]), address = email(input.email), secret = password(input.password, false);
        const user = db.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").get(address);
        if (!await verifyPassword(secret, user?.password_hash) || !user || user.disabled) fail(401, "INVALID_CREDENTIALS", "The email or password is incorrect.");
        mutation(req);
        const current = db.prepare("SELECT * FROM users WHERE uid=? AND disabled=0").get(user.uid);
        if (!current || current.password_hash !== user.password_hash) fail(401, "INVALID_CREDENTIALS", "The email or password is incorrect.");
        return json(res, rotate(req, res, current));
      }
      if (req.method === "POST" && route === "/api/auth/logout") {
        if (req.headers["x-tala-user"] !== undefined) actorFor(req);
        object(await body(req), []);
        mutation(req);
        if (req.headers["x-tala-user"] !== undefined) actorFor(req);
        return json(res, rotate(req, res, null));
      }
      if (req.method === "GET" && route === "/api/public/open-times") {
        rate(req, "public-open-times", 300);
        if ([...url.searchParams.keys()].length) fail(400, "INVALID_INPUT", "The public calendar does not accept filters.");
        return json(res, services.publicOpenTimes());
      }
      if (req.method === "POST" && route === "/api/contact-requests") {
        const input = contactRequests.validate(await body(req));
        rate(req, "contact-request", 10);
        rate(req, "contact-request-all", 200, "all-clients");
        return json(res, contactRequests.submit(input), 201);
      }
      const actor = actorFor(req);
      let match;
      if (req.method === "GET" && route === "/api/account/sessions") {
        rate(req, "account-session-read", 120);
        return json(res, lists.read(actor, () => accounts.sessions(req)));
      }
      if (req.method === "POST" && route === "/api/account/sessions/revoke") {
        rate(req, "account-session-revoke", 40);
        return json(res, await perform(req, (_fresh, input) => accounts.revoke(req, input)));
      }
      if (req.method === "POST" && route === "/api/account/sessions/revoke-others") {
        rate(req, "account-session-revoke", 40);
        return json(res, await perform(req, (_fresh, input) => accounts.revokeOthers(req, input)));
      }
      if (req.method === "POST" && route === "/api/account/password") {
        rate(req, "account-password-change", 20);
        const completed = await perform(req, (_fresh, input) => accounts.changePassword(req, input));
        if (completed.cookie) setSessionCookie(res, completed.cookie.opaque, completed.cookie.ttl);
        return json(res, completed.response);
      }
      if (req.method === "GET" && (match = route.match(/^\/api\/account\/password-changes\/([^/]+)$/))) {
        rate(req, "account-session-read", 120);
        return json(res, lists.read(actor, () => accounts.passwordChangeReceipt(req, match[1])));
      }
      if (req.method === "GET" && route === "/api/workspace") return json(res, services.workspace(actor, url.searchParams.get("studentUid")));
      if (req.method === "GET" && route === "/api/evidence") return json(res, lists.evidence(actor, url.searchParams));
      if (req.method === "GET" && route === "/api/appointments") return json(res, lists.appointments(actor, url.searchParams));
      if (req.method === "GET" && (match = route.match(/^\/api\/appointments\/([^/]+)$/))) return json(res, lists.appointment(actor, match[1]));
      if (req.method === "GET" && route === "/api/available-times") return json(res, lists.availableTimes(actor, url.searchParams));
      if (req.method === "GET" && route === "/api/operations/evidence") return json(res, lists.operatorEvidence(actor, url.searchParams));
      if (req.method === "GET" && route === "/api/operations/appointments") return json(res, lists.operatorAppointments(actor, url.searchParams));
      if (req.method === "GET" && route === "/api/operations/contact-requests") return json(res, contactRequests.list(actor, url.searchParams));
      if (req.method === "POST" && (match = route.match(/^\/api\/operations\/contact-requests\/([^/]+)\/status$/))) return json(res, await perform(req, (fresh, input) => contactRequests.setStatus(fresh, match[1], input)));
      if (req.method === "GET" && route === "/api/operations/learning") return json(res, lists.operatorLearning(actor, url.searchParams));
      if (req.method === "PATCH" && route === "/api/profile") return json(res, await perform(req, (fresh, input) => services.updateProfile(fresh, input)));
      if (req.method === "GET" && route === "/api/availability") return json(res, lists.availability(actor, url.searchParams));
      if (req.method === "POST" && route === "/api/availability") return json(res, await perform(req, (fresh, input) => services.availability(fresh, input)), 201);
      if (req.method === "POST" && route === "/api/appointments") return json(res, await perform(req, (fresh, input) => services.reserve(fresh, input)), 201);
      if (req.method === "PATCH" && (match = route.match(/^\/api\/availability\/([^/]+)$/))) return json(res, await perform(req, (fresh, input) => services.updateAvailability(fresh, match[1], input)));
      if (req.method === "POST" && (match = route.match(/^\/api\/availability\/([^/]+)\/withdraw$/))) return json(res, await perform(req, (fresh, input) => services.withdrawAvailability(fresh, match[1], input)));
      if (req.method === "POST" && (match = route.match(/^\/api\/appointments\/([^/]+)\/reschedule$/))) return json(res, await perform(req, (fresh, input) => services.reserve(fresh, input, match[1])));
      if (req.method === "POST" && (match = route.match(/^\/api\/appointments\/([^/]+)\/cancel$/))) return json(res, await perform(req, (fresh, input) => services.cancelBooking(fresh, match[1], input)));
      if (req.method === "POST" && route === "/api/evidence/uploads/cleanup") return json(res, await perform(req, (fresh, input) => { object(input, []); return services.cleanupExpired(fresh); }));
      if (req.method === "GET" && route === "/api/evidence/uploads") return json(res, lists.read(actor, () => services.pendingUploads(actor)));
      if (req.method === "POST" && route === "/api/evidence/uploads") return json(res, await perform(req, (fresh, input) => services.createUpload(fresh, input)), 201);
      if (req.method === "GET" && (match = route.match(/^\/api\/evidence\/uploads\/([^/]+)$/))) return json(res, lists.read(actor, () => services.uploadStatus(actor, match[1])));
      if (req.method === "PUT" && (match = route.match(/^\/api\/evidence\/uploads\/([^/]+)\/content$/))) {
        if (actor.role === "parent") fail(403, "FORBIDDEN", "Parent access is read-only until delegated permissions are approved.");
        rate(req, "file-upload", 200);
        if (uploads >= 4) fail(429, "RATE_LIMITED", "Too many file uploads. Try again shortly.");
        uploads += 1;
        try {
          return json(res, await perform(req, (fresh, input) => services.writeUpload(fresh, match[1], (req.headers["content-type"] || "").split(";")[0].trim(), input), true));
        } finally { uploads -= 1; }
      }
      if (req.method === "POST" && (match = route.match(/^\/api\/evidence\/uploads\/([^/]+)\/submit$/))) return json(res, await perform(req, (fresh, input) => services.submit(fresh, match[1], input)));
      if (req.method === "POST" && (match = route.match(/^\/api\/evidence\/uploads\/([^/]+)\/cancel$/))) { return json(res, await perform(req, (fresh, input) => { object(input, []); return services.cancelUpload(fresh, match[1]); })); }
      if (req.method === "GET" && (match = route.match(/^\/api\/evidence\/([^/]+)\/content$/))) {
        if (downloads >= 4) fail(429, "RATE_LIMITED", "Too many file downloads. Try again shortly.");
        downloads += 1;
        // requestTimeout doesn't cover slow readers; enforce an absolute deadline.
        const deadline = setTimeout(() => res.destroy(), downloadTtl);
        deadline.unref();
        let released = false;
        const release = () => { if (!released) { released = true; clearTimeout(deadline); downloads -= 1; } };
        res.once("finish", release); res.once("close", release);
        try {
          const file = lists.read(actor, () => services.download(actor, match[1]));
          res.setHeader("Content-Type", file.contentType);
          res.setHeader("Content-Length", file.bytes.length);
          res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
          res.setHeader("X-Content-SHA256", file.sha256);
          res.end(file.bytes);
        } catch (error) { release(); throw error; }
        return;
      }
      if (req.method === "GET" && (match = route.match(/^\/api\/evidence\/([^/]+)$/))) return json(res, lists.read(actor, () => services.evidence(actor, match[1])));
      if (req.method === "GET" && route === "/api/learning") return json(res, lists.learning(actor, url.searchParams));
      if (req.method === "GET" && (match = route.match(/^\/api\/learning\/([^/]+)$/))) return json(res, lists.learningRecord(actor, match[1]));
      if (req.method === "POST" && route === "/api/outcomes") return json(res, await perform(req, (fresh, input) => services.publish(fresh, input)), 201);
      if (req.method === "POST" && (match = route.match(/^\/api\/outcomes\/([^/]+)\/acknowledge$/))) return json(res, await perform(req, (fresh, input) => services.acknowledge(fresh, match[1], input)));
      if (req.method === "GET" && route === "/api/family") return json(res, lists.read(actor, () => services.family(actor)));
      if (req.method === "GET" && route === "/api/operations") return json(res, lists.read(actor, () => services.operations(actor)));
      if (req.method === "POST" && (match = route.match(/^\/api\/evidence\/([^/]+)\/review$/))) return json(res, await perform(req, (fresh, input) => services.review(fresh, match[1], input)));
      fail(404, "NOT_FOUND", "This endpoint is unavailable.");
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const known = error instanceof ApiError;
      json(res, { error: { code: known ? error.code : "INTERNAL_ERROR", message: known ? error.message : "The server could not complete this request. Try again." } }, known ? error.status : 500);
    }
  });
  server.keepAliveTimeout = 5000;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
  }
  return { server, db, operator, close };
}
module.exports = { createApplication };
