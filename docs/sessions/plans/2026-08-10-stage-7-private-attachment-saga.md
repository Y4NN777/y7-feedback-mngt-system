# Stage 7 Definition of Ready — Private Attachment Validation and Saga

## Trace

- Tasks: `TASK-ATT-002`, `TASK-ATT-003`; incremental `TASK-SEC-001` and
  `TASK-UX-001`.
- Requirements: `FR-ATT-001..013`, `NFR-CON-001..003`, `NFR-SEC-002..008`,
  `INV-ATT-001..003`, `INV-ACCEPT-001`, and `ADR-005`.
- Architecture: sections 8, 12, and 18.

## Actors and boundaries

- A Reporter sends at most five files through a trusted upload Function into a
  private, operation-owned staging area; direct public Storage upload/listing is
  never an application capability.
- Trusted validation derives type and digest from bytes, parses/decodes the
  detected format, invokes an antivirus port, and ignores client filename/MIME
  for acceptance decisions.
- One transaction associates validated metadata with exactly one Feedback and
  its Workspace/Project/audience after all files pass. Objects remain invisible
  before that commit.
- Trusted download derives Feedback and audience authorization before returning
  metadata or bytes. Feedback soft deletion immediately hides owned evidence;
  restore before purge may reveal permitted evidence; purge removes it.

## Prohibited behavior and data

- No public bucket, public file token, client-authoritative MIME/extension,
  unauthenticated listing, cross-scope/audience access, or sixth file.
- No archive, executable, unspecified type, binary TXT/CSV, invalid UTF-8,
  malformed parser input, spoofed declaration, polyglot, malware, or file above
  10 MiB.
- Rejection, validation failure, transaction failure, or staging expiry leaves
  no accepted Feedback result, metadata association, or durable orphan.
- Stored metadata excludes file content, proof, reporter contact, client path,
  and unnecessary parser/antivirus detail.

## BDD scenarios

### BDD-ATT-001 — actual bytes define one allowed type

Given valid JPEG, PNG, WebP, GIF, PDF, UTF-8 TXT, and CSV fixtures, when each is
validated with false or absent client declarations, then the server-derived
type, bounded size, SHA-256 digest, and clean antivirus outcome are accepted.

### BDD-ATT-002 — unsafe and ambiguous content fails closed

Given spoofed MIME/extension, malformed signatures/structure, archive,
executable, unspecified, polyglot, malware, invalid UTF-8, binary text,
oversized, or sixth-file input, when validation runs, then no accepted metadata
or content-derived detail is exposed.

### BDD-ATT-003 — logical intake is all-or-nothing

Given up to five operation-owned staged objects, when every validation and the
metadata transaction succeeds, then each object belongs to exactly one accepted
Feedback; any-file or commit failure returns no Feedback success and removes
all operation-owned staging.

### BDD-ATT-004 — expiry and reconciliation remove orphans

Given rejected, expired, committed, missing, or partially cleaned staging, when
cleanup/sweeping/reconciliation runs repeatedly, then stale unassociated objects
are removed idempotently and committed objects remain bound and private.

### BDD-ATT-005 — authorization and lifecycle follow Feedback

Given Reporter-visible or internal evidence, when Reporter, assigned workspace
actor, sibling, removed assignment, cross-scope actor, soft deletion, restore,
or purge access is attempted, then only current Feedback/audience authorization
returns bytes; deletion hides immediately and purge removes permanently.

## Test layers

- Trusted validator corpus for seven allowed formats and every named rejection,
  including exact 10 MiB/five-file boundaries and injected antivirus outcomes.
- Transactional fake Storage/metadata tests for any-file failure, commit failure,
  cleanup retry, expiry sweep, reconciliation, single ownership, and no orphan.
- Download policy matrices for scope, audience, assignment, deletion, restore,
  purge, and non-disclosing denial.
- Later real Appwrite private Storage/TablesDB execution, malware adapter,
  ingress, permission/listing, lifecycle, and cleanup evidence.
- Existing install, format, lint, type, coverage, build, secret/log/cache, and
  browser regressions.

Local contracts cannot mark `TASK-ATT-002` or `TASK-ATT-003` `DONE`: both remain
blocked until the real non-production Appwrite ingress, private Storage,
TablesDB transaction, antivirus adapter, authorization, cleanup, and lifecycle
matrix passes without public fallback.
