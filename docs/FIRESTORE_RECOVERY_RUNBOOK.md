# Firestore recovery runbook

The production database must have one daily schedule retained for 14 days and one weekly schedule retained for 14 weeks. Run `scripts/configure-firestore-backups.ps1` from an authenticated Google Cloud CLI after billing is enabled.

## Quarterly recovery drill

1. List recent backups with `gcloud firestore backups list --database='(default)'`.
2. Restore one backup to a new temporary database. Never overwrite production during a drill.
3. Point a non-production build at the restored database.
4. Sign in with a dedicated recovery-test account.
5. Compare cloud and device counts for every ledger and auxiliary dataset in Settings.
6. Verify transaction/account reconciliation and the hashes in the latest restore report.
7. Record the backup identifier, restore duration, counts, mismatches and reviewer.
8. Delete the temporary database only after the report is retained.

The drill fails if any dataset is absent, a hash differs, account balances do not reconcile from transactions, or a user can read another user's records.
