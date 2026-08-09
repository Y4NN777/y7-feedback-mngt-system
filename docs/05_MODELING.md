# Behavioral and Domain Models - Y7 Feedback

## 1. Modeling Scope

These models describe actors, behavior, and information ownership. A technical
container architecture is deferred because identity, attachment policy,
operational roles, and measurable service targets remain open.

## 2. System Context

```mermaid
flowchart LR
    Reporter[Reporter]
    WorkspaceActor[Authorized workspace actor]
    Operator[Platform operator]
    FeedbackSystem[Y7 Feedback system]

    Reporter -->|submits feedback and evidence| FeedbackSystem
    FeedbackSystem -->|shows outcome and confirmation| Reporter
    WorkspaceActor -->|configures projects and reviews feedback| FeedbackSystem
    Operator -->|operates and monitors the platform| FeedbackSystem
```

The context intentionally leaves authentication and reporter identity modes
unspecified.

## 3. Core Use Cases

| ID | Actor | Outcome |
| --- | --- | --- |
| UC-01 | Reporter | Resolve a project from its public slug. |
| UC-02 | Reporter | Submit a review, suggestion, or bug report. |
| UC-03 | Reporter | Attach permitted supporting evidence. |
| UC-04 | Reporter | Receive an accurate acceptance or failure outcome. |
| UC-05 | Authorized workspace actor | Configure or deactivate a permitted project. |
| UC-06 | Authorized workspace actor | Retrieve feedback for permitted projects. |
| UC-07 | Platform operator | Diagnose operational failures without exposing protected content. |

Reporter follow-up, replies, public boards, voting, and status tracking are not
core use cases until explicitly approved.

## 4. Submission Activity

```mermaid
flowchart TD
    Start([Open project route]) --> Resolve{Resolve one active project?}
    Resolve -- No --> RouteError[Show unavailable project outcome]
    Resolve -- Yes --> Show[Show project identity and feedback choices]
    Show --> Enter[Enter feedback and optional disclosed data]
    Enter --> Review[Review target, content, context, and attachments]
    Review --> Validate{Input and policy valid?}
    Validate -- No --> Correct[Show actionable validation errors]
    Correct --> Enter
    Validate -- Yes --> Admit{Admission and persistence succeed?}
    Admit -- No, retryable --> Retry[Show safe retryable outcome]
    Admit -- No, rejected --> Reject[Show rejection without confirmation]
    Admit -- Yes --> Confirm[Show confirmation reference]
```

## 5. Submission Sequence

```mermaid
sequenceDiagram
    actor R as Reporter
    participant P as Public Experience
    participant G as Project Registry
    participant V as Validation
    participant I as Intake Coordination
    participant A as Attachment Coordination
    participant F as Feedback Repository

    R->>P: Open /{project-slug}
    P->>G: Resolve active project
    G-->>P: Trusted project and workspace scope
    P-->>R: Project identity and configured form
    R->>P: Submit feedback and optional evidence
    P->>V: Validate against resolved project policy
    V-->>P: Validated input or actionable errors
    P->>I: Admit logical submission
    I->>A: Validate and stage permitted evidence
    A-->>I: Evidence result
    I->>F: Persist feedback, ownership, and associations
    F-->>I: Durable acceptance
    I-->>P: Confirmation reference
    P-->>R: Accepted outcome
```

Failure paths must follow the acceptance and cleanup guarantees in the core
contract.

## 6. Conceptual Information Model

```mermaid
erDiagram
    WORKSPACE ||--o{ PROJECT : owns
    PROJECT ||--o{ FEEDBACK : receives
    FEEDBACK ||--o{ ATTACHMENT : includes

    WORKSPACE {
        identifier id
    }
    PROJECT {
        identifier id
        identifier workspace_id
        string public_slug
        lifecycle_state state
    }
    FEEDBACK {
        identifier id
        identifier project_id
        feedback_type type
        content payload
        timestamp accepted_at
    }
    ATTACHMENT {
        identifier id
        identifier feedback_id
        attachment_metadata metadata
    }
```

This is a conceptual model, not a database schema. Reporter identity is absent
because its data model depends on the unresolved identity policy. Feedback
content remains abstract because type-specific schemas are also unresolved.

## 7. Deferred Architecture Views

A container or deployment view becomes meaningful only after decisions establish:

1. identity and authorization boundaries;
2. attachment processing and retention requirements;
3. management-interface scope;
4. availability, latency, scale, and regional requirements;
5. privacy and data-location constraints.

At that point, architecture options can be compared against the same contract
without changing the domain model.
