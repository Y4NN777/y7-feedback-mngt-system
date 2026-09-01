# Day 4 — D4.0 schema-entry evidence

Status: `IN_REVIEW`

This evidence is subordinate to the authoritative Goal ledger in
`docs/sessions/plans/2026-08-27-day-3-day-5.md`. `TASK-D4-000` becomes `DONE`
only after its pull request is merged into `main`.

## Migration contract

The versioned additive migration `day4-control-plane-v1` introduces eight
private, row-security-enabled control-plane tables:

1. provider event inbox;
2. provider synchronization outbox;
3. offline conflict projections;
4. Intelligence provenance;
5. deletion records;
6. abuse counters;
7. exceptional-access grants;
8. exceptional-access audit.

Provider event ingestion and synchronization delivery remain separate from the
existing provider issue-delivery outbox. This preserves the established G3
contract while giving each Day 4 queue one cohesive responsibility.

## Preview migration evidence

`pnpm verify:appwrite:d4:migration` passed against Preview on 2026-09-01:

- eight permanent tables created;
- additive replay created zero resources;
- rollback covered all eight temporary proof tables;
- rollback refused a non-empty table;
- all temporary migration fixtures were removed.

The verifier returned `APPWRITE_D4_MIGRATION_PASSED` with
`nonEmptyRollbackDenied: true` and `cleanupPassed: true`.

## Regression evidence

- G1 passed on Preview: intake acceptance/replay/conflict, proof rotation and
  revocation, atomic rollback, encrypted sensitive rows, outbox retry,
  permanent failure, deduplication and cleanup.
- G2 passed on Preview with the real ClamAV gateway: clean/infected scanning,
  private file access, cross-scope denial, lifecycle restoration/purge,
  Workspace authorization, orphan sweeping and cleanup.
- G3 passed on Preview for fixture `g3c_745dac6d41b4a7`: all nine composed
  steps passed, the selected GitHub issue was closed and cleanup reported zero
  residue.

## Local quality evidence

The `TASK-D4-000` branch passes:

- `pnpm install --frozen-lockfile`;
- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test` — 1,205 tests;
- `pnpm test:coverage` — API, config and domain at 100%; changed production
  modules satisfy the repository threshold;
- `pnpm build`;
- `pnpm test:e2e` — 26 desktop/320 px scenarios;
- `pnpm security:scan` — zero findings.
