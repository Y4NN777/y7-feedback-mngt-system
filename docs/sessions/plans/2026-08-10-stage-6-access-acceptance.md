# Stage 6 Definition of Ready — Accountless Access and Durable Acceptance

## Trace

- Tasks: `TASK-ACC-001`, `TASK-INTAKE-001`; incremental `TASK-SEC-001` and
  `TASK-UX-001`.
- Requirements: `FR-FDB-007..009`, `FR-ACC-001..007`, `FR-LIFE-001..002`,
  `FR-NOT-001..003`, `FR-NOT-006`, `NFR-CON-001..004`, `NFR-SEC-001..006`,
  `INV-ACCESS-001`, `INV-ACCEPT-001`, `ADR-004`, and `ADR-006`.
- Architecture: sections 7.2, 8, 9.2, and 18.

## Actors and boundaries

- A Reporter receives a stable human reference and a separate high-entropy,
  Feedback-specific proof only after trusted acceptance commits.
- The trusted Function coordinates one Appwrite TablesDB transaction through a
  capability-focused port; the domain owns proof and projection policy without
  importing Appwrite or cryptography runtimes.
- Every logical intake uses a client operation ID scoped to its Project and
  Reporter attribution. Safe retries return the original result; changed
  payload reuse conflicts.
- Notification facts and a delivery outbox entry commit with the accepted
  source fact, while external delivery remains asynchronous.

## Prohibited behavior and data

- A reference, missing proof, invalid proof, revoked proof, or sibling proof
  never authorizes or reveals Feedback existence.
- Plain Access Proofs never enter persistence, URLs, email, logs, telemetry,
  notification payloads, or Reporter projections. Only a one-way verifier and
  a protected idempotency envelope may persist.
- Reporter views omit Internal Notes, exceptional-access audit, workspace-only
  classification, unrelated Feedback, and non-permitted Attachments.
- Rejection, interruption, transaction failure, or envelope failure returns no
  accepted status, reference, or proof and leaves no partial durable fact.

## BDD scenarios

### BDD-ACC-001 — reference locates but never authorizes

Given an accepted Feedback and its independent proof, when access is attempted
with only the reference, a wrong proof, an unknown reference, or a sibling
proof, then every attempt receives the same non-disclosing denial.

### BDD-ACC-002 — proof lifecycle is Feedback-specific

Given a valid Feedback proof, when it is verified, rotated, or revoked, then it
authorizes only that Feedback; rotation invalidates the prior proof and
revocation changes neither reference, ownership, nor original source.

### BDD-ACC-003 — Reporter projection and actions are bounded

Given authorized access, when the Reporter retrieves, clarifies, revises an
explicitly permitted field, or requests deletion, then the result retains
attributable ordered history and original source while omitting every internal
or sibling category.

### BDD-INTAKE-001 — acceptance commits one complete invariant

Given a validated draft and fresh client operation ID, when the trusted
transaction commits, then ownership, original source, Context, Reporter,
`received` history, reference, proof verifier, notification, outbox, and
idempotency result exist as one effect before an accepted result is returned.

### BDD-INTAKE-002 — retry is idempotent and payload-bound

Given response loss after a committed acceptance, when the exact operation is
retried, then the original reference and proof are returned with no duplicate;
reuse with a changed payload returns a conflict without protected data.

### BDD-INTAKE-003 — failure never resembles acceptance

Given validation, transaction, or protected-envelope failure, when intake is
attempted, then the outcome is rejected or retryable, contains no reference or
proof, and no partial Feedback, history, notification, or outbox remains.

## Test layers

- Pure domain matrices for proof issuance/verification/rotation/revocation,
  indistinguishable denial, safe projection, ordered clarification/revision,
  and deletion requests.
- Trusted Function contract tests against deterministic transactional fakes for
  complete commits, response-loss retry, changed-payload conflict, commit
  rollback, and asynchronous notification isolation.
- Later real Appwrite TablesDB integration proof using non-production records,
  uniqueness constraints, forced transaction failure, and immediate retrieval.
- Existing type, coverage, build, secret/log/cache, and browser regressions.

Local contracts cannot mark `TASK-INTAKE-001` `DONE`: the task remains blocked
until the same invariant and retry/failure matrix pass through a real
non-production Appwrite transaction. Reporter access completion likewise needs
the trusted deployed read/action boundary before `TASK-ACC-001` is `DONE`.
