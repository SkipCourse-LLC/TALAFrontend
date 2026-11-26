"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { PROJECT_ID, BUCKET, assertLocalRuntime } = require("./local-runtime.cjs");

assertLocalRuntime(process.env, false);
initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });

async function seed() {
  const db = getFirestore();
  const day = new Date();
  day.setUTCHours(18, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + 1);
  const batch = db.batch();
  // Idempotent seeding never replaces occupied slots or deletes any data.
  for (let offset = 0; offset < 15; offset += 1) {
    const start = new Date(day.getTime() + Math.floor(offset / 3) * 24 * 60 * 60 * 1000 + (offset % 3) * 60 * 60 * 1000);
    const id = `local-${start.toISOString().slice(0, 16).replace(/[^0-9]/g, "")}`;
    const ref = db.doc(`tala_local_slots/${id}`);
    if ((await ref.get()).exists) continue;
    batch.create(ref, {
      label: "Synthetic local meeting slot", kind: "synthetic-local", environment: "emulator",
      startAt: Timestamp.fromDate(start), endAt: Timestamp.fromMillis(start.getTime() + 30 * 60 * 1000),
      isAvailable: true, appointmentId: null, meetingIntegration: "unavailable",
    });
  }
  await batch.commit();
  console.log("Synthetic local availability is ready. No external meeting was created.");
}

seed().catch(() => { console.error("Local seeding failed. Confirm all emulators are running for demo-tala-local."); process.exitCode = 1; });
