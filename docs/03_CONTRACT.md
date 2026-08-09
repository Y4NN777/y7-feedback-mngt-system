# System Contract and Invariants - Y7 Feedback

## 1. Allowed Inputs

The system accepts only:

- an active registered application slug;
- one supported feedback type;
- type-specific structured text within configured lengths;
- optional contact data with explicit purpose notice;
- optional diagnostic context reviewed by the submitter;
- attachments matching the configured count, size, and type policy;
- valid anti-abuse evidence and an idempotency key.

Anything else is rejected before durable mutation.

## 2. Guaranteed Outputs

For a valid accepted request, the system guarantees:

- one durable submission associated with exactly one application;
- durable association of every accepted attachment;
- private attachment access;
- one acknowledgement reference;
- a localized success response containing no privileged identifiers.

For a rejected request, the system guarantees:

- no confirmed submission;
- no request-owned orphan attachment after cleanup completes;
- an error classification safe for public display;
- no disclosure of internal credentials or stack details.

## 3. Invariants

### Identity and tenancy

- **INV-TEN-001** Every submission belongs to exactly one registered application.
- **INV-TEN-002** A submission's application association never changes.
- **INV-TEN-003** A public request cannot select a storage partition separately
  from its resolved application.
- **INV-TEN-004** Application slugs are globally unique and immutable after use.

### Privacy

- **INV-PRV-001** Public actors cannot list or read submissions.
- **INV-PRV-002** Public actors cannot list or read attachments.
- **INV-PRV-003** Contact data, free text, and attachment content never enter
  application logs.
- **INV-PRV-004** Privileged data-service credentials never reach a browser.
- **INV-PRV-005** No submission flow reads data from the application being
  reviewed, including WiseMoney financial data.

### Consistency

- **INV-CON-001** A success acknowledgement implies a durable submission and all
  accepted attachment associations.
- **INV-CON-002** One idempotency key creates at most one submission.
- **INV-CON-003** A submission has exactly one supported type and one valid status.
- **INV-CON-004** A deactivated application keeps historical records but accepts
  no new submissions.

### File safety

- **INV-FILE-001** Every stored attachment passed server-side count, size, and
  content-type validation.
- **INV-FILE-002** Every attachment is stored in the partition configured for its
  submission's application.
- **INV-FILE-003** Files owned only by a failed request are eventually deleted.

### User trust

- **INV-UX-001** The visible product context matches the application that receives
  the submission.
- **INV-UX-002** Optional diagnostic and contact data are identified before send.
- **INV-UX-003** An acknowledgement never implies public tracking unless such a
  capability is explicitly delivered.

## 4. Explicit Refusals

The system refuses to:

- accept feedback for an unknown, inactive, or origin-mismatched application;
- accept a request that bypasses anti-abuse verification;
- accept arbitrary HTML, scripts, executables, or archives as attachments;
- trust client-supplied application, bucket, status, or operator fields;
- publish a review without moderation;
- expose one application's attachments or submissions to another application;
- request passwords, financial records, API keys, authentication tokens, or
  payment information;
- report success before consistency guarantees hold.

## 5. Dependency Contract

### Managed data service

The platform depends on a managed service that can persist structured records,
store private objects, enforce privileged server access, and return stable
resource identifiers. The application must treat this service as fallible and
must not expose its raw errors.

### Anti-abuse service

The platform depends on a server-verifiable proof. Failure, expiry, hostname
mismatch, or service rejection must fail closed for public submissions.

### Hosting platform

The platform depends on HTTPS static delivery and server-side request execution.
Secrets must be injected only into server execution contexts.

## 6. Coherence Checklist

- [x] Application identity comes from the route and server registry.
- [x] Attachment partition comes from the application registry.
- [x] Public actors have create-only behavior through a controlled boundary.
- [x] Submission success is defined after persistence, not button activation.
- [x] Duplicate requests have an idempotency rule.
- [x] Failed multipart flows have a cleanup responsibility.
- [x] Reviews are private until moderation exists.
- [ ] Retention rules are numerically defined.
- [ ] Attachment policy is numerically defined.
- [ ] Operator access scope for MVP is approved.
