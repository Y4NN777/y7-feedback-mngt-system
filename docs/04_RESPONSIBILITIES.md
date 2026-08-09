# Responsibility Model - Y7 Feedback

## 1. Purpose

This document assigns each contract guarantee to one primary conceptual
responsibility. A responsibility is ownership of a rule or state, not a service,
class, database, process, or deployment boundary. Several responsibilities may
initially live in one implementation.

## 2. Domain Accountability

| Domain concept | Accountable meaning |
| --- | --- |
| Workspace | Owns the customer isolation scope, Projects, Reporters, Themes, workspace actors, and all derived business data. |
| Project | Owns one feedback target, its canonical and historical slugs, intake state, guidance, type configuration, Context declarations, and Maintainer assignments. |
| Reporter | Represents the Workspace-scoped source or subject of one or more Feedback items without implying a Y7 Feedback account. |
| Feedback | Owns one source submission, current treatment state, Context, conversation, Attachments, history, and derived associations inside one Project. |
| Reporter-visible Message | Owns an attributable conversation contribution visible to the Reporter and authorized workspace actors. |
| Internal Note | Owns an attributable workspace-only contribution that is never part of Reporter-visible conversation. |
| Attachment | Owns private evidence and its approved metadata under one Feedback and one audience. |
| Context snapshot | Owns intentionally supplied situation data together with source, purpose, and trust state. |
| Lifecycle event | Owns the attributable evidence of one Feedback state transition. |
| Theme / Feedback relationship | Owns accountable derived classification without owning or rewriting source Feedback. |
| Notification | Owns one recipient-scoped awareness outcome derived from a domain event. |
| Deletion record | Owns evidence of request, anonymization, soft deletion, retention, and eventual purge outcome. |
| Exceptional access grant | Owns one independently approved, narrowly scoped and expiring authority plus its immutable audit evidence. |
| Backup set | Owns one recoverable daily snapshot, its creation evidence, 30-day expiry, and recovery validation state. |

## 3. Actor Responsibilities

### Reporter

- Supplies source Feedback and optional declared identity, Context, and evidence.
- Protects the confidential accountless Access Proof supplied for a Feedback.
- Uses authorized access to view, clarify, revise permitted information, and
  request deletion.
- Does not decide ownership, trusted identity state, lifecycle state, internal
  visibility, or Product Intelligence classification.

### Client Application

- Supplies only declared Context and identity assertions that it is authorized to
  make.
- Identifies the application or issuer scope of an `external_user_id`.
- Does not use public fields to grant trust, Workspace ownership, or permissions.

### Workspace Owner

- Owns project creation, configuration, activation, deactivation, and slug
  changes within the Workspace.
- Assigns and removes Project Maintainers.
- Can perform Project Maintainer feedback work throughout the Workspace.
- Authorizes deletion when policy grants that capability.
- Has no authority in another Workspace.

### Project Maintainer

- Works only with assigned Projects.
- Understands Feedback, reviews evidence and Context, communicates with the
  Reporter, requests clarification, adds Internal Notes, and manages lifecycle.
- Records resolution, closure, reopening, themes, and Feedback relationships.
- Uses deletion only when explicitly authorized.

### Platform Operator

- Operates availability, security controls, delivery health, and safe
  observability for the shared platform.
- Diagnoses through operational data without ordinary access to Workspace
  business content.
- Uses content access only through an authorized, scoped, expiring, auditable
  exceptional grant.
- Cannot approve its own access or modify audit evidence covering its activity.

### Platform Owner / Super Administrator

- Independently approves or denies justified exceptional access requests.
- Verifies the minimum Workspace, resource, action, and maximum one-hour scope.
- Reviews critical break-glass use after the incident.
- Does not convert approval authority into ordinary Workspace business access.

## 4. System Responsibilities

### Workspace Ownership Policy

- Defines Workspace as the root business ownership and isolation boundary.
- Validates that Project, Reporter, Feedback, child data, search, aggregates, and
  notifications remain inside one Workspace.
- Prevents public or ordinary update input from reassigning Workspace or Project
  ownership.
- Owns cross-workspace isolation guarantees; it does not authenticate actors.

### Project Registry

- Owns Project identity, Workspace ownership, lifecycle, current slug,
  historical slugs, enabled feedback types, guidance, and declared Context.
- Enforces global uniqueness across current and historical slugs.
- Resolves a route to one Project and trusted Workspace scope.
- Redirects historical slugs to the same Project's canonical route.
- Stops intake for inactive Projects without deleting history.
- Does not accept Feedback or authorize a Reporter.

### Reporter Attribution

- Owns Reporter records and identifier evidence inside one Workspace.
- Preserves identifier kind, application/issuer scope, value, provenance, and
  trust state.
- Decides whether attribution evidence is sufficient to link Feedback to an
  existing Reporter.
- Prevents unverified contact, untrusted public identifiers, fingerprinting, and
  cross-workspace matching from creating false continuity.
- Coordinates controlled linking, correction, merging, and anonymization while
  preserving attribution history.
- Does not provide administrative authentication or accountless Feedback access.

### Context Policy

- Defines common and project-declared Context names, types, purposes,
  sensitivity, optionality, and trust handling.
- Rejects undeclared, malformed, oversized, executable, or falsely trusted
  Context.
- Ensures the Reporter can review submitted Context before acceptance.
- Preserves each value's source and purpose for later analysis.

### Public Feedback Experience

- Displays resolved Project identity, type choices, guidance, source fields,
  declared Reporter data, Context, and Attachments.
- Supports French and English and the required accessibility behavior.
- Lets the Reporter review and correct safe input before sending.
- Presents accepted, rejected, and retryable outcomes accurately.
- Never decides ownership, trusted identity, authorization, or lifecycle state.
- At `/`, presents bilingual orientation to a project-provided feedback link,
  reference-based retrieval, and authenticated Workspace management.
- Never generates Project search, Project suggestions, a Project catalog, or
  Workspace exposure; direct Project routes bypass root orientation.

### Feedback Validation

- Applies enabled system-type semantics and Project guidance.
- Validates required source meaning, bounded Context, logical-operation input, and
  safe field constraints.
- Treats public Workspace, Project, Reporter trust, status, and storage fields as
  untrusted.
- Produces actionable field outcomes without exposing protected internals.
- Does not claim acceptance or persistence.

### Feedback Intake Coordination

- Coordinates Project resolution, attribution, validation, anti-abuse,
  Attachment results, durable Feedback creation, initial lifecycle state,
  confirmation reference, and accountless access issuance as one logical intake.
- Applies idempotency to intake retries.
- Declares acceptance only after the acceptance invariant holds.
- Ensures failed intake leaves no durable orphaned request evidence.
- Does not deliver notifications as part of the acceptance transaction.

### Feedback Record Stewardship

- Owns the original source, attributable revisions, current status reference,
  ordered history, and immutable Workspace/Project ownership of Feedback.
- Keeps source, Reporter contribution, maintainer interpretation, Internal Notes,
  Context, and derived Product Intelligence distinguishable.
- Retrieves Feedback only through already established authorization scope.
- Does not own Project records, authentication decisions, or classification
  policy.

### Reporter Feedback Access

- Owns confirmation-reference lookup and confidential Access Proof lifecycle.
- Separates stable reference from authorization evidence.
- Limits a Feedback-specific proof to one Feedback.
- Supports proof validation and revocation without changing Feedback identity.
- Produces only the Reporter-visible projection and permitted Reporter actions.
- Never exposes Internal Notes, sibling Feedback, or workspace-only data.

### Conversation Coordination

- Owns reporter-visible Messages and Internal Notes under one Feedback.
- Enforces author, time, audience, and Project/Workspace scope.
- Keeps internal and Reporter-visible entries separate.
- Coordinates information requests and Reporter clarifications with lifecycle
  behavior.
- Prevents internal content from entering Reporter views or notifications.

### Feedback Lifecycle

- Owns state meanings and allowed transitions.
- Creates `received` on acceptance.
- Requires a visible request for `awaiting_reporter` and a visible conclusion for
  `resolved`.
- Returns an awaiting item to `under_review` after Reporter clarification.
- Allows authorized closure and reasoned reopening.
- Records previous state, next state, actor, time, and trigger for every change.
- Keeps treatment state separate from Project state and deletion state.

### Attachment Policy and Coordination

- Accepts only JPEG, PNG, WebP, GIF, PDF, UTF-8 TXT, and CSV; rejects archives,
  executables, and unspecified formats.
- Enforces actual-content validation independently of client MIME and extension,
  10 MB per file, and five files per submission operation.
- Associates accepted evidence with one Feedback and optionally its source entry.
- Authorizes evidence through Feedback scope and entry audience.
- Keeps evidence outside the public webroot and prevents public listing and
  retrieval.
- Coordinates logical all-or-nothing intake and removes failed or expired staged
  evidence.
- Limits metadata to validation, integrity, presentation, authorization, audit,
  and lifecycle needs.
- Applies the owning Feedback's visibility, restoration, purge, and backup
  lifecycle.
- Does not make a rejected Attachment accepted because its Feedback exists.

### Workspace Access Control

- Establishes the trusted administrative identity and fixed actor responsibility
  of Workspace Owners and Project Maintainers.
- Authorizes Owner operations within one Workspace.
- Applies Maintainer assignments to Project-scoped operations.
- Ends future Maintainer access after assignment removal without erasing history.
- Does not define Reporter attribution or choose an identity provider.

### Exceptional Access Control

- Keeps Platform Operator content access absent by default.
- Creates, validates, revokes, expires, and audits exceptional grants.
- Requires a Platform Owner / Super Administrator distinct from the operator to
  approve a mandatory justification and minimum Workspace/resource/action scope.
- Enforces a maximum one-hour grant; continued access requires a new approval.
- Records grants, uses, denied attempts, revocations, expiries, and critical
  break-glass post-incident reviews.
- Prevents the operator from changing audit evidence covering its own activity.
- Allows break-glass only for a critical incident under the same justification
  and audit guarantees.

### Maintainer Feedback Experience

- Presents authorized source, Context, evidence, conversation, Internal Notes,
  history, classification, and lifecycle actions for assigned Projects.
- Supports Project-scoped search, filters, themes, relationships, and trends.
- Keeps Reporter-visible actions explicit from internal actions.
- Does not expand authorization merely because an identifier is known.

### Notification Coordination

- Converts approved domain events into recipient- and audience-scoped in-product
  notifications.
- Requests email only for an eligible, purpose-authorized address.
- Prevents Internal Notes, Access Proofs, and unnecessary sensitive content from
  entering Reporter email.
- Records delivery outcome independently from the accepted domain action.
- Applies current Project and recipient authorization when notifying workspace
  actors.

### Product Intelligence

- Owns authorized filters, aggregates, Themes, Feedback relationships, and trend
  comparison.
- Uses legitimate Reporter attribution and declared Context without broadening
  their scope.
- Preserves author/source and time for derived classification.
- Excludes soft-deleted Feedback from ordinary results.
- Prevents derived interpretation from rewriting source Feedback.
- Delivers MVP value without depending on automated or AI classification.

### Data Lifecycle and Privacy

- Receives deletion requests and applies approved authorization.
- Coordinates immediate Feedback-specific anonymization when required and
  immediate soft deletion.
- Removes soft-deleted data from ordinary Reporter, maintainer, search,
  notification, and Product Intelligence views.
- Authorizes Workspace Owner restoration before purge and records its audit;
  restoration never reconstructs already anonymized identity.
- Purges Feedback-owned business data and Attachments after 30 days and makes
  business restoration impossible thereafter.
- Preserves only the approved minimal deletion and purge evidence.

### Backup and Recovery

- Produces and verifies a recoverable backup at least daily.
- Expires backups after 30 days.
- Owns recovery procedures and exercises for RPO 24 hours and RTO 4 hours.
- Reapplies deletion and purge state before restored data becomes ordinarily
  accessible.
- Does not own business deletion approval or ordinary Feedback restoration.

### Anti-Abuse Policy

- Enforces the overlapping IP limits of 60 requests/minute, 10 Feedback
  submissions/minute, and 20 uploaded files/minute.
- Enforces 30 Feedback/hour for one external-identity issuer/application scope
  and Project.
- Returns HTTP 429 without protected-data disclosure or excess domain effects.
- Uses expiring operational state and avoids permanent raw-IP history,
  fingerprinting, and hidden behavioral tracking.
- Keeps CAPTCHA optional rather than a required MVP dependency.

### Safe Observability

- Records sufficient operational evidence to diagnose failure, abuse, delivery,
  and exceptional access.
- Excludes Access Proofs, privileged credentials, Attachment content, Internal
  Notes, and unapproved Reporter or Feedback content.
- Produces safe public errors without cross-scope existence disclosure.
- Measures monthly availability, Web Vitals, critical operation latency,
  notification handoff latency, recovery exercises, and the load-tested capacity
  envelope against the approved internal SLOs.
- Does not become a parallel business-content repository.

## 5. Invariant Ownership

Every invariant has exactly one primary responsibility owner.

| Invariant | Primary responsibility | Supporting responsibilities |
| --- | --- | --- |
| INV-OWN-001 | Project Registry | Workspace Ownership Policy |
| INV-OWN-002 | Reporter Attribution | Workspace Ownership Policy |
| INV-OWN-003 | Workspace Ownership Policy | Project Registry, Reporter Attribution, Feedback Record Stewardship |
| INV-OWN-004 | Workspace Ownership Policy | All child-data responsibilities |
| INV-OWN-005 | Feedback Record Stewardship | Workspace Ownership Policy |
| INV-OWN-006 | Workspace Ownership Policy | Workspace Access Control, Reporter Attribution, Product Intelligence |
| INV-ROUTE-001 | Project Registry | Workspace Ownership Policy |
| INV-REP-001 | Reporter Attribution | Context Policy |
| INV-ACCESS-001 | Reporter Feedback Access | Safe Observability |
| INV-SOURCE-001 | Feedback Record Stewardship | Conversation Coordination, Product Intelligence |
| INV-CTX-001 | Context Policy | Feedback Record Stewardship |
| INV-ACCEPT-001 | Feedback Intake Coordination | Feedback Record Stewardship, Attachment Policy and Coordination |
| INV-VIS-001 | Conversation Coordination | Reporter Feedback Access, Notification Coordination |
| INV-VIS-002 | Conversation Coordination | Workspace Access Control, Notification Coordination |
| INV-LIFE-001 | Feedback Lifecycle | Feedback Record Stewardship |
| INV-LIFE-002 | Feedback Lifecycle | Project Registry, Data Lifecycle and Privacy |
| INV-ATT-001 | Attachment Policy and Coordination | Feedback Record Stewardship |
| INV-ATT-002 | Attachment Policy and Coordination | Feedback Validation |
| INV-ATT-003 | Attachment Policy and Coordination | Workspace Access Control |
| INV-AUTH-001 | Workspace Access Control | Workspace Ownership Policy |
| INV-AUTH-002 | Workspace Access Control | Project Registry |
| INV-BREAKGLASS-001 | Exceptional Access Control | Safe Observability |
| INV-NOTIFY-001 | Notification Coordination | Conversation Coordination, Workspace Access Control |
| INV-INTEL-001 | Product Intelligence | Feedback Record Stewardship |
| INV-INTEL-002 | Product Intelligence | Context Policy, Reporter Attribution |
| INV-DELETE-001 | Data Lifecycle and Privacy | Reporter Attribution, Product Intelligence |
| INV-ABUSE-001 | Anti-Abuse Policy | Feedback Intake Coordination, Reporter Feedback Access |

## 6. Requirement-to-Responsibility Coverage

| Requirement area | Primary responsibility or responsibilities |
| --- | --- |
| FR-OWN-* | Workspace Ownership Policy, Project Registry, Reporter Attribution |
| FR-PROJ-* | Project Registry; Public Feedback Experience for presentation |
| FR-REP-* | Reporter Attribution |
| FR-FDB-* | Feedback Validation, Feedback Intake Coordination, Feedback Record Stewardship |
| FR-CTX-* | Context Policy |
| FR-ACC-* | Reporter Feedback Access |
| FR-CONV-* | Conversation Coordination |
| FR-LIFE-* | Feedback Lifecycle |
| FR-ATT-* | Attachment Policy and Coordination |
| FR-OPS-* | Workspace Access Control, Project Registry, Maintainer Feedback Experience, Exceptional Access Control |
| FR-NOT-* | Notification Coordination |
| FR-INT-* | Product Intelligence |
| FR-PRIV-* | Data Lifecycle and Privacy |
| NFR-REC-* | Backup and Recovery; Data Lifecycle and Privacy for deletion replay |
| NFR-SEC-* | Workspace Ownership Policy, Workspace Access Control, Anti-Abuse Policy, Safe Observability |
| NFR-CON-* | Feedback Intake Coordination, Feedback Record Stewardship |
| NFR-UX-* | Public Feedback Experience, Maintainer Feedback Experience, Notification Coordination |
| NFR-EVO-* | Workspace Ownership Policy and the relevant domain responsibility |
| NFR-SLO-* | Safe Observability and the responsibility owning the measured operation |

## 7. Explicit Boundaries

- Project Registry owns Project records; Feedback Record Stewardship does not.
- Reporter Attribution establishes subject continuity; Reporter Feedback Access
  establishes permission to one Feedback.
- Workspace Access Control authenticates and authorizes administrative actors;
  it does not define Reporter identity.
- Feedback Validation determines admissibility; Feedback Intake Coordination
  alone declares overall acceptance.
- Conversation Coordination owns audience; Notification Coordination cannot
  broaden it.
- Product Intelligence owns interpretations; Feedback Record Stewardship owns
  source truth.
- Data Lifecycle and Privacy decides deletion visibility and retention outcomes;
  lifecycle `closed` does not.
- Safe Observability stores operational evidence, not an unrestricted copy of
  business content.

## 8. Architectural Allocation Boundary

These responsibility definitions do not themselves decide:

- frontend framework, rendering model, or application count;
- API protocol or process boundaries;
- database, search, object storage, queue, or email products;
- workspace-actor authentication provider or Reporter proof technology;
- anti-abuse provider or algorithm;
- hosting, region, CDN, or deployment topology;
- whether responsibilities become modules, processes, or services;
- the exact page composition or interaction design of the validated root intents.

The validated React, TypeScript, Vite, TanStack Query, IndexedDB, PWA, and
Appwrite constraints and their allocation to these responsibilities are defined
only in `07_ARCHITECTURE.md` and its ADRs.
