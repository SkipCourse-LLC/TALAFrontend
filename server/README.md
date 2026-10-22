# Independent local TALA server

Requires Node.js 24 or newer; uses built-in HTTP, SQLite and crypto with no npm dependencies. From the repository root, `npm --prefix server start` starts the loopback API on port 8787. The frontend's `npm run dev` starts both services. `TALA_DATA_DIR` selects the private data directory; its default is `server/.runtime`. Do not commit this directory, database backups, sessions or private files.

The current HTTP contract is version 4 with database schema 2. Resource lists use stable, account/filter-bound cursors; copy `nextCursor` only into the same query, and refresh the first page after a password change or an invalid cursor. Most pages contain up to 50 items; learning records default to 20, with a maximum of 25 to keep valid multilingual summaries within the response limit. Each page and direct-record read checks current session, role and family permission again. The legacy operations aggregate is a bounded preview; clients should use the dedicated paged endpoints in `contract.json`.

Local health includes startup source and data-directory digests. They help the launcher refuse stale code or an unintended database without exposing its path; they are not authentication credentials. Restart the API after code changes.

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

## Explicit private backups

The local backup tool snapshots committed SQLite data and copies the matching private Evidence and unfinished-upload bytes while holding the server's write fence. Prefer stopping the API or a local maintenance window: large copies can exceed the API's five-second database wait and cause in-flight writes to fail safely. It verifies database relationships, file sizes and SHA-256 checksums. It never uploads anything and never overwrites an existing directory. Evaluate it with invented data first:

```sh
node server/backup.cjs create --dataDir /private/path/to/runtime --outputDir /private/path/tala-backup-review
node server/backup.cjs verify --directory /private/path/tala-backup-review
node server/backup.cjs restore --directory /private/path/tala-backup-review --outputDir /private/path/tala-backup-restored
```

Choose an existing private parent directory and a **new** output directory starting with `tala-backup-`; these names are ignored by Git. The tool rejects nested destinations, symlinks, inconsistent files, unsupported schema versions and production mode. Files use 0600 and directories use 0700. Backups contain sensitive accounts, password hashes and private records: local filesystem permissions are not encryption or a hosted backup service. Checksums detect corruption; an unsigned manifest does not prove a backup's origin. Use only trusted protected local copies.

Restore only creates a separate copy. It clears every restored session, requiring sign-in again, and leaves the source runtime and backup unchanged. **Passwords, roles, family permissions and records return to their snapshot values**; review subsequent security changes and approved relationships before selecting a restored runtime with `TALA_DATA_DIR`. This is not an automatic production recovery procedure.

Saved Evidence is capped at 100 MiB / 1,000 versions per owner and 2 GiB / 20,000 versions per local instance; unfinished reservations count when creating an upload and saved totals are checked again on submission. These are logical application limits, not a cap on database logs, backups or total disk consumption. Full storage refuses new submissions without deleting existing records. Retention and any approved quota increase need operator review. Up to four file bodies are accepted concurrently. Unexpired unfinished uploads can be recovered from the student's Evidence view; a missing file must be reselected and match its original checksum. Parents cannot view upload drafts.

Uploads use a private per-intent scratch file and atomic promotion. After an interrupted write, an explicit retry must match the saved checksum; only unsubmitted staging artifacts can be repaired. A saved Evidence file is never replaced by this recovery path. Manual review notes and learning summaries support bounded plain-text paragraphs; line breaks do not grant HTML or executable formatting.
