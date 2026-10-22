# TALA local API

Node.js 24, built-in modules only. Listens on `127.0.0.1:8787`; refuses production mode. Started by `npm run dev --prefix frontend`, or alone with `npm --prefix server start`.

Data: `server/.runtime/`, or `TALA_DATA_DIR`. Endpoints and types: [contract.json](contract.json).

## Operator commands

```sh
node server/operator.cjs promote --email existing@example.test
node server/operator.cjs add-availability --startsAt 2027-01-05T17:00:00Z --endsAt 2027-01-05T17:30:00Z
node server/operator.cjs link-family --studentUid STUDENT_UID --parentUid PARENT_UID --consentReference REFERENCE
node server/operator.cjs revoke-family --studentUid STUDENT_UID --parentUid PARENT_UID
node server/operator.cjs cleanup-expired
```

## Backups

```sh
node server/backup.cjs create --dataDir /path/to/runtime --outputDir /path/tala-backup-review
node server/backup.cjs verify --directory /path/tala-backup-review
node server/backup.cjs restore --directory /path/tala-backup-review --outputDir /path/tala-backup-restored
```

Output folders must be new and named `tala-backup-*`. Restore writes a separate copy and signs everyone out. Stop the API first for large backups.

Before a schema upgrade, the server snapshots the database to `<dataDir>/backups/`.

## Limits

Text or PDF uploads up to 5 MiB. Per owner: 100 MiB, 1,000 versions. Per instance: 2 GiB, 20,000 versions.

## Tests

```sh
npm --prefix server run check
npm --prefix server test
```
