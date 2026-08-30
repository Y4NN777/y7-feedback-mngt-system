# Day 3 — Gate G3 evidence index

Status: `IN_REVIEW`

This index is subordinate to the authoritative Goal ledger in
`docs/sessions/plans/2026-08-27-day-3-day-5.md`. G3 becomes `DONE` only when the
single-fixture composed result and the clean residue audit below both pass on
Preview and the evidence change is merged into `main`.

## Merged task slices

| Task                             | Pull request                                                      | Real-service evidence                                                            |
| -------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `TASK-ADMIN-001`                 | [#16](https://github.com/Y4NN777/y7-feedback-mngt-system/pull/16) | Preview administration matrix and direct-access denial                           |
| `TASK-CONV-001`, `TASK-LIFE-001` | [#17](https://github.com/Y4NN777/y7-feedback-mngt-system/pull/17) | `APPWRITE_G3_CONVERSATION_LIFECYCLE_PASSED`                                      |
| `TASK-WORK-001`                  | [#18](https://github.com/Y4NN777/y7-feedback-mngt-system/pull/18) | `APPWRITE_G3_WORKBENCH_PASSED`, desktop and 320 px browser matrix                |
| `TASK-SRC-002`                   | [#19](https://github.com/Y4NN777/y7-feedback-mngt-system/pull/19) | GitHub/GitLab OAuth, selection, refresh, isolation, disconnect and cleanup       |
| `TASK-NOT-001`, `TASK-NOT-002`   | [#20](https://github.com/Y4NN777/y7-feedback-mngt-system/pull/20) | scoped feed, Realtime, P95 visibility, durable attempts and Preview mail catcher |
| `TASK-ISSUE-001`                 | [#21](https://github.com/Y4NN777/y7-feedback-mngt-system/pull/21) | `PROVIDER_G3_ISSUE_LINK_PASSED`, provider issue creation/close and cleanup       |

These task-specific results are regression evidence. They do not replace the
composed scenario because they were produced from independent fixtures.

## Composed scenario contract

`pnpm verify:appwrite:g3:composed -- --state-file=<temporary-state-file>` must
return `APPWRITE_G3_COMPOSED_PASSED` for one `g3c_*` fixture after proving all
nine Goal steps:

1. Reporter intake and scoped Maintainer notification;
2. Maintainer clarification request;
3. Reporter answer with no Internal Note disclosure;
4. Maintainer resolution and closure;
5. valid Reporter reopening;
6. immediate denial after assignment removal;
7. retryable notification failure, unchanged facts and successful
   reconciliation;
8. one selected-repository issue, second-link denial and provider close;
9. zero-residue cleanup.

The executable evidence-cohesion policy rejects mixed fixture identifiers,
missing or duplicated steps, missing residue categories and non-zero residue.

## Required residue audit

The composed verifier must report zero rows/resources for:

- Feedback, intake idempotency, Access Grant, Reporter and lifecycle facts;
- Messages, Internal Notes, conversation/workbench idempotency;
- notifications, Realtime signals and delivery attempts;
- publication consent, external issue link and provider outbox;
- source connection and provider grant;
- Project assignment, Workspace memberships, Project and temporary users.

The selected provider issue must be closed before its encrypted grant is
removed. Temporary state and trigger-secret files remain outside Git and are
deleted after evidence collection.

## Local quality evidence

The `TASK-G3-001` branch currently passes:

- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test`;
- `pnpm test:coverage` — API statements, branches, functions and lines: 100%;
- `pnpm build`;
- `pnpm test:e2e` — 26 desktop/320 px scenarios;
- `pnpm security:scan` — zero findings.

## Pending authoritative evidence

- [x] `APPWRITE_G3_COMPOSED_PASSED` from clean Preview on 2026-08-30 for
      fixture `g3c_1c224aae85f726`;
- [x] zero residue in every category above (`cleanupPassed: true`);
- [x] selected GitHub issue confirmed closed (`providerIssueClosed: true`);
- [ ] `TASK-G3-001` PR green and merged into `main`;
- [ ] Goal ledger changed from G3 `IN_PROGRESS` to `DONE`.
