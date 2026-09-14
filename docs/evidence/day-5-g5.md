# Day 5 — G5 release evidence index

Status: `DONE`
Candidate: `main` at `029175e471b263955e689c4e42d31e1cc7aaec6e`
Authoritative progress ledger:
[`2026-08-27-day-3-day-5.md`](../sessions/plans/2026-08-27-day-3-day-5.md)

This index links the evidence required by D5.1–D5.6. It does not turn an
implemented verifier into passing real-service evidence. A row remains
`IN_PROGRESS` until the named command has passed against the stated target and
the reviewable candidate is merged.

## Task and requirement index

| Task or gate                                   | Requirements                                       | Evidence authority                                                                                                                                                                                                                                                                                                                                   | Current result                                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TASK-ADMIN-001`                               | D3.1, FR-OPS-001..010                              | `pnpm verify:appwrite:g3:admin`; Day 3 G3 index                                                                                                                                                                                                                                                                                                      | `DONE`                                                                                                                                                                                        |
| `TASK-CONV-001`, `TASK-LIFE-001`               | D3.2, FR-CONV-_, FR-LIFE-_                         | `pnpm verify:appwrite:g3:conversation-lifecycle`; Day 3 G3 index                                                                                                                                                                                                                                                                                     | `DONE`                                                                                                                                                                                        |
| `TASK-WORK-001`                                | D3.3, FR-OPS-003..007                              | `pnpm verify:appwrite:g3:workbench`; Day 3 G3 index                                                                                                                                                                                                                                                                                                  | `DONE`                                                                                                                                                                                        |
| `TASK-NOT-001`, `TASK-NOT-002`                 | D3.4, FR-NOT-*                                     | `pnpm verify:appwrite:g3:notifications`, `pnpm verify:mail:g3`; Day 3 G3 index                                                                                                                                                                                                                                                                       | `DONE` for G3; `pnpm verify:mail:production` remains a `TASK-REL-001` execution dependency                                                                                                    |
| `TASK-SRC-002`, `TASK-ISSUE-001`               | D3.5–D3.6, FR-SRC-_, FR-SYNC-_                     | `pnpm verify:providers:g3:sources`, `pnpm verify:providers:g3:issue-link`; Day 3 G3 index                                                                                                                                                                                                                                                            | `DONE`                                                                                                                                                                                        |
| `G3`                                           | all D3 slices                                      | `pnpm verify:appwrite:g3:composed`; [`day-3-g3.md`](day-3-g3.md)                                                                                                                                                                                                                                                                                     | `DONE`                                                                                                                                                                                        |
| `TASK-D4-000`                                  | D4.0 additive migration                            | `pnpm verify:appwrite:d4:migration`; Day 4 index                                                                                                                                                                                                                                                                                                     | `DONE`                                                                                                                                                                                        |
| `TASK-SYNC-001`                                | D4.1 provider state                                | `pnpm verify:providers:g4:state-sync`, `pnpm verify:providers:g4:reconciliation`                                                                                                                                                                                                                                                                     | `DONE`                                                                                                                                                                                        |
| `TASK-SYNC-002`                                | D4.1 provider messages                             | `pnpm verify:providers:g4:message-sync:github`, `pnpm verify:providers:g4:message-sync:gitlab`; protected runs [34721260550](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34721260550) and [34729440154](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34729440154)                                             | `DONE`: both real provider matrices and cleanup passed on merged `main`                                                                                                                       |
| `TASK-PWA-001`, `TASK-OFF-001`, `TASK-OFF-002` | D4.2, offline/PWA invariants                       | `pnpm verify:pwa:g4`; Day 4 merged evidence                                                                                                                                                                                                                                                                                                          | `DONE`                                                                                                                                                                                        |
| `TASK-INT-001`, `TASK-INT-002`                 | D4.3, FR-INT-*                                     | `pnpm verify:appwrite:g4:intelligence`; merged Preview evidence                                                                                                                                                                                                                                                                                      | `DONE`                                                                                                                                                                                        |
| `TASK-PRIV-001`                                | D4.4, FR-PRIV-*                                    | `pnpm verify:appwrite:g4:privacy`; merged Preview evidence                                                                                                                                                                                                                                                                                           | `DONE`                                                                                                                                                                                        |
| `TASK-ABUSE-001`                               | D4.5, abuse bounds                                 | `pnpm verify:appwrite:g4:abuse`; merged Preview evidence                                                                                                                                                                                                                                                                                             | `DONE`                                                                                                                                                                                        |
| `TASK-PLAT-001`                                | D4.6, FR-OPS-008..014                              | `pnpm verify:appwrite:g4:platform-access`; commit chain through `3df866f` in `main`                                                                                                                                                                                                                                                                  | `DONE`                                                                                                                                                                                        |
| `G4`                                           | all D4 slices                                      | Both real provider message commands plus retained D4 evidence                                                                                                                                                                                                                                                                                        | `DONE`                                                                                                                                                                                        |
| `TASK-REC-001`                                 | D5.1, recovery/RPO/RTO/deletion replay             | `pnpm verify:recovery:g5`; [`day-5-recovery.md`](day-5-recovery.md)                                                                                                                                                                                                                                                                                  | `DONE`                                                                                                                                                                                        |
| `TASK-SLO-001`                                 | D5.2, SLO-005..010                                 | `pnpm verify:slo:g5`; PR [#132](https://github.com/Y4NN777/y7-feedback-mngt-system/pull/132); protected runs [34780509193](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34780509193) and [34793991069](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34793991069)                                                                                                                     | `DONE`: the frozen 116-observation/concurrency-4 envelope passed every SLO on the exact final `main` candidate; monthly history remains truthfully `insufficient_data`                         |
| `TASK-E2E-001`                                 | D5.3, UC-01..12, ERR-001..019                      | `pnpm verify:e2e:g5:matrix`, `pnpm verify:e2e:g5:browser`; protected run [34729440154](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34729440154)                                                                                                                                                                                  | `DONE`: hosted traceability matrix and all 38 browser scenarios passed                                                                                                                        |
| `TASK-SEC-001`                                 | D5.4 security/isolation regression                 | `pnpm security:scan` plus every denial and environment-isolation command in protected run [34729440154](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34729440154)                                                                                                                                                                 | `DONE`: 286 files scanned with zero findings; deployed denial/isolation/privacy matrices passed                                                                                               |
| `TASK-UX-001`                                  | D5.4 accessibility/320 px regression               | `pnpm verify:e2e:g5:browser` on desktop and `mobile-320`; protected run [34729440154](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34729440154)                                                                                                                                                                                   | `DONE`: 38/38 hosted scenarios passed across both projects                                                                                                                                    |
| `TASK-REL-001`                                 | D5.5 permanent dependencies and reversible release | [Production antivirus run 34746437124](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34746437124), [Production backup run 34731029856](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34731029856), [Production release run 34769873808](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34769873808) | `DONE`: permanent dependencies, 27 readiness checks, real GitHub and SMTP authorities, staged smoke, promotion, rollback, non-resurrection, roll-forward and final smoke passed                 |
| `TASK-GHDP-001`                                | D5.6 GitHub Developer Program prerequisites        | real Production GitHub API evidence, publisher-owned App metadata, reachable product URL, configured support contact and receipt `https://github.com/developer/thanks?account=Y4NN777`                                                                                                                                                                  | `DONE`: the publisher accepted the Registered Developer Agreement and GitHub displayed `Thanks for joining! You're in!` on 2026-09-14; no acceptance or endorsement beyond registration is claimed |
| `G5`                                           | Gate G5 criteria 1–7                               | protected [G5 run 34793991069](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34793991069), Production dependency workflows, reversible release, Developer Program receipt, Azure cleanup and this index                                                                                                                                      | `DONE`: all seven criteria pass; the empty France Central and Norway East verification groups were deleted while permanent Preview, Production and recovery authorities were retained             |

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
- `e55b93c` — exact Preview candidate deployment before the protected SLO load.
- `50b3566`, `dd55b50` — fail-closed release cleanup restores the exact
  previous Vercel deployment and ready Appwrite Function deployment whenever
  promotion or any subsequent Production verifier fails.
- `63e2369` — curated session evidence rejects literal personal email while raw
  Codex snapshots remain outside the scan and Git history.
- `7f1faa7` — Production creates and deletes a non-sensitive Appwrite marker,
  then proves it remains absent across Function rollback and roll-forward.
- `98bdfeb` — scheduled Production backup rejects mismatched environment labels,
  missing Preview comparison authority and shared Preview/Production projects.
- `99826f6` — protected Production release proves one real non-sensitive SMTP
  handoff plus retryable and terminal transport classification without exposing
  or installing the verification recipient in the Function.
- `84eb5d6` — Production release rejects GitHub or GitLab callbacks that do not
  equal their exact route on the configured Production Function origin.
- `499cc12` — the scanner health contract exposes its immutable source commit,
  and both deployment and release gates reject a healthy scanner from any
  other candidate.
- `110da77` — the release workflow injects `GITHUB_SHA` into the Appwrite
  Function and Vercel PWA builds, whose public health/metadata must both prove
  that exact candidate before release readiness can pass.
- `67f9cf5` — the PWA identity proof reads the explicitly revalidated
  `/index.html` response so a cached route projection cannot satisfy or
  destabilize candidate verification.

Local evidence currently passing:

```text
pnpm install --frozen-lockfile --offline
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm security:scan # 292 files, 0 findings
pnpm test:e2e # 38 scenarios passed across desktop and mobile-320
```

The API suite contains 1,558 tests; its coverage run reports 100% statements,
branches, functions and lines. The local Playwright execution passes all 38
traceable scenarios across both projects; hosted execution remains part of the
final G5 browser gate.

These results prove code and policy behavior only. They do not prove deployed
G5 or Production behavior.

## Protected G5 result — 2026-09-13

Run [34729440154](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34729440154)
proved the merged `main` candidate through recovery, source scan, deployed G3/G4
matrices, both browser projects, mail capture, both real provider message
matrices, reconciliation and provider-state synchronization. Recovery achieved
RPO 3 seconds and RTO 2 seconds; the source scan inspected 286 files with zero
findings; Playwright passed 38/38 scenarios.

The run stopped only at the truthful SLO gate. SLO-007..010 passed. SLO-005
measured 1,740 ms against 500 ms, and SLO-006 measured 1,386 ms against 1,000
ms. This result is retained rather than hidden by a blind rerun or weaker
threshold. At that point, `TASK-SLO-001`, `TASK-REL-001` and Gate G5 therefore
remained `IN_PROGRESS`; the final result below supersedes that intermediate
state without erasing it from the audit trail.

PR [#96](https://github.com/Y4NN777/y7-feedback-mngt-system/pull/96)
subsequently merged the ADR-015 authoritative intake and conversation commit
path into `main` at `6a2fc76`. The real Preview conversation lifecycle passed
with complete fixture cleanup; the local capacity matrix passed SLO-005..010
with critical API P95 435 ms and Feedback commit 315 ms. Protected run
[34742466360](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34742466360)
verified the exact active release without redeploying it and passed
SLO-006..010, but measured critical API P95 1,074 ms against 500 ms. No
unchanged blind rerun is accepted as stronger evidence.

## Protected final G5 result — 2026-09-14

[Run 34793991069](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34793991069)
passed in 18 minutes 37 seconds against exact merged `main` SHA
`029175e471b263955e689c4e42d31e1cc7aaec6e`. Its fail-fast scanner preflight
proved a real signed clean scan before the destructive matrix began. The run
then passed:

- private encrypted recovery with RPO 4 seconds and RTO 2 seconds, deletion
  replay before exposure, exact expiry and isolated-environment destruction;
- deployed G1–G4 domain, intake, atomicity, outbox, attachment, administration,
  conversation, notification, abuse, intelligence, privacy and exceptional
  access behavior, including every recorded denial and cleanup oracle;
- all 38 hosted browser scenarios across desktop and 320 px projects;
- mail capture plus real GitHub and GitLab message/state synchronization and
  reconciliation;
- the frozen 116-observation/concurrency-4 SLO envelope: critical API P95
  400/500 ms, Feedback commit 330/1,000 ms, dashboard 237/1,000 ms,
  attachment processing 102/2,000 ms, notification visibility 3,569/5,000 ms
  and email handoff 2,169/30,000 ms;
- synthetic uptime, the Web RUM origin, redacted alert routing and a
  ten-series measurement index. Monthly history remains `insufficient_data`,
  as required, rather than claiming an elapsed month.

The earlier failed measurements remain part of the audit trail. This final run
is stronger evidence because PRs
[#132](https://github.com/Y4NN777/y7-feedback-mngt-system/pull/132) and
[#133](https://github.com/Y4NN777/y7-feedback-mngt-system/pull/133) changed the
authoritative measurement origin and added a signed real-scanner preflight;
it is not an unchanged retry.

## Production recovery backup — 2026-09-13

[Run 34731029856](https://github.com/Y4NN777/y7-feedback-mngt-system/actions/runs/34731029856)
authenticated through the environment-bound Azure workload identity, read the
isolated Production Appwrite authority, encrypted and signed the complete
Production recovery set, and published it to the private Azure recovery
container. The non-sensitive result reported one 38,324-byte archive entry,
source mutation coverage through `2026-09-13T01:38:50.542Z`, and exact expiry
on `2026-10-13T01:38:52.767Z`. The same protected workflow remains scheduled
daily at `02:17 UTC`.

On 2026-09-13, the Production Appwrite provisioner completed independently of
the release workflow with `34` resources created, `18` verified and
`fixtures: null`. The Production Vercel workflow token was installed directly
from the already authenticated local CLI without printing or persisting its
value. These authorities are ready and are not reasons to rerun Preview gates;
the remaining release dependency is the permanent Azure scanner and its alert
route.

## Closure

Azure confirmed deletion of the empty failed-provisioning resource groups
`rg-y7-feedback-preview-frc` and `rg-y7-feedback-preview-neu` on 2026-09-14.
The permanent Central US Preview scanner, Production and recovery groups were
retained. The progress ledger and this index therefore agree that every Day
3–5 task and all seven G5 criteria are `DONE`.
