# Production release and authority rotation

This runbook operates the permanent dependencies and reversible release defined
by D5.5. It never contains credential values. GitHub protected-environment
variables identify public resources; all key, token and password material is a
GitHub environment secret or an Appwrite secret Function variable.

## Preconditions

- G3 and G4 are `DONE`, including distinct real GitHub and GitLab message-sync
  evidence.
- The protected `G5 evidence` workflow passes for the exact candidate commit.
- GitHub environments `production` and `production-recovery-backup` require the
  configured human approval policy and expose only their dedicated authority.
- Azure workload identities trust the exact repository/environment OIDC
  subjects created by `scripts/provision-recovery-azure.sh` and the Production
  scanner bootstrap.
- `Y7_PRODUCTION_RELEASE_ENV` contains the complete Production Appwrite
  configuration, including Production-only provider callbacks, SMTP authority,
  scanner origin/key and a release identifier. It contains no Preview project,
  function, web or scanner authority.

## Permanent antivirus deployment

Before the first deployment, open Azure Cloud Shell and run
`scripts/provision-production-azure.sh` from a trusted checkout. Set
`AZURE_PRODUCTION_ALERT_EMAIL` only in that ephemeral shell; the script neither
prints nor stores it. Record the emitted `clientId` and `actionGroupId` as the
protected GitHub environment variables `AZURE_PRODUCTION_CLIENT_ID` and
`AZURE_PRODUCTION_ACTION_GROUP_ID`. The created workload identity trusts only
the repository's `production` environment and receives `Contributor` only on
`rg-y7-feedback-production-cus`, never at subscription scope.

Run the `Production antivirus` workflow. It deploys the immutable
`ghcr.io/y4nn777/y7-feedback-antivirus:sha-<commit>` gateway with pinned ClamAV,
at least one warm replica, truthful readiness, Log Analytics and routed 5xx/no
replica alerts. It then submits an Azure Monitor static-metric test notification
through the configured Action Group without printing its receiver. Require both
`PRODUCTION_SCANNER_READY` and `PRODUCTION_ALERT_TEST_SUBMITTED`. The workflow
fails before deployment unless all of these exist:

- Azure OIDC identity;
- a new 32-byte scanner HMAC secret and non-secret key identifier;
- an Azure Monitor Action Group resource ID.

Copy only the emitted non-sensitive scanner origin into the Production release
configuration. Do not create a custom domain; use the Azure-provided HTTPS
origin.

### Scanner key rotation

1. Generate a new random 32-byte value outside the repository and encode it as
   unpadded base64url. Never print it in CI output.
2. Set a new `Y7_PRODUCTION_SCANNER_KEY_ID` environment variable value and
   replace `Y7_PRODUCTION_SCANNER_HMAC_KEY` in the protected `production`
   environment.
3. Run `Production antivirus` and require `PRODUCTION_SCANNER_READY`.
4. Update `ANTIVIRUS_SCANNER_KEY_ID` and `ANTIVIRUS_SCANNER_HMAC_KEY` inside
   `Y7_PRODUCTION_RELEASE_ENV`, then deploy the Production Function.
5. Run the signed clean/EICAR matrix through `Production release` and require
   `PRODUCTION_RELEASE_READY`.
6. Revoke the old key material. A rollback that expects the revoked key is no
   longer compatible; retain the previous key only for the bounded rollback
   window, then destroy it.

If the Function is switched before the scanner, signed scans fail closed. Roll
the Function back to its previous Ready deployment, finish scanner deployment,
and retry; never disable signature validation.

## Production backup

Run `Encrypted recovery backup` once before first Production release and retain
only its non-sensitive result. The same workflow then runs daily at `02:17 UTC`.
It uses:

- Production Appwrite read authority dedicated to recovery export;
- Azure OIDC identity `id-y7-feedback-recovery-backup`;
- container-scoped `Storage Blob Data Contributor`;
- separate encryption and signing keys;
- private Blob storage with shared-key and public access disabled;
- the 30-day lifecycle policy provisioned by
  `scripts/provision-recovery-azure.sh`.

Rotate recovery encryption/signing keys by adding new key identifiers and
materials to the protected environment before the next backup. Retain old
decrypt/verify material only for the retention period of artifacts that use it.
The isolated restore drill, deletion-ledger replay and expiry tests remain the
authority for restore safety.

## Email and provider authorities

Production SMTP uses `Y7_EMAIL_SMTP_*` and `Y7_EMAIL_FROM`. Recipient addresses
are resolved from Appwrite at delivery time; they are not copied into outbox
payloads, logs or Function variables. Rotate the SMTP password in the provider
and `Y7_PRODUCTION_RELEASE_ENV`, deploy the Function, then verify one allowed
handoff and one retry/terminal outcome without retaining captured email.

GitHub and GitLab client secrets and callback URLs are Production-specific.
Rotate one provider at a time: create the new secret, update the protected
bundle, deploy, complete a real authorization and repository action, then revoke
the old secret. The release verifier separately confirms that unauthenticated
callbacks and webhooks fail closed.

## Reversible release

Run `Production release` for the candidate commit. The workflow:

1. proves the permanent scanner is ready;
2. provisions/migrates Production and deploys a new Appwrite Function revision;
3. creates a staged Vercel Production deployment with no domain assignment;
4. smokes the staged deployment through `vercel curl`;
5. promotes it and smokes the Production origin;
6. rolls Vercel back, verifies the prior deployment, and promotes the candidate
   again;
7. switches Appwrite to the previous Ready Function deployment, health-checks
   it, and restores the candidate in a `finally` path;
8. runs the signed antivirus matrix, web security/cache headers, environment
   isolation and provider callback/webhook denial probes;
9. creates a non-sensitive temporary GitHub issue through the Production
   provider worker, proves inbound/outbound message synchronization, closes the
   issue and removes the Appwrite fixture rows. The protected release bundle
   supplies a dedicated `Y7_GITHUB_VERIFICATION_TOKEN`; it is never installed
   as a Function variable or retained in evidence.

The release is successful only after
`PRODUCTION_RELEASE_AND_ROLLBACK_PASSED`. If a smoke fails, leave the last known
good web and Function deployments active, investigate with redacted logs, and
create a new atomic fix. Do not roll schema backwards destructively: additive
schema remains compatible, and deletion-ledger semantics prevent restore from
resurrecting erased data.

## Finalization

- Record workflow URLs, commit SHA and non-sensitive result codes in
  `docs/evidence/day-5-g5.md`.
- Confirm Azure has only the permanent Production scanner/recovery resources;
  delete temporary Preview verification resource groups.
- Confirm no raw transcript, `.env*`, captured email, provider payload or test
  artifact is staged in Git.
- Merge by rebase only after all required checks pass, then delete the remote
  task branch.
