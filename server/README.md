# Independent local TALA server

Requires Node.js 24 or newer; uses built-in HTTP, SQLite and crypto with no npm dependencies. From the repository root, `npm --prefix server start` starts the loopback API on port 8787. The frontend's `npm run dev` starts both services. `TALA_DATA_DIR` selects the private data directory; its default is `server/.runtime`. Do not commit this directory, database backups, sessions or private files.

The current HTTP contract is version 6 with database schema 4. Resource lists use stable, account/filter-bound cursors; copy `nextCursor` only into the same query, and refresh the first page after a password change or an invalid cursor. Most pages contain up to 50 items; learning records default to 20, with a maximum of 25 to keep valid multilingual summaries within the response limit. Each page and direct-record read checks current session, role and family permission again. The legacy operations aggregate is a bounded preview; clients should use the dedicated paged endpoints in `contract.json`.

Student and linked-parent appointment pages accept optional `from` (inclusive) and `to` (exclusive) bounds on the meeting's start time. Use a real ISO calendar timestamp with seconds and an explicit `Z` or numeric offset; fractional seconds may contain one to three digits. Bounds are applied before paging, equivalent offsets share the same cursor scope, and equal or reversed ranges are rejected. Omitting both bounds preserves existing unfiltered cursors. These filters do not change reservations, attendance or operator views.

Local health includes startup source and data-directory digests. They help the launcher refuse stale code or an unintended database without exposing its path; they are not authentication credentials. Restart the API after code changes.

Accounts, bookings, Evidence files, operator reviews, published learning summaries and personal learning goals persist across restarts. An empty database has no accounts, meeting availability or learning records. Operators publish actual available times; withdrawing an unbooked future time preserves its ID and booking history. Publishing the exact withdrawn interval restores the original ID and label. Changing the interval creates a different time slot.

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

Stop every process using the same local database before starting the new server. Schema 1, 2 or 3 upgrades additively to schema 4; existing users, sessions, booking times, reviews, operations and file bytes are preserved. Schema 1 receives its existing availability/revision extensions, and schema 3 adds the student-owned learning_goals table and index. Schema 4 adds ordered checklist steps, owner-checked Evidence links, workspace-update read receipts and one private preparation record per booking. Before the transaction, SQLite `VACUUM INTO` creates a consistent database snapshot, including committed WAL content, at `<dataDir>/backups/tala-v<original-schema>-<timestamp>-<UUID>.sqlite`. The snapshot is checked and saved with mode 0600 inside a 0700 directory. A failed backup or migration aborts startup. New empty databases start directly at schema 4. Newer, unsupported schema versions are refused.

The automatic snapshot contains the database, not a second copy of the private upload/Evidence directories. Keep those directories and the original runtime intact. To roll back, stop the server, preserve the entire current runtime separately, restore the verified original-version snapshot as `tala.sqlite` in a **separate** private directory, and provide the matching `uploads` and `evidence` files. Point the compatible older server at that directory using `TALA_DATA_DIR`. Do not copy a live SQLite main file alone or mix its WAL with the standalone snapshot. Review any changes made after the snapshot before restoring: they are absent from the old database. Nothing restores, deletes or overwrites data automatically.

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

## Personal learning goals

Students can save up to 100 personal goals, add optional plain-text notes and a calendar due date, edit, complete and reopen them. These are planning records, not verified school outcomes or assessments. Every new PATCH uses the displayed version and advances it once; a stale view receives CONFLICT without overwriting another edit. Keep the same request identifier and body when retrying an uncertain save: the server returns the originally committed result. Parents can only read a currently linked student's goals; staff cannot edit or arbitrarily read them. No delete route removes history. Backup create/verify/restore supports schemas 2, 3 and 4, preserves goals in schemas 3 and 4, checks the manifest matches the database schema, and always signs restored sessions out. Starting a restored schema-2 copy upgrades it only after a verified local snapshot.

Goals now support up to eight ordered checklist steps and twenty links to the student's actual submitted Evidence versions. Completing checklist steps does not automatically complete the goal or certify learning. PATCH without steps preserves them for older clients; an explicit empty list clears the checklist. Changing a link advances the same optimistic goal version; unlinking never deletes a file, submission or staff review. Currently linked parents can read goals, steps and links but cannot change them.

## Workspace updates

The student feed derives its events only from persisted reservation creation/current cancellation, published learning records and the latest saved manual review per Evidence. Changing a meeting cancels its original reservation and saves a replacement. Passing the scheduled end time never generates an attendance or success event. The feed is a current activity view, not a complete historical audit log: an older review event disappears when replaced. Reading it is not email, Zoom or push notification delivery.

Pages contain at most 25 updates and a full current unread count. Only students can mark their own updates read; linked parents view that student's state without changing it. Read receipts survive logout and restart. Mark all read snapshots all current unread events in one transaction; retrying the same request does not mark events created later. Old event IDs can become unavailable; refresh the first page after changes. No background delivery, polling service or sensitive records are sent to another system.

## Meeting preparation

Before an active meeting starts, its student can save a plain-text note, choose one of their own goals and mark their preparation ready. These are self-reported preparation records, not attendance, medical information, a meeting link or verified learning. An unsaved booking returns a blank version-0 view without inserting a record. Saves use the current version and an exact retry identifier. Historical records remain readable to the student and currently authorized read-only parents. New changes after the meeting starts or is cancelled are refused; a matching receipt for an earlier successful save remains recoverable. Rescheduling keeps the original preparation on the old booking and starts the replacement blank. GET never updates booking status.

The student and linked-parent Learning records view supports an optional `q` substring search across published summary text. Search is trimmed, bounded to 80 characters and applied before pagination; `%`, `_` and backslash match literal characters. Cursors remain bound to the normalized query, authorized student and current actor. Omit `q` for the existing full record list. Search does not infer outcomes or change their status.
