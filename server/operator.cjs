"use strict";
const path = require("node:path");
const { createApplication } = require("./application.cjs");
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (rest.length % 2) throw new Error("Use explicit --name value option pairs.");
  const fields = Object.create(null);
  for (let index = 0; index < rest.length; index += 2) {
    if (!/^--[a-zA-Z]+$/.test(rest[index]) || Object.hasOwn(fields, rest[index].slice(2))) throw new Error("Unsupported operator options.");
    fields[rest[index].slice(2)] = rest[index + 1];
  }
  const allowed = { promote: ["email"], "add-availability": ["startsAt", "endsAt", "label"], "link-family": ["studentUid", "parentUid", "consentReference"], "revoke-family": ["studentUid", "parentUid"], "cleanup-expired": [] };
  if (!Object.hasOwn(allowed, command) || Object.keys(fields).some((key) => !allowed[command].includes(key))) throw new Error("Commands: promote --email existing@example.test; add-availability --startsAt ISO --endsAt ISO; link-family --studentUid UID --parentUid UID --consentReference REF.");
  const required = command === "add-availability" ? ["startsAt", "endsAt"] : allowed[command];
  if (required.some((key) => !Object.hasOwn(fields, key) || !fields[key].trim())) throw new Error("Provide every required operator option before opening the local database.");
  const app = createApplication({ dataDir: process.env.TALA_DATA_DIR || path.join(__dirname, ".runtime") });
  try {
    const result = command === "promote" ? app.operator.promote(fields.email) : command === "add-availability" ? app.operator.addAvailability(fields) : command === "link-family" ? app.operator.linkFamily(fields) : command === "revoke-family" ? app.operator.revokeFamily(fields) : app.operator.cleanupExpired();
    console.log(JSON.stringify(result));
  } finally { await app.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "The local operator command failed."); process.exitCode = 1; });
