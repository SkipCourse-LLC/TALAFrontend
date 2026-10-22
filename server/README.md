# TALA local API

A Node.js 24 HTTP server using only built-in modules (HTTP, SQLite, crypto). It listens on `127.0.0.1:8787` and refuses to run in production mode.

```sh
npm --prefix server start
```

`npm run dev --prefix frontend` starts it together with the site. Data lives in `server/.runtime/` unless `TALA_DATA_DIR` points elsewhere. Never commit that folder or any backup of it.

Every endpoint and type is listed in [contract.json](contract.json) (contract v4, database schema v2). Lists are paged with `nextCursor`, and every page re-checks the caller's session, role and family access.

## Operator commands

These act on existing accounts in the local database only.

```sh
node server/operator.cjs promote --email existing@example.test
node server/operator.cjs add-availability --startsAt 2027-01-05T17:00:00Z --endsAt 2027-01-05T17:30:00Z
node server/operator.cjs link-family --studentUid STUDENT_UID --parentUid PARENT_UID --consentReference REFERENCE
node server/operator.cjs revoke-family --studentUid STUDENT_UID --parentUid PARENT_UID
node server/operator.cjs cleanup-expired
```

- **Availability:** withdrawing an unbooked future time keeps its ID and booking history. Re-publishing the same interval restores it.
- **Family links:** a link records consent but does not verify guardianship.
- **Cleanup:** `cleanup-expired` closes up to 100 expired, unsubmitted uploads per run. It never removes submitted Evidence.

## Backups

```sh
node server/backup.cjs create --dataDir /path/to/runtime --outputDir /path/tala-backup-review
node server/backup.cjs verify --directory /path/tala-backup-review
node server/backup.cjs restore --directory /path/tala-backup-review --outputDir /path/tala-backup-restored
```

- **Folders:** output folders must be new and start with `tala-backup-`. Restore always writes a separate copy and never overwrites anything.
- **Sessions:** a restore signs everyone out, and passwords, roles and family links return to their backed-up values.
- **When to run:** stop the API first if you can, because large copies can time out writes in progress.

## Schema upgrades

The server snapshots the database to `<dataDir>/backups/` before upgrading schema 1 to 2. A failed snapshot or migration stops startup. To roll back, restore that snapshot into a separate folder along with the matching `uploads` and `evidence` files, then point `TALA_DATA_DIR` at it.

## Limits

- **Uploads:** text or PDF files up to 5 MiB.
- **Storage caps:** 100 MiB and 1,000 versions per owner; 2 GiB and 20,000 versions per instance.
- **Not available:** email, password recovery, two-factor sign-in, Zoom and payments.

## Tests

```sh
npm --prefix server run check
npm --prefix server test
```

Tests use temporary folders and never touch `server/.runtime/`.
