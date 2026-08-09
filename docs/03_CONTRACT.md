# Core Contract - Y7 Feedback

## 1. Purpose

This contract states the guarantees that every implementation of the feedback
service must preserve. It does not select a framework, database, identity
provider, hosting platform, or commercial model.

## 2. Ownership Invariants

1. Every project belongs to exactly one workspace.
2. Every feedback item belongs to exactly one project.
3. Every attachment belongs to exactly one feedback item.
4. A feedback item's workspace is derived through its project.
5. An attachment's project and workspace are derived through its feedback item.
6. These ownership associations do not change after acceptance.

Moving data between workspaces or projects, if ever required, is a separate
administrative operation with its own authorization and audit contract. It is
not an update to accepted feedback.

## 3. Isolation Contract

- A public request identifies a project through its public route; it cannot
  independently assign workspace ownership.
- A trusted project registry resolves the route to one active project and its
  workspace.
- Every privileged read and write is checked against the resolved ownership
  scope.
- Failure to resolve or authorize a scope creates no data and discloses no data
  from another scope.
- Attachments inherit access rules from their feedback item and are not public
  objects merely because intake is public.

## 4. Reporter Contract

`Reporter` names the actor submitting feedback. It does not mean anonymous,
identified, authenticated, or untrusted by definition.

Before collecting identity or contact information, the product must define:

- which data is requested;
- whether it is optional or required;
- why it is needed;
- who may access it;
- how long it is retained;
- which follow-up or data-right capabilities it enables.

The interface and documentation must not claim anonymity when collected data or
operational metadata can reasonably identify the reporter.

## 5. Acceptance Contract

- A submission is accepted only when the feedback, its ownership, and every
  accepted attachment association are durable.
- A confirmation reference is issued only after acceptance.
- A rejected or interrupted submission is never presented as accepted.
- Retrying one logical submission does not create multiple feedback items.
- Request-owned attachment data is removed when its feedback cannot be accepted.
- A confirmation reference does not grant read, update, or tracking access by
  itself.

## 6. Project Lifecycle Contract

- Only active projects accept new feedback.
- Deactivation stops new intake but preserves existing ownership and history.
- Public routes resolve to at most one active project.
- Project configuration may constrain accepted feedback types and attachments,
  but cannot weaken workspace isolation.

## 7. Evolvability Contract

- Core feedback records contain no WiseMoney-specific behavior.
- Additional Y7 Labs projects use the same ownership and submission model.
- External customers can be represented as separate workspaces without copying
  the service or changing existing feedback ownership.
- Plans, billing, invitations, teams, and custom domains may surround the
  workspace boundary; they are not prerequisites for the core feedback model.

## 8. Explicit Non-Guarantees

Until product decisions are approved, this contract does not guarantee:

- anonymous submission;
- authenticated submission;
- reporter accounts, status tracking, or replies;
- public visibility of submitted feedback;
- a specific moderation workflow or status taxonomy;
- a specific attachment policy;
- per-customer domains, billing, plans, or team roles;
- any particular infrastructure or vendor.

## 9. Unresolved Contract Points

The following must be decided before their related behavior can become a stable
contract:

1. Reporter identity and follow-up policy.
2. Workspace actor authentication and authorization roles.
3. Attachment acceptance, scanning, retention, and cleanup policy.
4. Feedback type schemas and their configuration authority.
5. Submission atomicity when only one attachment fails validation.
6. Public slug namespace rules once more than one workspace is onboarded.
