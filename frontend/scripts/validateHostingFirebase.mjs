import console from "node:console";
import process from "node:process";

const required = [
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_APP_ID",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  for (const name of missing)
    console.error(`::error::Configure the GitHub Actions variable ${name}.`);
  process.exitCode = 1;
}
