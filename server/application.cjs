"use strict";
const { runtimeRevision, dataScope, assertCurrentRevision } = require("./runtimeIdentity.cjs");
const http = require("node:http");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { openDatabase, transaction } = require("./database.cjs");
const { createServices, userDTO, MAX_FILE_BYTES } = require("./services.cjs");
const { createAdmissions } = require("./admissions.cjs");
const { createPayments } = require("./payments.cjs");
const { createAccountServices } = require("./accountServices.cjs");
const { ApiError, fail, object, text, email, password, hash, token, hashPassword, verifyPassword, constantEqual } = require("./security.cjs");
assertCurrentRevision();

function createApplication(options = {}) {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24 or newer is required.");
  if (process.env.NODE_ENV === "production") throw new Error("Production hosting requires a reviewed HTTPS, mail, backup and data-protection configuration. This launcher is local-only.");
  const localStudentPreview = options.localStudentPreview === undefined ? process.env.TALA_LOCAL_STUDENT_PREVIEW === "1" : options.localStudentPreview;
  if (typeof localStudentPreview !== "boolean") throw new Error("Choose an explicit boolean for local student preview mode.");
  const downloadTtl = options.downloadTtlMs === undefined ? 30_000 : options.downloadTtlMs;
  if (!Number.isSafeInteger(downloadTtl) || downloadTtl < 100 || downloadTtl > 30_000) throw new Error("Private download deadlines must be 100 to 30000 milliseconds.");
  process.umask(0o077);
  const dataDir = path.resolve(options.dataDir || path.join(__dirname, ".runtime"));
  const instanceScope = dataScope(dataDir);
  const allowedOrigins = new Set(options.allowedOrigins || ["http://127.0.0.1:5173", "http://127.0.0.1:5176", "http://localhost:5173", "http://localhost:5176", "http://127.0.0.1:8787"]);
  if (!allowedOrigins.size || [...allowedOrigins].some((origin) => { try { return new URL(origin).origin !== origin; } catch { return true; } })) throw new Error("Configure explicit application origins, never a wildcard.");
  const db = openDatabase(dataDir);
  const { services, operator, lists, goals, updates, preparations, reflectionDrafts, calendar, admissionsContext } = createServices(db, dataDir, { localStudentPreview });
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
      // Acquiring SQLite's writer lock can wait for another local process.
      // Values read before that wait cannot authorize the replacement session.
      if (req.method !== "GET") {
        mutation(req);
        if (req.headers["x-tala-user"] !== undefined) actorFor(req);
      }
      const previous = currentSession(req), now = Date.now();
      // Registration creates the account under the same writer fence as the
      // session. A session-write failure must not reserve an unusable email.
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
  function rate(req, group, max = 40) {
    const key = hash(`${group}\0${req.socket.remoteAddress || "unknown"}`), now = Date.now(), window = 15 * 60000;
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
  const admissions = createAdmissions(db, { ...admissionsContext, session: currentSession, mutation });
  const payments = createPayments(db, { guard: admissionsContext.guard, read: lists.read, config: options.paymentConfig, provider: options.paymentProvider || null });
  operator.addInterviewTime = input => admissions.addAvailability(input);
  operator.createTestOperator = async input => {
    const address = email(input.email), name = input.name ? text(input.name, "operator name", 80) : "Tina · local test";
    if (!/^[^@]+@(?:[a-z0-9-]+\.)*example\.test$/.test(address)) fail(400, "INVALID_INPUT", "This local provisioning command accepts only fictional example.test addresses.");
    const secret = `Local-${token()}`, encoded = await hashPassword(secret);
    return transaction(db, () => {
      if (db.prepare("SELECT uid FROM users WHERE email=? COLLATE NOCASE").get(address)) fail(409, "ACCOUNT_EXISTS", "This test account already exists; no credentials were changed.");
      const uid = randomUUID();
      db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'operator',?)").run(uid, address, name, encoded, Date.now());
      return { uid, email: address, password: secret, role: "operator", mode: "local_test", note: "Keep this generated credential private. This account exists only in the local evaluation database." };
    });
  };
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
      if (route === "/api/auth/local-student-preview" && !localStudentPreview) fail(404, "NOT_FOUND", "This local preview entry is unavailable.");
      if (changing) mutation(req);
      if (req.method === "GET" && route === "/api/health") return json(res, { application: "tala-independent-server", version: 1, contractVersion: 12, schemaVersion: 11, runtimeRevision, instanceScope, status: "ok", authentication: "local-server", emailDelivery: "unavailable", zoom: "unavailable", ai: "unavailable", payment: "hubspot_checkout", paymentVerification: payments.integration().verification, calendar: "local_catalog", localStudentPreview });
      if (req.method === "GET" && route === "/api/session") {
        // A cross-site top-level navigation omits SameSite=Strict cookies but
        // can still accept Set-Cookie. Do not overwrite a signed-in browser
        // with an anonymous session when it follows an external link here.
        if (req.headers["sec-fetch-site"] === "cross-site") fail(403, "ORIGIN_DENIED", "This application origin is not authorized.");
        const existing = currentSession(req);
        if (existing) return json(res, { session: existing.user ? userDTO(existing.user) : null, csrfToken: existing.csrf_token });
        rate(req, "session", 200);
        return json(res, rotate(req, res, null));
      }
      if (req.method === "POST" && route === "/api/auth/local-student-preview") {
        // This deliberately public fictional identity exists only in an
        // explicitly enabled loopback presentation environment. It grants no
        // school admission, family link or staff access, and never selects an
        // existing person's account by their supplied email.
        let previewOrigin;
        try { previewOrigin = new URL(origin); } catch { fail(403, "ORIGIN_DENIED", "Student preview is available on this computer only."); }
        if (previewOrigin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(previewOrigin.hostname)
          || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) fail(403, "ORIGIN_DENIED", "Student preview is available on this computer only.");
        rate(req, "local-student-preview", 30);
        object(await body(req), []);
        mutation(req);
        if (currentSession(req)?.user) fail(409, "ACTIVE_SESSION", "Sign out before entering the student preview.");
        const uid = "tala_local_preview_student_v1", address = "student-preview@local.example.test";
        const old = db.prepare("SELECT * FROM users WHERE uid=?").get(uid);
        // A fresh unpredictable password verifier prevents normal password
        // login using a source-code default. The secret is never returned.
        const encoded = old ? null : await hashPassword(token());
        return json(res, rotate(req, res, () => {
          if (currentSession(req)?.user) fail(409, "ACTIVE_SESSION", "Sign out before entering the student preview.");
          let row = db.prepare("SELECT * FROM users WHERE uid=?").get(uid);
          if (row) {
            if (row.email !== address || row.role !== "student" || row.disabled) fail(409, "CONFLICT", "The dedicated preview identity is unavailable. No account was changed.");
          } else {
            if (!encoded || db.prepare("SELECT uid FROM users WHERE email=? COLLATE NOCASE").get(address)) fail(409, "CONFLICT", "The dedicated preview identity is unavailable. No account was changed.");
            db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'student',?)").run(uid, address, "Alex · student demo", encoded, Date.now());
            row = db.prepare("SELECT * FROM users WHERE uid=?").get(uid);
          }
          return row;
        }));
      }
      if (req.method === "POST" && route === "/api/auth/register") {
        rate(req, "authentication");
        fail(403, "ENROLLMENT_INVITATION_REQUIRED", "Start an interest application. An approved enrollment invitation is required to create a TALA account.");
      }
      if (req.method === "POST" && route === "/api/auth/enroll") {
        rate(req, "authentication");
        const input = object(await body(req), ["token", "name", "password"]);
        const secret = password(input.password);
        text(input.name, "parent name", 80);
        admissions.inspect({ token: input.token });
        if (currentSession(req)?.user) fail(409, "CONFLICT", "Sign out before accepting an enrollment invitation.");
        const encoded = await hashPassword(secret);
        const result = rotate(req, res, () => {
          if (currentSession(req)?.user) fail(409, "CONFLICT", "Sign out before accepting an enrollment invitation.");
          return admissions.enroll(input, encoded);
        });
        admissions.clearCookie(res);
        return json(res, result, 201);
      }
      if (req.method === "GET" && route === "/api/admissions/current") return json(res, admissions.current(req));
      if (req.method === "POST" && route === "/api/admissions/applications") {
        rate(req, "admissions-submit", 12);
        return json(res, admissions.submit(req, res, await body(req)), 201);
      }
      if (req.method === "POST" && route === "/api/admissions/interview") {
        rate(req, "admissions-write", 100);
        return json(res, admissions.book(req, await body(req)));
      }
      if (req.method === "POST" && route === "/api/admissions/document-preference") return json(res, admissions.preference(req, await body(req)));
      if (req.method === "POST" && route === "/api/admissions/documents/intents") {
        rate(req, "admissions-upload", 60);
        return json(res, admissions.intent(req, await body(req)), 201);
      }
      if (req.method === "PUT" && /^\/api\/admissions\/documents\/[^/]+\/content$/.test(route)) {
        rate(req, "admissions-upload", 60);
        if (uploads >= 4) fail(429, "RATE_LIMITED", "Too many uploads. Try again shortly.");
        uploads++;
        try { const bytes = await body(req, true); return json(res, admissions.upload(req, route.split("/")[4], (req.headers["content-type"] || "").split(";")[0].trim(), bytes)); }
        finally { uploads--; }
      }
      if (req.method === "GET" && /^\/api\/admissions\/documents\/[^/]+\/content$/.test(route)) {
        rate(req, "admissions-download", 100);
        if (downloads >= 4) fail(429, "RATE_LIMITED", "Too many file downloads. Try again shortly.");
        const signed = currentSession(req)?.user;
        if (req.headers["x-tala-user"] !== undefined) actorFor(req);
        downloads++;
        const deadline = setTimeout(() => res.destroy(), downloadTtl); deadline.unref();
        let released = false;
        const release = () => { if (!released) { released = true; clearTimeout(deadline); downloads--; } };
        res.once("finish", release); res.once("close", release);
        try {
          const file = admissions.download(req, signed ? actorFor(req) : null, route.split("/")[4]);
          res.setHeader("Content-Type", file.contentType); res.setHeader("Content-Length", file.bytes.length);
          res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`); res.setHeader("X-Content-SHA256", file.sha256);
          return res.end(file.bytes);
        } catch (error) { release(); throw error; }
      }
      if (req.method === "POST" && route === "/api/admissions/invitation/inspect") {
        rate(req, "admissions-invitation", 60);
        const input = await body(req); mutation(req);
        return json(res, admissions.inspect(input));
      }
      if (req.method === "POST" && route === "/api/admissions/access/end") {
        object(await body(req), []); return json(res, admissions.end(req, res));
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
      const actor = actorFor(req);
      let match;
      if (req.method === "GET" && route === "/api/admissions/parent") return json(res, admissions.parent(actor));
      if (req.method === "GET" && route === "/api/operator/admissions") return json(res, admissions.list(actor));
      if (req.method === "POST" && route === "/api/operator/admissions/availability") return json(res, await perform(req, (fresh, input) => admissions.publish(fresh, input)), 201);
      if (req.method === "GET" && (match = route.match(/^\/api\/operator\/admissions\/([^/]+)$/))) return json(res, admissions.detail(actor, match[1]));
      if (req.method === "POST" && (match = route.match(/^\/api\/operator\/admissions\/([^/]+)\/review$/))) return json(res, await perform(req, (fresh, input) => admissions.review(fresh, match[1], input)));
      if (req.method === "POST" && (match = route.match(/^\/api\/operator\/admissions\/([^/]+)\/invitation$/))) return json(res, await perform(req, (fresh, input) => admissions.issue(fresh, match[1], input)));

      if (req.method === "POST" && (match = route.match(/^\/api\/operator\/admissions\/([^/]+)\/student-setup$/))) {
        rate(req, "student-setup-authorize", 60);
        return json(res, await perform(req, (fresh, input) => admissions.authorizeStudentSetup(fresh, match[1], input)));
      }
      if (req.method === "POST" && (match = route.match(/^\/api\/admissions\/([^/]+)\/student-account$/))) {
        rate(req, "student-account-create", 20);
        return json(res, await perform(req, (fresh, input) => admissions.provisionStudent(fresh, match[1], input)), 201);
      }

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
      if (req.method === "GET" && route === "/api/payments") return json(res, payments.workspace(actor, url.searchParams));
      if (req.method === "POST" && route === "/api/payments/checkout") {
        rate(req, "payment-checkout", 30);
        return json(res, await perform(req, (fresh, input) => payments.checkout(fresh, input, url.searchParams)), 201);
      }
      if (req.method === "POST" && route === "/api/payments/esa") {
        rate(req, "payment-esa", 20);
        return json(res, await perform(req, (fresh, input) => payments.esa(fresh, input, url.searchParams)), 201);
      }
      if (req.method === "POST" && (match = route.match(/^\/api\/payments\/([^/]+)\/verify$/))) {
        rate(req, "payment-verify", 60);
        return json(res, await perform(req, (fresh, input) => payments.verify(fresh, match[1], input, url.searchParams)));
      }
      if (req.method === "GET" && route === "/api/operator/payments") return json(res, payments.operations(actor, url.searchParams));
      if (req.method === "POST" && route === "/api/operator/payments/items") {
        rate(req, "payment-issue", 60);
        return json(res, await perform(req, (fresh, input) => payments.issue(fresh, input, url.searchParams)), 201);
      }
      if (req.method === "GET" && route === "/api/workspace") return json(res, services.workspace(actor, url.searchParams.get("studentUid")));
      if (req.method === "GET" && route === "/api/classes") return json(res, lists.read(actor, () => calendar.catalog(actor, url.searchParams)));
      if (req.method === "POST" && route === "/api/classes/saved") {
        rate(req, "class-save", 120);
        return json(res, await perform(req, (fresh, input) => calendar.save(fresh, input, url.searchParams)));
      }
      if (req.method === "GET" && route === "/api/classes/enrollments") return json(res, lists.read(actor, () => calendar.enrollments(actor, url.searchParams)));
      if (req.method === "POST" && route === "/api/classes") return json(res, await perform(req, (fresh, input) => calendar.create(fresh, input, url.searchParams)), 201);
      if (req.method === "PATCH" && (match = route.match(/^\/api\/classes\/([^/]+)$/))) return json(res, await perform(req, (fresh, input) => calendar.update(fresh, match[1], input, url.searchParams)));
      if (req.method === "GET" && (match = route.match(/^\/api\/classes\/([^/]+)\/roster-export$/))) return json(res, lists.read(actor, () => calendar.rosterExport(actor, match[1], url.searchParams)));
      if (req.method === "POST" && route === "/api/classes/withdraw") return json(res, await perform(req, (fresh, input) => calendar.withdraw(fresh, input, url.searchParams)));
      if (req.method === "POST" && route === "/api/classes/approval") return json(res, await perform(req, (fresh, input) => calendar.approval(fresh, input, url.searchParams)));
      if (req.method === "GET" && route === "/api/calendar") return json(res, lists.read(actor, () => calendar.get(actor, url.searchParams)));
      if (req.method === "POST" && route === "/api/calendar/enrollments") {
        rate(req, "calendar-enrollment", 120);
        return json(res, await perform(req, (fresh, input) => calendar.enroll(fresh, input, url.searchParams)));
      }
      if (req.method === "POST" && route === "/api/calendar/enrollments/preferences") {
        rate(req, "class-request-preferences", 100);
        return json(res, await perform(req, (fresh, input) => calendar.preferences(fresh, input, url.searchParams)));
      }
      if (req.method === "POST" && route === "/api/calendar/enrollments/cancel") {
        rate(req, "calendar-enrollment", 120);
        return json(res, await perform(req, (fresh, input) => calendar.cancel(fresh, input, url.searchParams)));
      }
      if (req.method === "GET" && route === "/api/evidence") return json(res, lists.evidence(actor, url.searchParams));
      if (req.method === "GET" && route === "/api/appointments") return json(res, lists.appointments(actor, url.searchParams));
      if (req.method === "GET" && (match = route.match(/^\/api\/appointments\/([^/]+)$/))) return json(res, lists.appointment(actor, match[1]));
      if (req.method === "GET" && route === "/api/available-times") return json(res, lists.availableTimes(actor, url.searchParams));
      if (req.method === "GET" && route === "/api/operations/evidence") return json(res, lists.operatorEvidence(actor, url.searchParams));
      if (req.method === "GET" && route === "/api/operations/appointments") return json(res, lists.operatorAppointments(actor, url.searchParams));
      if (req.method === "GET" && route === "/api/operations/learning") return json(res, lists.operatorLearning(actor, url.searchParams));
      if (req.method === "PATCH" && route === "/api/profile") return json(res, await perform(req, (fresh, input) => services.updateProfile(fresh, input)));
      if (req.method === "GET" && route === "/api/availability") return json(res, lists.availability(actor, url.searchParams));
      if (req.method === "POST" && route === "/api/availability") return json(res, await perform(req, (fresh, input) => services.availability(fresh, input)), 201);
      if (req.method === "POST" && route === "/api/appointments") return json(res, await perform(req, (fresh, input) => services.reserve(fresh, input)), 201);
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
        // requestTimeout bounds incoming requests, not a client that stops
        // reading a response. An absolute deadline also defeats slow drips.
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
      if (req.method === "GET" && route === "/api/reflection-draft") return json(res, lists.read(actor, () => reflectionDrafts.get(actor, url.searchParams)));
      if (req.method === "POST" && route === "/api/reflection-draft") return json(res, await perform(req, (fresh, input) => reflectionDrafts.save(fresh, input, url.searchParams)));
      if (req.method === "POST" && route === "/api/reflection-draft/clear") return json(res, await perform(req, (fresh, input) => reflectionDrafts.clear(fresh, input, url.searchParams)));
      if (req.method === "GET" && (match = route.match(/^\/api\/appointments\/([^/]+)\/preparation$/))) return json(res, lists.read(actor, () => preparations.get(actor, match[1], url.searchParams)));
      if (req.method === "PATCH" && (match = route.match(/^\/api\/appointments\/([^/]+)\/preparation$/))) return json(res, await perform(req, (fresh, input) => preparations.save(fresh, match[1], input)));
      if (req.method === "GET" && route === "/api/learning-goals") return json(res, lists.read(actor, () => goals.list(actor, url.searchParams)));
      if (req.method === "POST" && route === "/api/learning-goals") return json(res, await perform(req, (fresh, input) => goals.create(fresh, input)), 201);
      if (req.method === "PATCH" && (match = route.match(/^\/api\/learning-goals\/([^/]+)$/))) return json(res, await perform(req, (fresh, input) => goals.update(fresh, match[1], input)));
      if (req.method === "GET" && (match = route.match(/^\/api\/learning-goals\/([^/]+)\/evidence$/))) return json(res, lists.read(actor, () => goals.evidence(actor, match[1], url.searchParams)));
      if (req.method === "POST" && (match = route.match(/^\/api\/learning-goals\/([^/]+)\/evidence$/))) return json(res, await perform(req, (fresh, input) => goals.linkEvidence(fresh, match[1], input)));
      if (req.method === "GET" && route === "/api/updates") return json(res, lists.read(actor, () => updates.list(actor, url.searchParams)));
      if (req.method === "POST" && route === "/api/updates/read-all") return json(res, await perform(req, (fresh, input) => updates.readAll(fresh, input)));
      if (req.method === "POST" && (match = route.match(/^\/api\/updates\/([^/]+)\/read$/))) return json(res, await perform(req, (fresh, input) => updates.markRead(fresh, match[1], input)));
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
