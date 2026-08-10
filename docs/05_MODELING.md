# Behavioral and Domain Models - Y7 Feedback

## 1. Modeling Scope

These models derive behavior and information relationships from the approved
Intent, Requirements, Contract, and Responsibilities. They are conceptual: an
entity is not automatically a database table, a responsibility is not a service,
and a sequence participant is not a deployment unit.

No container, component, persistence, API, or deployment model appears here.

## 2. System Context

```mermaid
flowchart LR
    Reporter[Reporter]
    ClientApp[Client Application]
    Owner[Workspace Owner]
    Maintainer[Project Maintainer]
    Operator[Platform Operator]
    PlatformOwner[Platform Owner / Super Administrator]
    Email[Email Delivery Environment]
    System[Y7 Feedback]

    Reporter -->|submit, retrieve, clarify, request deletion| System
    System -->|confirmation, status, conversation, in-product notification| Reporter
    ClientApp -->|declared context and scoped identity assertion| System
    Owner -->|manage projects, assignments, and feedback| System
    Maintainer -->|understand, respond, classify, resolve, reopen| System
    Operator -->|operate; request exceptional access| System
    PlatformOwner -->|approve exceptional access; review break-glass| System
    System -->|purpose-limited email request| Email
    Email -->|delivery outcome| System
```

The email participant is an environmental capability, not a selected provider.
The Client Application may assert identity only through an approved trusted
interaction; public fields do not establish trust.

## 3. Core Use Cases

| ID | Primary actor | Outcome |
| --- | --- | --- |
| UC-01 | Reporter | Resolve a current or historical Project route and verify the target. |
| UC-02 | Reporter | Submit a structured Bug, Suggestion, or Review with declared Context. |
| UC-03 | Reporter | Add permitted supporting evidence. |
| UC-04 | Reporter | Receive a reference and independent accountless access proof. |
| UC-05 | Reporter | Retrieve status and visible history, clarify, and revise permitted information. |
| UC-06 | Reporter | Request deletion of the accessed Feedback. |
| UC-07 | Workspace Owner | Manage Projects, slugs, and Project Maintainer assignments. |
| UC-08 | Project Maintainer | Work Feedback through clarification, analysis, resolution, closure, and reopening. |
| UC-09 | Reporter / workspace actor | Receive scoped in-product and eligible email notifications. |
| UC-10 | Workspace actor | Filter, relate, theme, and compare Feedback for Product Intelligence. |
| UC-11 | Platform Operator | Operate without standing business-content access and use an audited exceptional grant when authorized. |

The root `/` orients a context-free visitor toward a project-provided direct
link, accountless retrieval, or Workspace management. It contains no Project or
Workspace discovery model.

Public publication, community voting, arbitrary chat, commercial SaaS behavior,
and autonomous AI decisions are not use cases in this model.

## 4. Feedback Intake Activity

```mermaid
flowchart TD
    Start([Open current or historical project route]) --> Resolve{Resolve one project?}
    Resolve -- No --> Unavailable[Show neutral unavailable outcome]
    Resolve -- Historical --> Redirect[Redirect to current canonical slug]
    Redirect --> Active
    Resolve -- Current --> Active{Project active?}
    Active -- No --> Inactive[Show intake unavailable]
    Active -- Yes --> Show[Show project, enabled types, guidance, and disclosed data]
    Show --> Enter[Enter source, optional reporter data, context, and evidence]
    Enter --> Review[Review everything to be submitted]
    Review --> Validate{Type, context, abuse, and evidence policy valid?}
    Validate -- No --> Correct[Show actionable correction]
    Correct --> Enter
    Validate -- Yes --> Attribute[Resolve or create workspace-scoped Reporter attribution]
    Attribute --> Accept{Durable acceptance succeeds?}
    Accept -- No, retryable --> Retry[Show safe retryable outcome]
    Accept -- No, rejected --> Reject[Show rejection without confirmation]
    Accept -- Yes --> Received[Create received lifecycle event]
    Received --> Reference[Issue confirmation reference and separate access proof]
    Reference --> Notify[Record in-product and eligible email notification requests]
    Notify --> Confirm[Show accepted outcome]
```

If any submitted Attachment fails format, actual-content, size, count, or
security validation, the reporter must correct the submission before `Accept`.
No Feedback or sibling Attachment from that logical submission is accepted.

## 5. Feedback Intake Sequence

```mermaid
sequenceDiagram
    actor R as Reporter
    participant P as Public Feedback Experience
    participant G as Project Registry
    participant C as Context Policy
    participant V as Feedback Validation
    participant RA as Reporter Attribution
    participant A as Attachment Coordination
    participant I as Intake Coordination
    participant F as Feedback Record Stewardship
    participant X as Reporter Feedback Access
    participant N as Notification Coordination

    R->>P: Open /{project-slug}
    P->>G: Resolve current or historical slug
    G-->>P: Canonical active Project and trusted Workspace scope
    P-->>R: Project identity, types, guidance, disclosed fields
    R->>P: Submit source, optional attribution, context, evidence
    P->>C: Validate declared context and provenance
    C-->>P: Valid context or actionable outcomes
    P->>V: Validate system type and source meaning
    V-->>P: Valid source or actionable outcomes
    P->>RA: Resolve workspace-scoped reporter attribution
    RA-->>P: Reporter and attribution trust result
    P->>A: Validate and stage permitted evidence
    A-->>P: All evidence valid, private, <= 10 MB each, <= 5 files
    P->>I: Accept one logical submission
    I->>F: Preserve source, ownership, and received event
    F-->>I: Durable feedback result
    I->>X: Establish reference and feedback-specific access proof
    X-->>I: Accountless access result
    I-->>P: Accepted result, reference, access proof
    I->>N: Request acceptance notifications
    P-->>R: Confirmation and accountless return path
```

Participants express responsibility ownership only. They may be implemented
together. If staging, validation, or durable commit fails, Intake Coordination
returns no accepted Feedback and Attachment Coordination removes request-owned
staged evidence.

## 6. Accountless Retrieval Activity

```mermaid
flowchart TD
    Start([Return with reference]) --> Locate{Reference locates feedback?}
    Locate -- No --> Deny[Return neutral access failure]
    Locate -- Yes --> Prove{Valid access proof or approved reporter identity proof?}
    Prove -- No --> Deny
    Prove -- Yes --> Deleted{Soft-deleted?}
    Deleted -- Yes --> DeletedOutcome[Show policy-approved deletion outcome only]
    Deleted -- No --> Project[Load feedback-scoped reporter projection]
    Project --> View[Show source, state, visible history, messages, and permitted evidence]
    View --> Action{Reporter action?}
    Action -- Clarify --> Message[Add reporter-visible clarification]
    Action -- Permitted revision --> Revision[Append attributable source revision]
    Action -- Delete request --> Deletion[Record deletion request]
    Action -- None --> End([End])
    Message --> Notify[Update lifecycle when applicable and notify maintainers]
    Revision --> Notify
    Deletion --> Notify
    Notify --> View
```

The reference locates; the proof authorizes. Access to this Feedback never
enumerates other Feedback attributed to the same Reporter.

## 7. Clarification and Resolution Sequence

```mermaid
sequenceDiagram
    actor M as Project Maintainer
    actor R as Reporter
    participant W as Maintainer Experience
    participant A as Workspace Access Control
    participant C as Conversation Coordination
    participant L as Feedback Lifecycle
    participant N as Notification Coordination
    participant X as Reporter Feedback Access

    M->>W: Open feedback in assigned project
    W->>A: Authorize project assignment
    A-->>W: Authorized scope
    M->>W: Request additional information
    W->>C: Add reporter-visible request
    C->>L: Enter awaiting_reporter
    L-->>C: Attributable transition recorded
    C->>N: Request reporter notifications
    R->>X: Return with reference and valid proof
    X-->>R: Show visible request and status
    R->>X: Add clarification
    X->>C: Add Reporter message
    C->>L: Return to under_review
    L->>N: Request maintainer notifications
    M->>W: Record visible conclusion and resolve
    W->>C: Add reporter-visible conclusion
    C->>L: Enter resolved
    L->>N: Request reporter notifications
```

An Internal Note follows a separate internal-only path and never appears in this
Reporter conversation.

## 8. Feedback Lifecycle

```mermaid
stateDiagram-v2
    [*] --> received: durable acceptance
    received --> under_review: treatment begins
    received --> awaiting_reporter: visible information request
    under_review --> awaiting_reporter: visible information request
    awaiting_reporter --> under_review: reporter clarifies
    awaiting_reporter --> under_review: maintainer resumes with reason
    received --> resolved: visible substantive conclusion
    under_review --> resolved: visible substantive conclusion
    awaiting_reporter --> resolved: visible substantive conclusion
    received --> closed: reasoned closure
    under_review --> closed: reasoned closure
    awaiting_reporter --> closed: reasoned closure
    resolved --> closed: close exchange
    resolved --> under_review: reopen with reason
    closed --> under_review: reopen with reason
```

- `received` is accepted but not actively treated.
- `under_review` covers understanding, analysis, and action; the model does not
  invent issue-tracker states such as planned or deployed.
- `awaiting_reporter` requires a visible request.
- `resolved` requires a visible substantive conclusion.
- `closed` means no active work or exchange is expected; it is not deletion.
- Every arrow creates a lifecycle event with previous state, next state, actor,
  time, and trigger or reason.

Deletion is an orthogonal record state:

```mermaid
stateDiagram-v2
    active_record --> deletion_requested: authorized reporter or workspace action
    deletion_requested --> soft_deleted: immediate soft delete and required anonymization
    soft_deleted --> active_record: authorized workspace restore before purge
    soft_deleted --> purged: 30 days elapsed; definitive purge
```

Restoration is authorized and audited, and cannot reconstruct identity removed
by immediate anonymization. Attachments move with the owning Feedback. `purged`
has no business transition back to an active record. Daily backups expire after
30 days; disaster recovery reapplies deletion and purge evidence before ordinary
access resumes.

```mermaid
flowchart LR
    Commit[Committed business state] -->|at least daily| Backup[Recoverable backup]
    Backup -->|retain 30 days| Expire[Backup expiry]
    Backup -->|disaster recovery| Restore[Isolated restore]
    Restore --> Replay[Reapply soft-delete and purge evidence]
    Replay --> Verify{RPO at most 24 h and RTO at most 4 h?}
    Verify -- Yes --> Resume[Resume ordinary access]
    Verify -- No --> Incident[Keep recovery incident active]
```

Exceptional access has a separate authority lifecycle:

```mermaid
stateDiagram-v2
    [*] --> requested: operator supplies justification and minimum scope
    requested --> denied: Platform Owner rejects
    requested --> active: distinct Platform Owner approves <= 1 hour
    active --> revoked: approver revokes
    active --> expired: time limit reached
    active --> review_required: critical break-glass use ends
    review_required --> reviewed: post-incident review recorded
    denied --> [*]
    revoked --> [*]
    expired --> [*]
    reviewed --> [*]
```

Continued access starts a new `requested` instance. The requesting operator
cannot approve itself or mutate its own access audit.

## 9. Reporter Attribution Model

```mermaid
flowchart TD
    Submission[Feedback submission] --> Existing{Approved evidence matches a workspace Reporter?}
    Existing -- No --> New[Create workspace-scoped Reporter]
    Existing -- Yes --> Link[Associate Feedback with existing Reporter]
    New --> Identifier{Identifier supplied?}
    Identifier -- No --> Unidentified[Retain unidentified attribution]
    Identifier -- Contact --> Contact[Store voluntary contact with provenance and trust state]
    Identifier -- External --> External[Store Workspace plus application/issuer scoped external ID]
    Identifier -- Client assertion --> Asserted[Store asserted identity with issuer and trust state]
    Link --> History[Record attribution decision]
    Unidentified --> History
    Contact --> History
    External --> History
    Asserted --> History
    History --> Controlled{Later controlled action?}
    Controlled -- Link, correct, or merge --> Changed[Preserve prior and resulting attribution]
    Controlled -- Anonymize --> Anonymous[Remove continuing real-person attribution]
```

Equal raw identifiers outside the same Workspace and application/issuer scope do
not meet the `Existing` condition. Browser or device fingerprinting is not an
input to this model.

## 10. Conceptual Information Model

```mermaid
erDiagram
    WORKSPACE ||--o{ PROJECT : owns
    WORKSPACE ||--o{ REPORTER : scopes
    WORKSPACE ||--o{ WORKSPACE_ACTOR : authorizes
    WORKSPACE ||--o{ THEME : owns
    WORKSPACE ||--o{ EXCEPTIONAL_ACCESS_GRANT : bounds

    PROJECT ||--o{ PROJECT_SLUG : reserves
    PROJECT ||--o{ FEEDBACK : receives
    PROJECT ||--o{ PROJECT_ASSIGNMENT : defines
    WORKSPACE_ACTOR ||--o{ PROJECT_ASSIGNMENT : receives

    REPORTER ||--o{ REPORTER_IDENTIFIER : has
    REPORTER ||--o{ FEEDBACK : sources

    FEEDBACK ||--o| CONTEXT_SNAPSHOT : captures
    FEEDBACK ||--o{ SOURCE_REVISION : preserves
    FEEDBACK ||--o{ VISIBLE_MESSAGE : converses
    FEEDBACK ||--o{ INTERNAL_NOTE : records
    FEEDBACK ||--o{ ATTACHMENT : includes
    FEEDBACK ||--o{ LIFECYCLE_EVENT : histories
    FEEDBACK ||--o{ ACCESS_GRANT : authorizes
    FEEDBACK ||--o{ NOTIFICATION : triggers
    FEEDBACK ||--o{ THEME_ASSOCIATION : classified_by
    THEME ||--o{ THEME_ASSOCIATION : groups
    FEEDBACK ||--o{ FEEDBACK_RELATION : source
    FEEDBACK ||--o{ FEEDBACK_RELATION : target
    FEEDBACK ||--o{ DELETION_RECORD : governs

    PLATFORM_OPERATOR ||--o{ EXCEPTIONAL_ACCESS_GRANT : receives
    PLATFORM_OWNER ||--o{ EXCEPTIONAL_ACCESS_GRANT : approves

    WORKSPACE {
        identifier id
    }
    PROJECT {
        identifier id
        identifier workspace_id
        lifecycle_state state
    }
    PROJECT_SLUG {
        slug value
        slug_state current_or_historical
    }
    REPORTER {
        identifier id
        identifier workspace_id
        attribution_state state
    }
    REPORTER_IDENTIFIER {
        identifier_kind kind
        identifier issuer_or_application
        identifier_scope scope
        trust_state trust
    }
    FEEDBACK {
        identifier id
        identifier project_id
        identifier reporter_id
        feedback_type type
        lifecycle_state current_state
        deletion_state record_state
        timestamp accepted_at
    }
    CONTEXT_SNAPSHOT {
        context_values declared_values
        provenance source_and_purpose
    }
    SOURCE_REVISION {
        revision author_time_reason
    }
    VISIBLE_MESSAGE {
        audience reporter_visible
        author_kind reporter_or_workspace_actor
        timestamp created_at
    }
    INTERNAL_NOTE {
        audience workspace_internal
        identifier author
        timestamp created_at
    }
    ATTACHMENT {
        identifier id
        attachment_metadata approved_metadata
        audience inherited_audience
        validation_state staged_accepted_or_rejected
        deletion_state follows_feedback
    }
    LIFECYCLE_EVENT {
        lifecycle_state previous_state
        lifecycle_state next_state
        transition actor_time_reason
    }
    ACCESS_GRANT {
        access_state active_revoked_or_expired
        access_scope feedback_only
    }
    NOTIFICATION {
        recipient_scope recipient_and_audience
        delivery_channel in_product_or_email
        delivery_state outcome
    }
    THEME {
        identifier id
        derived_provenance author_source_time
    }
    THEME_ASSOCIATION {
        derived_provenance author_source_time
    }
    FEEDBACK_RELATION {
        relationship meaning
        derived_provenance author_time
    }
    DELETION_RECORD {
        deletion_state state
        audit requester_actor_time
    }
    WORKSPACE_ACTOR {
        identifier id
        fixed_role workspace_owner_or_maintainer
    }
    PROJECT_ASSIGNMENT {
        identifier project_id
        identifier maintainer_id
    }
    PLATFORM_OPERATOR {
        identifier id
    }
    PLATFORM_OWNER {
        identifier id
    }
    EXCEPTIONAL_ACCESS_GRANT {
        identifier workspace_id
        access_scope resource_and_action
        grant_window start_and_expiry_max_one_hour
        audit approver_justification_state
        incident_scope normal_or_critical_break_glass
    }
```

This model expresses conceptual identity and cardinality, not storage fields.
In particular:

- one unidentified Reporter may be created for a submission without implying
  that unrelated unidentified submissions are the same person;
- controlled attribution changes are historical domain actions, not direct
  foreign-key editing;
- Project slugs are separate conceptual records because current and historical
  values have different route behavior while remaining reserved to one Project;
- Reporter-visible Message and Internal Note are separate concepts because audience is
  an invariant, not a presentation toggle;
- Access Grant is distinct from Reporter Identifier and confirmation reference;
- an Attachment has a staging state only to support logical acceptance and is
  not domain-visible until the complete submission commits;
- Theme, association, and relationship are derived records with provenance;
- a Platform Owner approval is distinct from the requesting Platform Operator,
  and a continued access window is a new grant rather than a mutation of expiry;
- application, page, screen, feature, version, device, and environment remain
  Context values until an independently justified lifecycle requires new domain
  entities.

## 11. Ownership and Mutability Summary

| Concept | Immutable or append-preserved | Controlled mutable state |
| --- | --- | --- |
| Project | Workspace owner; current and historical slug reservation | Active state, current slug, guidance, enabled types, declared Context |
| Reporter | Workspace scope; identifier provenance history | Identifiers, trust, linkage, correction, anonymization through controlled actions |
| Feedback | Workspace/Project ownership, original source, acceptance time | Reporter attribution through controlled history, current lifecycle state, soft-delete state |
| Message / Internal Note | Feedback, author, audience, creation time | No silent audience conversion; corrections are attributable additions |
| Attachment | Feedback ownership, actual-content validation evidence, accepted audience | Staging before acceptance; afterward visibility, restoration, and purge follow Feedback |
| Lifecycle event | Previous/next state, actor, time, reason/trigger | Append only |
| Theme / relationship | Workspace scope, provenance | Accountable correction or removal without source mutation |
| Access Grant | Feedback scope | Active, revoked, or expired |
| Exceptional access grant | Operator, distinct approver, justification, Workspace/resource/action scope, start and <=1-hour expiry | Revocation before expiry; audit is append-only and extension creates a new grant |

## 12. Architecture Handoff

All previously blocking product parameters are represented in these behavioral
and conceptual models. Container, component, deployment, persistence, offline
synchronization, and observability views now follow in `07_ARCHITECTURE.md`.
Those views allocate this model to the validated technical stack; they do not
change its domain identities, ownership, lifecycle, or invariants.
