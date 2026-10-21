"use strict";
const { randomBytes, createHash, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const derive = promisify(scrypt);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const PASSWORD_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 268435456 };
let pending = 0;
let cryptoQueue = Promise.resolve();
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new ApiError(status, code, message); }
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) fail(400, "INVALID_INPUT", "The request contains unsupported fields.");
  return value;
}
function text(value, label, max = 100) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) fail(400, "INVALID_INPUT", `Enter a valid ${label}.`);
  return value.trim();
}
function identifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail(400, "INVALID_INPUT", "This record identifier is invalid.");
  return value;
}
function requestId(value) {
  identifier(value);
  if (value.length < 16) fail(400, "INVALID_INPUT", "Use a unique request identifier.");
  return value;
}
function email(value) {
  const normalized = text(value, "email address", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail(400, "INVALID_INPUT", "Enter a valid email address.");
  return normalized;
}
function password(value, register = true) {
  if (typeof value !== "string" || value.length > 128 || value.length < (register ? 12 : 1)) fail(400, "INVALID_INPUT", "Use a password containing 12 to 128 characters.");
  return value;
}
async function expensive(fn) {
  if (pending >= 8) fail(429, "RATE_LIMITED", "Too many sign-in requests. Try again shortly.");
  pending += 1;
  const result = cryptoQueue.then(fn);
  cryptoQueue = result.catch(() => undefined);
  try { return await result; } finally { pending -= 1; }
}
async function hashPassword(value) {
  return expensive(async () => {
    const salt = randomBytes(16).toString("hex");
    const key = await derive(value, salt, 64, PASSWORD_OPTIONS);
    return `scrypt$131072$8$1$${salt}$${key.toString("hex")}`;
  });
}
async function verifyPassword(value, encoded) {
  return expensive(async () => {
    const parts = typeof encoded === "string" ? encoded.split("$") : [];
    const valid = parts.length === 6 && parts[0] === "scrypt" && parts[1] === "131072" && parts[2] === "8" && parts[3] === "1" && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
    const salt = valid ? parts[4] : "00000000000000000000000000000000";
    const expected = Buffer.from(valid ? parts[5] : "00".repeat(64), "hex");
    const actual = await derive(value, salt, 64, PASSWORD_OPTIONS);
    return timingSafeEqual(actual, expected) && valid;
  });
}
function constantEqual(first, second) {
  if (typeof first !== "string" || typeof second !== "string") return false;
  const left = Buffer.from(first), right = Buffer.from(second);
  return left.length === right.length && timingSafeEqual(left, right);
}
module.exports = { ApiError, fail, object, text, identifier, requestId, email, password, hash, token, hashPassword, verifyPassword, constantEqual };
