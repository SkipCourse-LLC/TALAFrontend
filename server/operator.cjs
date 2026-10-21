"use strict";
const path = require("node:path");
const { createApplication } = require("./application.cjs");
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (rest.length % 2) throw new Error("Use explicit --name value option pairs.");
  const fields = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!/^--[a-zA-Z]+$/.test(rest[index]) || fields[rest[index].slice(2)] !== undefined) throw new Error("Unsupported operator options.");
    fields[rest[index].slice(2)] = rest[index + 1];
  }
  const allowed = { promote: ["email"], "add-availability": ["startsAt", "endsAt", "label"], "link-family": ["studentUid", "parentUid", "consentReference"], "revoke-family": ["studentUid", "parentUid"], "cleanup-expired": [] };
  if (!allowed[command] || Object.keys(fields).some((key) => !allowed[command].includes(key))) throw new Error("Commands: promote --email existing@example.test; add-availability --startsAt ISO --endsAt ISO; link-family --studentUid UID --parentUid UID --consentReference REF.");
  const app = createApplication({ dataDir: process.env.TALA_DATA_DIR || path.join(__dirname, ".runtime") });
  try {
    const result = command === "promote" ? app.operator.promote(fields.email) : command === "add-availability" ? app.operator.addAvailability(fields) : command === "link-family" ? app.operator.linkFamily(fields) : command === "revoke-family" ? app.operator.revokeFamily(fields) : app.operator.cleanupExpired();
    console.log(JSON.stringify(result));
  } finally { await app.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "The local operator command failed."); process.exitCode = 1; });
