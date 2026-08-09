# Decision Traceability Matrix - Y7 Feedback

## 1. Purpose

This matrix proves that important product decisions flow through the complete
pre-architecture chain:

```text
Decision -> Requirement -> Contract -> Responsibility -> Model
```

Decision identifiers are defined in `01_PRD.md`. Requirements are defined in
`02_SRS.md`, invariants and observable guarantees in `03_CONTRACT.md`, primary
owners in `04_RESPONSIBILITIES.md`, and behavior and relationships in
`05_MODELING.md`.

## 2. Validated Decision Matrix

| Decision | Requirements | Contract | Primary responsibilities | Model evidence |
| --- | --- | --- | --- | --- |
| **PD-001** Independent multi-project feedback-loop product | FR-OWN-007; FR-PROJ-006..007; FR-FDB-001, 006..009; NFR-CON-001..004; NFR-EVO-001 | Observable Operations 3.1..3.5; Acceptance and Consistency; INV-ACCEPT-001 | Project Registry; Feedback Intake Coordination; Feedback Record Stewardship; Public and Maintainer Experiences | System Context; UC-01..11; Intake Activity and Sequence; Conceptual Information Model |
| **PD-002** Workspace ownership and SaaS isolation | FR-OWN-001, 003..007; FR-REP-006; FR-INT-008; NFR-SEC-001..003, 006; NFR-EVO-002 | INV-OWN-001, 003..006; Isolation behavior in Observable Operations | Workspace Ownership Policy | System Context; WORKSPACE ownership relationships; Ownership and Mutability Summary |
| **PD-003** Workspace-scoped Reporter distinct from authentication | FR-OWN-002..003; FR-REP-001..009; FR-PRIV-001; NFR-EVO-005 | INV-OWN-002..003; Reporter Attribution; INV-REP-001 | Reporter Attribution | Reporter Attribution Model; REPORTER and REPORTER_IDENTIFIER relationships |
| **PD-004** Accountless continuity, conversation, lifecycle, history, reopening | FR-FDB-007, 009; FR-ACC-001..007; FR-CONV-001, 003..005; FR-LIFE-001..010 | Reference and Access; Conversation and Visibility; Feedback Lifecycle; INV-ACCESS-001, INV-SOURCE-001, INV-VIS-001, INV-LIFE-001..002 | Reporter Feedback Access; Conversation Coordination; Feedback Lifecycle; Feedback Record Stewardship | Accountless Retrieval; Clarification Sequence; Lifecycle Diagram; ACCESS_GRANT, VISIBLE_MESSAGE, LIFECYCLE_EVENT |
| **PD-005** Internal Notes separate from Reporter-visible Messages | FR-CONV-002, 005; FR-NOT-005; FR-OPS-006 | INV-VIS-001..002; Conversation and Visibility | Conversation Coordination | Clarification Sequence boundary; VISIBLE_MESSAGE and INTERNAL_NOTE entities |
| **PD-006** Fixed actors; Owner assigns Maintainers | FR-OPS-001..006; FR-NOT-004 | Actor Authority; INV-AUTH-001..002 | Workspace Access Control; Project Registry; Maintainer Feedback Experience | System Context; WORKSPACE_ACTOR and PROJECT_ASSIGNMENT relationships |
| **PD-007** Exceptional, justified, limited, audited Platform Operator access | FR-OPS-008..009; NFR-SEC-005 | Role and Exceptional Access; INV-BREAKGLASS-001; exceptional-access events | Exceptional Access Control; Safe Observability | System Context; EXCEPTIONAL_ACCESS_GRANT relationships and attributes |
| **PD-008** Structured Bug, Suggestion, and Review types | FR-FDB-001..005; NFR-EVO-003 | Source, Type, and Context; INV-SOURCE-001 | Feedback Validation; Project Registry; Feedback Record Stewardship | Intake Activity and Sequence; FEEDBACK type; source preservation |
| **PD-009** Intentional Context and structured MVP Product Intelligence | FR-CTX-001..005; FR-INT-001..010; FR-PRIV-001 | INV-CTX-001; Product Intelligence; INV-INTEL-001..002 | Context Policy; Product Intelligence | CONTEXT_SNAPSHOT, THEME, THEME_ASSOCIATION, FEEDBACK_RELATION; Product Intelligence use case |
| **PD-010** MVP Attachments | FR-ATT-001..008; NFR-CON-001 | Attachment Contract; INV-ATT-001 | Attachment Policy and Coordination | Intake Activity and Sequence; ATTACHMENT ownership relationship |
| **PD-011** In-product and email notifications | FR-NOT-001..007 | Notification Contract; INV-NOTIFY-001; notification events | Notification Coordination | System Context email environment; clarification sequence; NOTIFICATION entity |
| **PD-012** Anonymization and soft deletion | FR-ACC-007; FR-LIFE-010; FR-OPS-007; FR-PRIV-002..006; FR-INT-009 | Anonymization, Soft Deletion, and Retention; INV-DELETE-001; deletion events | Data Lifecycle and Privacy | Deletion state diagram; DELETION_RECORD; record-state mutability |
| **PD-013** Global mutable project slug with historical redirect | FR-PROJ-001..005; FR-OPS-003 | Project Route Contract; INV-ROUTE-001; ProjectSlugChanged | Project Registry | Intake route activity; PROJECT_SLUG relationship and state |
| **PD-014** Root is not an automatic catalog; exact experience open | FR-PROJ-008; OPEN-ROOT-001 | Project Route Contract and Explicit Non-Guarantees | Public Feedback Experience | Direct-route intake behavior; root excluded from other model behavior; non-normative root study |
| **PD-015** French and English MVP | NFR-UX-001..002 | User Experience Contract | Public Feedback Experience; Maintainer Feedback Experience; Notification Coordination | Applies across UC-01..10; no localization implementation model introduced |
| **PD-016** SaaS without unrequested commercial or complex-team scope | FR-OWN-007; FR-OPS-001, 010; NFR-EVO-004 | Evolvability Contract and Explicit Non-Guarantees | Workspace Ownership Policy; Workspace Access Control | Workspace ownership and fixed-role model; no billing, plan, marketplace, or custom-domain entity |

## 3. Invariant Ownership Check

| Contract invariant family | Requirement origin | Single primary owner | Model location |
| --- | --- | --- | --- |
| INV-OWN-* | FR-OWN-* | Owners listed individually in Responsibilities Section 5 | WORKSPACE, PROJECT, REPORTER, FEEDBACK and child ownership |
| INV-ROUTE-001 | FR-PROJ-001..005 | Project Registry | PROJECT_SLUG and route activity |
| INV-REP-001 | FR-REP-001..009 | Reporter Attribution | Reporter Attribution Model |
| INV-ACCESS-001 | FR-ACC-001..006 | Reporter Feedback Access | Accountless Retrieval and ACCESS_GRANT |
| INV-SOURCE-001 | FR-FDB-009 | Feedback Record Stewardship | SOURCE_REVISION and mutability summary |
| INV-CTX-001 | FR-CTX-001..005 | Context Policy | CONTEXT_SNAPSHOT |
| INV-ACCEPT-001 | FR-FDB-007..008; NFR-CON-001..003 | Feedback Intake Coordination | Intake Activity and Sequence |
| INV-VIS-001..002 | FR-CONV-001..005 | Conversation Coordination | VISIBLE_MESSAGE and INTERNAL_NOTE |
| INV-LIFE-001..002 | FR-LIFE-001..010 | Feedback Lifecycle | Lifecycle diagrams and LIFECYCLE_EVENT |
| INV-ATT-001 | FR-ATT-001..008 | Attachment Policy and Coordination | ATTACHMENT relationships |
| INV-AUTH-001..002 | FR-OPS-001..006 | Workspace Access Control | WORKSPACE_ACTOR and PROJECT_ASSIGNMENT |
| INV-BREAKGLASS-001 | FR-OPS-008..009 | Exceptional Access Control | EXCEPTIONAL_ACCESS_GRANT |
| INV-NOTIFY-001 | FR-NOT-001..007 | Notification Coordination | NOTIFICATION and notification sequences |
| INV-INTEL-001..002 | FR-INT-001..010 | Product Intelligence | THEME, associations, relationships, Context |
| INV-DELETE-001 | FR-PRIV-002..006 | Data Lifecycle and Privacy | Deletion state and DELETION_RECORD |

## 4. Resolved Contradictions

| Previous inconsistency | Resolution in this chain |
| --- | --- |
| Reporter identity and follow-up were marked open. | PD-003 and PD-004 define attribution modes and accountless continuity; FR-REP-* and FR-ACC-* specify behavior. |
| Conversation and status tracking were out of scope or explicit non-guarantees. | They are now MVP use cases with separate visible/internal content and lifecycle contracts. |
| Slug uniqueness was open despite the global `/{slug}` route. | PD-013 makes current and historical slugs globally reserved and non-reassignable. |
| Attachments were inaccessible to all public actors, including a returning Reporter. | FR-ATT-004..005 distinguish unauthorised public access from authorised feedback-scoped Reporter access. |
| Platform Operator and workspace authorization were flattened into an undefined actor. | Fixed actor authority and exceptional access are separated in FR-OPS-* and the contract. |
| Project Registry and Feedback Repository both claimed Project persistence. | Project Registry owns Project records; Feedback Record Stewardship owns Feedback records. |
| French and English lacked a PRD source. | PD-015 now supplies the intent source for NFR-UX-001..002. |
| The root page was in scope without defined behavior. | The no-catalog rule is normative; all other behavior is isolated as OPEN-ROOT-001 and non-normative research. |
| SRS requirements had only broad proof categories. | Every normative requirement now has its own acceptance condition. |

## 5. Open Parameter Matrix

These rows are not validated decisions. They identify the exact remaining input
and prevent architecture or implementation from inventing it.

| Open item | Intent | Requirement | Contract | Responsible owner | Model impact |
| --- | --- | --- | --- | --- | --- |
| OPEN-ATT-001 Attachment policy | PRD 14.1 | FR-ATT-006..008 and explicit open entry | Attachment Contract | Attachment Policy and Coordination | Intake failure branch, ATTACHMENT metadata and entry relationship |
| OPEN-RET-001 Retention and purge | PRD 14.2 | FR-PRIV-004..006 | Deletion and Retention Contract | Data Lifecycle and Privacy | Soft-deleted to purged transition and data-class lifetimes |
| OPEN-OPS-001 Exceptional-access approver | PRD 14.3 | FR-OPS-009 open entry | Exceptional Access Contract | Exceptional Access Control | EXCEPTIONAL_ACCESS_GRANT authorizer |
| OPEN-ABUSE-001 Quantitative abuse bounds | PRD 14.4 | NFR-SEC-004 open entry | Acceptance and security behavior | Feedback Intake Coordination; Reporter Feedback Access | Rejection branches only; no component implied |
| OPEN-SLO-001 Service and device targets | PRD 14.4 | Explicit open NFR entry | No invented guarantee | Cross-cutting; primary owners follow the chosen target | Required before architecture and deployment views |
| OPEN-ROOT-001 Exact root experience | PRD 14.5; root study | FR-PROJ-008 fixes only no catalog | No guarantee beyond no catalog | Public Feedback Experience | No root flow beyond direct-route behavior until approved |

## 6. Architecture Gate Result

The Intent-to-Modeling chain is structurally traceable, but architecture is not
yet authorized. The Open Parameter Matrix still contains inputs that materially
affect security, privacy, consistency, capacity, delivery, and storage behavior.

The root recommendation can remain outside architecture-driving scope if no
additional `/` behavior is approved. Attachment, retention, exceptional-access
approval, anti-abuse, and measurable service targets require explicit decisions
before architecture options can be compared responsibly.
