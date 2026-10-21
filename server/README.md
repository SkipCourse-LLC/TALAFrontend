# Independent local TALA server

Requires Node.js 24 or newer; uses built-in HTTP, SQLite and crypto with no npm dependencies. From the repository root, `npm --prefix server start` starts the loopback API on port 8787. The frontend's `npm run dev` starts both services. `TALA_DATA_DIR` selects the private data directory; its default is `server/.runtime`. Do not commit this directory, database backups, sessions or private files.

Accounts, bookings, Evidence files, operator reviews and published learning summaries persist across restarts. An empty database has no accounts, meeting availability or learning records. Operators publish actual available times; withdrawing an unbooked future time preserves its ID and booking history. Publishing the exact withdrawn interval restores the original ID and label. Changing the interval creates a different time slot.

Students can submit a linked revision after an operator requests changes. Earlier files and reviews remain readable. Submission atomically allows one successor per version; stale reviews and stale revision uploads return `CONFLICT`. Reviews require the current `reviewVersion`. Progress counts all submitted versions, with `revisionSubmissionCount` identifying revisions; a manual review is not an AI assessment, grade or academic credit. Parent access remains read-only through current operator-recorded links.

Local operator commands use existing registered accounts, for example:

```sh
node server/operator.cjs promote --email existing@example.test
node server/operator.cjs add-availability --startsAt 2027-01-05T17:00:00Z --endsAt 2027-01-05T17:30:00Z
node server/operator.cjs link-family --studentUid STUDENT_UID --parentUid PARENT_UID --consentReference APPROVED_REFERENCE
node server/operator.cjs revoke-family --studentUid STUDENT_UID --parentUid PARENT_UID
node server/operator.cjs cleanup-expired
```

Use approved relationship references; the command records a link and does not verify legal guardianship. Cleanup closes at most 100 expired, unsubmitted upload intents per explicit call and never removes submitted Evidence. There is no automatic retention worker.

## Local schema upgrade and rollback

Stop every process using the same local database before starting the new server. Schema 1 upgrades to schema 2 by adding three tables; existing users, sessions, booking times, reviews and file bytes are preserved. Before the transaction, SQLite `VACUUM INTO` creates a consistent database snapshot, including committed WAL content, at `<dataDir>/backups/tala-v1-<timestamp>-<UUID>.sqlite`. The snapshot is checked and saved with mode 0600 inside a 0700 directory. A failed backup or migration aborts startup. New empty databases start directly at schema 2. Newer, unsupported schema versions are refused.

The automatic snapshot contains the database, not a second copy of the private upload/Evidence directories. Keep those directories and the original runtime intact. To roll back, stop the server, preserve the entire current runtime separately, restore the verified version-1 snapshot as `tala.sqlite` in a **separate** private directory, and provide the matching `uploads` and `evidence` files. Point the compatible older server at that directory using `TALA_DATA_DIR`. Do not copy a live SQLite main file alone or mix its WAL with the standalone snapshot. Review any changes made after the snapshot before restoring: they are absent from the old database. Nothing restores, deletes or overwrites data automatically.

## Verification and release limits

`npm --prefix server run check` checks runtime syntax. `npm --prefix server test` runs isolated synthetic HTTP, permissions, file-lifecycle, concurrency and migration fixtures. Tests use temporary directories and do not migrate the actual runtime.

This launcher deliberately refuses production mode. Reviewed HTTPS hosting, account recovery/email delivery, secure MFA, verified guardian consent, data retention and operational backups remain release requirements. No email is currently sent; `emailVerified` remains false. Zoom, AI analysis and real payment are unavailable and are never reported as successful integrations. Do not use real student, medical or payment data for local validation.
