# Day 5 — G5 release evidence index

Status: `IN_PROGRESS`  
Candidate branch: `task/TASK-E2E-001-g5-traceability`  
Authoritative progress ledger:
[`2026-08-27-day-3-day-5.md`](../sessions/plans/2026-08-27-day-3-day-5.md)

This index links the evidence required by D5.1–D5.6. It does not turn an
implemented verifier into passing real-service evidence. A row remains
`IN_PROGRESS` until the named command has passed against the stated target and
the reviewable candidate is merged.

## Task and requirement index

| Task or gate | Requirements | Evidence authority | Current result |
| --- | --- | --- | --- |
| `TASK-ADMIN-001` | D3.1, FR-OPS-001..010 | `pnpm verify:appwrite:g3:admin`; Day 3 G3 index | `DONE` |
| `TASK-CONV-001`, `TASK-LIFE-001` | D3.2, FR-CONV-*, FR-LIFE-* | `pnpm verify:appwrite:g3:conversation-lifecycle`; Day 3 G3 index | `DONE` |
| `TASK-WORK-001` | D3.3, FR-OPS-003..007 | `pnpm verify:appwrite:g3:workbench`; Day 3 G3 index | `DONE` |
| `TASK-NOT-001`, `TASK-NOT-002` | D3.4, FR-NOT-* | `pnpm verify:appwrite:g3:notifications`, `pnpm verify:mail:g3`; Day 3 G3 index | `DONE` for G3; Production SMTP is a `TASK-REL-001` dependency |
| `TASK-SRC-002`, `TASK-ISSUE-001` | D3.5–D3.6, FR-SRC-*, FR-SYNC-* | `pnpm verify:providers:g3:sources`, `pnpm verify:providers:g3:issue-link`; Day 3 G3 index | `DONE` |
| `G3` | all D3 slices | `pnpm verify:appwrite:g3:composed`; [`day-3-g3.md`](day-3-g3.md) | `DONE` |
| `TASK-D4-000` | D4.0 additive migration | `pnpm verify:appwrite:d4:migration`; Day 4 index | `DONE` |
| `TASK-SYNC-001` | D4.1 provider state | `pnpm verify:providers:g4:state-sync`, `pnpm verify:providers:g4:reconciliation` | `DONE` |
| `TASK-SYNC-002` | D4.1 provider messages | `pnpm verify:providers:g4:message-sync:github`, `pnpm verify:providers:g4:message-sync:gitlab` | `IN_PROGRESS`: distinct real GitLab result missing |
| `TASK-PWA-001`, `TASK-OFF-001`, `TASK-OFF-002` | D4.2, offline/PWA invariants | `pnpm verify:pwa:g4`; Day 4 merged evidence | `DONE` |
| `TASK-INT-001`, `TASK-INT-002` | D4.3, FR-INT-* | `pnpm verify:appwrite:g4:intelligence`; merged Preview evidence | `DONE` |
| `TASK-PRIV-001` | D4.4, FR-PRIV-* | `pnpm verify:appwrite:g4:privacy`; merged Preview evidence | `DONE` |
| `TASK-ABUSE-001` | D4.5, abuse bounds | `pnpm verify:appwrite:g4:abuse`; merged Preview evidence | `DONE` |
| `TASK-PLAT-001` | D4.6, FR-OPS-008..014 | `pnpm verify:appwrite:g4:platform-access`; commit chain through `3df866f` in `main` | `DONE` |
| `G4` | all D4 slices | Both real provider message commands plus retained D4 evidence | `IN_PROGRESS` |
| `TASK-REC-001` | D5.1, recovery/RPO/RTO/deletion replay | `pnpm verify:recovery:g5`; [`day-5-recovery.md`](day-5-recovery.md) | `DONE` |
| `TASK-SLO-001` | D5.2, SLO-005..010 | `pnpm verify:slo:g5` in the least-privilege `.github/workflows/slo-g5.yml`, retained by `.github/workflows/g5-evidence.yml` | `IN_PROGRESS` |
| `TASK-E2E-001` | D5.3, UC-01..12, ERR-001..019 | `pnpm verify:e2e:g5:matrix`, then `pnpm verify:e2e:g5` | `IN_PROGRESS` |
| `TASK-SEC-001` | D5.4 security/isolation regression | `pnpm security:scan` plus every denial and environment-isolation command in G5 | `IN_PROGRESS` |
| `TASK-UX-001` | D5.4 accessibility/320 px regression | `pnpm verify:e2e:g5:browser` on desktop and `mobile-320` | `IN_PROGRESS` |
| `TASK-REL-001` | D5.5 permanent dependencies and reversible release | `production-antivirus.yml`, `recovery-backup.yml`, `production-release.yml`, then `pnpm verify:release:production` | `IN_PROGRESS` |
| `TASK-GHDP-001` | D5.6 GitHub Developer Program prerequisites | `pnpm verify:providers:production:github`, public metadata, release proof and submission receipt | `BLOCKED` by `TASK-REL-001` and unfinalized public metadata |
| `G5` | Gate G5 criteria 1–7 | protected G5 workflow, Production dependency workflows, reversible release and this index | `IN_PROGRESS` |

Operational authority and rotation procedure:
[`production-release.md`](../runbooks/production-release.md).

## Candidate-local evidence

The current candidate contains these independently revertible outcomes:

- `1d24ac1` — staged Vercel/Appwrite Production release, smoke, rollback and
  roll-forward workflow;
- `e69db31` — authoritative Appwrite recipient resolution and scheduled SMTP
  outbox delivery;
- `83cd969` — mandatory Azure Action Group routing for permanent antivirus
  alerts;
- `d5f37e8` — scheduled encrypted Production backup with dedicated OIDC
  environment and corrected repository subject;
- `0f01896` — Production callback/webhook fail-closed smoke;
- `83a1b59` — exhaustive SMTP/recipient authority tests restoring the API
  authorization boundary to 100% branch coverage;
- `809c42f` — Production authority rotation and rollback runbook;
- `081c789` — reproducible Azure Production bootstrap with environment-bound
  OIDC, resource-group-scoped deployment authority and alert routing;
- `f34788f` — exact Vercel candidate/previous deployment identity checks across
  promotion, rollback and roll-forward;
- `73dcb10` — immutable Production scanner image built and published for the
  exact protected workflow commit before Azure deployment;
- `2af346c` — real Azure Monitor Action Group test notification submitted after
  scanner readiness without retaining or printing the receiver.
- `c4558a6` — dedicated protected Preview SLO workflow reusing the existing
  ephemeral G5 evidence authority with only `contents: read` permission.
- `50b3566`, `dd55b50` — fail-closed release cleanup restores the exact
  previous Vercel deployment and ready Appwrite Function deployment whenever
  promotion or any subsequent Production verifier fails.

Local evidence currently passing:

```text
pnpm install --frozen-lockfile --offline
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm security:scan # 267 files, 0 findings
pnpm --filter @y7-feedback/web exec playwright test --list # 38 scenarios, 2 projects
```

The API suite contains 1,466 tests; its coverage run reports 100% statements,
branches, functions and lines. The Playwright listing proves discovery and
traceability only; execution remains part of the hosted G5 browser gate.

These results prove code and policy behavior only. They do not prove deployed
G5 or Production behavior.

## Exact remaining release sequence

1. Publish the candidate branch and pass the ordinary CI gate.
2. Configure the protected `g5-preview`, `production`, and
   `production-recovery-backup` environment authorities without committing or
   printing their values.
3. Run `G5 evidence`; require both provider message matrices, SLO, security and
   both browser projects to pass.
4. Deploy and verify the permanent Production antivirus service and its routed
   alerts.
5. Run one encrypted Production backup and verify the scheduled configuration.
6. Run `Production release`; require staged smoke, promotion, Vercel rollback,
   Function rollback, roll-forward, scanner matrix and final smoke to pass.
7. Reconcile this index with the progress ledger, remove all temporary
   verification resources/secrets, merge the candidate and only then mark G5
   `DONE`.
