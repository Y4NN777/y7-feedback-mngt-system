# Software Requirements Specification - Y7 Feedback

## 1. Scope

This specification defines the externally observable behavior and constraints of
the Y7 Feedback MVP. Requirement keywords MUST, MUST NOT, SHOULD, and MAY are
normative.

## 2. Actors

- **Visitor** - accesses the service without an authenticated session.
- **Submitter** - a visitor preparing or sending feedback.
- **Platform operator** - registers applications and reviews submissions using
  authorized operational tooling.
- **Application maintainer** - receives or reviews feedback for an assigned app.
- **Anti-abuse service** - provides evidence used to reject automated traffic.
- **Data service** - persists application records, submissions, and private files.

## 3. Functional Requirements

### Product discovery and context

- **FR-APP-001** The system MUST expose a root page listing active applications
  that accept feedback.
- **FR-APP-002** The system MUST resolve `/:appSlug` to exactly one active
  application using a case-normalized stable slug.
- **FR-APP-003** The system MUST return a not-found state for unknown, inactive,
  or malformed slugs.
- **FR-APP-004** The system MUST display the resolved application name and logo
  throughout its submission flow.
- **FR-APP-005** The system MUST NOT accept an application identifier supplied
  independently from the resolved slug.

### Submission types

- **FR-SUB-001** The system MUST support `review`, `suggestion`, and `bug` types.
- **FR-SUB-002** Every submission MUST belong to exactly one active application
  and exactly one supported type.
- **FR-SUB-003** A review MUST accept an integer rating from 1 through 5 and MAY
  include a title and comment.
- **FR-SUB-004** A suggestion MUST include a title, current problem, and desired
  outcome.
- **FR-SUB-005** A bug report MUST include a title, description, reproduction
  steps, expected result, and observed result.
- **FR-SUB-006** A bug report MUST accept one impact level from the configured
  impact vocabulary.
- **FR-SUB-007** A submitter MAY provide a name and contact email.
- **FR-SUB-008** The system MUST explain that contact information is optional and
  used only for follow-up about the submission.
- **FR-SUB-009** The system MUST generate a unique opaque submission identifier
  and a human-readable acknowledgement reference after persistence succeeds.
- **FR-SUB-010** The system MUST NOT claim that the acknowledgement reference
  provides public status tracking in the MVP.

### Context and privacy

- **FR-CTX-001** The system MAY collect page URL, application version, locale,
  browser family, and operating-system family after informing the submitter.
- **FR-CTX-002** The system MUST allow the submitter to review collected context
  before submission.
- **FR-CTX-003** The system MUST NOT collect passwords, financial records,
  authentication tokens, full browsing history, or device fingerprints.
- **FR-CTX-004** The system MUST present a warning not to include secrets or
  financial data in free-text fields or attachments.

### Attachments

- **FR-ATT-001** A submission MAY contain zero or more attachments up to the
  configured per-submission count.
- **FR-ATT-002** The system MUST validate each attachment's declared type,
  detected type, extension, and size before final acceptance.
- **FR-ATT-003** The system MUST reject executable, scriptable, archive, and
  unsupported attachment formats.
- **FR-ATT-004** The system MUST store accepted attachments in the storage
  partition assigned to the resolved application.
- **FR-ATT-005** Public users MUST NOT receive read, list, update, or delete
  permission for stored attachments.
- **FR-ATT-006** If submission persistence fails, the system MUST remove any files
  uploaded solely for that failed submission.

### Validation and acknowledgement

- **FR-VAL-001** The system MUST validate input at both the client boundary and
  the server boundary.
- **FR-VAL-002** Server validation MUST be authoritative.
- **FR-VAL-003** Validation errors MUST identify actionable fields without
  exposing internal service details.
- **FR-VAL-004** A submission MUST be persisted at most once for one accepted
  idempotency key.
- **FR-VAL-005** The system MUST show success only after the submission record and
  all accepted attachment links are durable.

### Localization and accessibility

- **FR-UX-001** The public interface MUST support French and English.
- **FR-UX-002** A language change MUST preserve entered form data.
- **FR-UX-003** All fields MUST have programmatically associated labels and
  errors.
- **FR-UX-004** Every workflow MUST be completable with keyboard input alone.
- **FR-UX-005** Status and validation changes MUST be announced to assistive
  technology.
- **FR-UX-006** The layout MUST remain usable at widths from 320 CSS pixels.

### Operations

- **FR-OPS-001** An operator MUST be able to register, activate, and deactivate
  an application without deploying a separate frontend.
- **FR-OPS-002** Each application MUST define a slug, display name, allowed web
  origins, attachment partition, supported feedback types, and branding data.
- **FR-OPS-003** Operators MUST be able to query submissions by application,
  type, status, and creation time.
- **FR-OPS-004** Public actors MUST NOT list submissions.

## 4. Business Rules

- **BR-001** Application slugs are globally unique and immutable after public use.
- **BR-002** A submission's application association is immutable.
- **BR-003** A submission starts in `new` status.
- **BR-004** The initial impact vocabulary is `low`, `moderate`, `high`, and
  `blocking`; it describes user impact, not engineering priority.
- **BR-005** Deactivating an application prevents new submissions but does not
  delete prior records.
- **BR-006** Contact data and attachments are private regardless of submission
  type.
- **BR-007** Reviews require moderation before any future public display.

## 5. Non-Functional Requirements

### Security

- **NFR-SEC-001** Privileged data-service credentials MUST remain server-side.
- **NFR-SEC-002** Every public submission MUST pass anti-abuse verification.
- **NFR-SEC-003** The server MUST enforce per-origin and per-source submission
  rate limits.
- **NFR-SEC-004** The server MUST enforce an allowlist of origins per application.
- **NFR-SEC-005** Logs MUST NOT contain attachment content, contact email, free
  text, tokens, or privileged credentials.
- **NFR-SEC-006** Error responses MUST NOT expose data-service identifiers,
  stack traces, or credentials.

### Reliability

- **NFR-REL-001** A failed request MUST NOT leave a visible submission without all
  of its accepted attachment associations.
- **NFR-REL-002** Retrying a timed-out request with the same idempotency key MUST
  not create duplicate submissions.
- **NFR-REL-003** The service MUST provide a clear retry state when a dependency
  is unavailable.

### Performance and limits

- **NFR-PERF-001** The product page SHOULD reach interactive form state within
  2.5 seconds at the 75th percentile on a measured mid-tier mobile connection.
- **NFR-PERF-002** A valid text-only submission SHOULD receive acknowledgement
  within 2 seconds at the 95th percentile, excluding client network latency.
- **NFR-PERF-003** Request and attachment limits MUST be enforced before
  unbounded buffering or parsing.

### Maintainability

- **NFR-MNT-001** Adding an application MUST NOT require duplicating the public
  submission implementation.
- **NFR-MNT-002** Every normative requirement MUST map to at least one acceptance
  test before MVP release.
- **NFR-MNT-003** Product branding configuration MUST NOT permit arbitrary script
  or markup execution.

## 6. Error Cases

| ID | Condition | Required outcome |
| --- | --- | --- |
| ERR-001 | Unknown or inactive slug | Show not-found state; create nothing. |
| ERR-002 | Unsupported submission type | Reject as invalid; create nothing. |
| ERR-003 | Missing or invalid required field | Return field errors; preserve safe input. |
| ERR-004 | Anti-abuse verification fails | Reject generically; create nothing. |
| ERR-005 | Origin not allowed for application | Reject request; create nothing. |
| ERR-006 | Attachment count, type, or size invalid | Reject invalid files before persistence. |
| ERR-007 | Attachment upload fails | Do not confirm submission; clean temporary files. |
| ERR-008 | Record persistence fails | Do not confirm; remove request-owned files. |
| ERR-009 | Duplicate idempotency key | Return original accepted result or conflict. |
| ERR-010 | Dependency unavailable | Return retryable error without internal details. |

## 7. Acceptance Traceability

| Capability | Requirements | Minimum verification |
| --- | --- | --- |
| Resolve application | FR-APP-001..005, BR-001 | Route and server integration tests |
| Submit review | FR-SUB-001..003, FR-VAL-001..005 | Form and API integration tests |
| Submit suggestion | FR-SUB-001..002, FR-SUB-004 | Schema and API integration tests |
| Submit bug | FR-SUB-001..002, FR-SUB-005..006 | Form, schema, and API tests |
| Attach evidence | FR-ATT-001..006 | File validation and cleanup tests |
| Preserve privacy | FR-CTX-001..004, NFR-SEC-001..006 | Security and log tests |
| Prevent duplicates | FR-VAL-004, NFR-REL-002 | Concurrent retry test |
| Localize accessibly | FR-UX-001..006 | Automated accessibility and E2E tests |
| Operate multiple apps | FR-OPS-001..004, NFR-MNT-001 | Second-application acceptance test |

## 8. Unresolved Requirements

These values must be decided before implementation planning is approved:

- Maximum attachment count and bytes per attachment/submission.
- Exact attachment MIME allowlist.
- Retention periods for submissions, contact data, and attachments.
- Reference format and whether a private tracking capability enters MVP.
- Rate-limit thresholds and operator escalation channel.
- Whether application maintainers require scoped access during MVP or operators
  alone review submissions through managed tooling.
