# Encrypted backup and isolated recovery runbook

Status: operational procedure for `TASK-REC-001`, `NFR-REC-001..003` and
`ADR-009`.

## Recovery architecture

The scheduled GitHub workflow exports one stable Appwrite recovery set covering:

- every TablesDB table definition and row;
- every object and byte from the private Attachment bucket;
- the Attachment bucket configuration;
- the Function runtime/configuration and environment-variable **names only**;
- the deletion records required to hide or purge restored Feedback before use.

The collector inventories Appwrite twice. It abandons the generation if any row,
file signature, schema, bucket setting or Function setting changes while bytes are
being read. Each entry is SHA-256 inventoried. The entire payload—including the
manifest and paths—is encrypted with a fresh AES-256-GCM data key; that data key is
wrapped with the configured recovery key. A distinct HMAC key authenticates the
sealed envelope and its expiry metadata.

Azure Blob receives the sealed generation first. The workflow reads it back and
compares its digest before conditionally creating the `complete/` marker. Restore
jobs must ignore generations without that marker. The container disallows public
access and shared-key authentication. GitHub uses Azure workload identity (OIDC),
with separate backup-writer and restore-reader managed identities.

## One-time Azure provisioning

Run from an authenticated Azure CLI whose subscription is `Azure for Students`:

```bash
AZURE_SUBSCRIPTION_ID=<subscription-id> \
  scripts/provision-recovery-azure.sh
```

The script is intentionally credential-free. It creates the permanent recovery
resource group, private StorageV2 account, private Blob container, 30-day lifecycle
policy, separate managed identities, federated GitHub credentials, and
container-scoped data roles. It is safe to rerun: existing identities and role
assignments are reused, while federated credentials are reconciled to the declared
repository subjects. Record its non-sensitive JSON output; do not paste
tokens, account keys or Appwrite API keys into issues, pull requests or evidence.

Configure these GitHub `recovery-backup` environment variables:

- `AZURE_SUBSCRIPTION_ID`, `AZURE_TENANT_ID`;
- `AZURE_RECOVERY_BACKUP_CLIENT_ID`;
- `AZURE_RECOVERY_ACCOUNT_URL`, `AZURE_RECOVERY_CONTAINER`;
- `Y7_RECOVERY_SOURCE_ENVIRONMENT`;
- `Y7_RECOVERY_APPWRITE_ENDPOINT`, `Y7_RECOVERY_APPWRITE_PROJECT_ID`;
- `Y7_RECOVERY_APPWRITE_DATABASE_ID`, `Y7_RECOVERY_APPWRITE_BUCKET_ID`;
- `Y7_RECOVERY_APPWRITE_FUNCTION_ID`, `Y7_RECOVERY_DELETION_TABLE_ID`;
- `Y7_RECOVERY_ENCRYPTION_KEY_ID`, `Y7_RECOVERY_SIGNING_KEY_ID`.

Configure the corresponding secrets through GitHub encrypted environment secrets:

- `Y7_RECOVERY_APPWRITE_API_KEY` with read-only database, row, bucket, file and
  Function-definition capabilities;
- `Y7_RECOVERY_ENCRYPTION_KEY` and `Y7_RECOVERY_SIGNING_KEY`, each independent
  32-byte base64url material.

Never prefix a recovery secret with `VITE_`. Never print, export to artifacts, or
place secret material in Git.

## Daily operation

`.github/workflows/recovery-backup.yml` runs every day at 02:17 UTC and may also be
dispatched manually. A successful run emits only set ID, environment, timestamps,
counts and byte totals. Investigate immediately when:

- no successful generation exists within 24 hours;
- the collector reports a changed source twice consecutively;
- Azure read-back or conditional marker publication fails;
- a generation is retained beyond its manifest expiry or the lifecycle grace
  period.

Retrying the same immutable recovery-set ID is idempotent. A different artifact
with the same ID is a conflict and must not replace the completed generation.

## Isolated restore drill

Run the non-sensitive Preview exercise with:

```bash
pnpm verify:recovery:g5
```

The verifier creates disabled, permission-empty source and recovery databases and
buckets in Preview. It uploads a private fixture, publishes and downloads the
encrypted generation through Azure, restores it into the disabled target, applies
soft-deletion and purge records, verifies rows and private bytes, and only then
briefly enables the target. It records RPO and RTO and destroys both Appwrite
fixture environments and the Azure test generation in `finally` cleanup.

The passing oracle is `RECOVERY_G5_PASSED` with:

- `rpoSeconds <= 86400` and `rtoSeconds <= 14400`;
- application data and private files restored exactly;
- deletion replay completed before exposure;
- deleted content unavailable;
- the generation retained one millisecond before expiry and absent at the exact
  boundary;
- the isolated target destroyed.

## Disaster recovery

1. Declare an incident and select the newest completed generation not older than
   24 hours. Never select a staged generation without `complete/`.
2. Activate the protected `recovery-restore` GitHub environment. The restore
   identity is read-only on the backup container and must not be reused by the
   daily writer.
3. Create a new Appwrite project/database/bucket with no public platforms,
   domains, sessions or user permissions. Never restore over Production.
4. Verify envelope signature, unwrap and decrypt the data key, verify every
   manifest digest/count, then restore schema, rows and private files.
5. Replay every deletion record. Soft-deleted records remain hidden; purged rows,
   attachments, provider projections, offline projections and identity links are
   removed.
6. Run application, attachment, authorization, privacy and provider reconciliation
   smoke tests while the target is isolated.
7. Record measured RPO/RTO. If either objective fails, keep the incident open and
   do not expose the target.
8. Only an explicit release decision may attach production ingress. Keep the old
   environment available for forensic comparison until the incident owner closes
   recovery.

## Key rotation and failure handling

New backups use the new key IDs immediately. Keep old decryption/signature keys
only until the last generation using them expires. A signature, tag, inventory,
count or read-back failure is non-recoverable for that generation: quarantine it,
retain logs containing only allow-listed metadata, and select another completed
generation. Never bypass verification and never expose a partially restored target.
