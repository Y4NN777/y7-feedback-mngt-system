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
| **PD-007** Independently approved, one-hour exceptional Operator access and reviewed critical break-glass | FR-OPS-008..015; NFR-SEC-005 | Role and Exceptional Access; INV-BREAKGLASS-001; exceptional-access and review events | Exceptional Access Control; Safe Observability | Exceptional-access lifecycle; PLATFORM_OWNER and EXCEPTIONAL_ACCESS_GRANT |
| **PD-008** Structured Bug, Suggestion, and Review types | FR-FDB-001..005; NFR-EVO-003 | Source, Type, and Context; INV-SOURCE-001 | Feedback Validation; Project Registry; Feedback Record Stewardship | Intake Activity and Sequence; FEEDBACK type; source preservation |
| **PD-009** Intentional Context and structured MVP Product Intelligence | FR-CTX-001..005; FR-INT-001..010; FR-PRIV-001 | INV-CTX-001; Product Intelligence; INV-INTEL-001..002 | Context Policy; Product Intelligence | CONTEXT_SNAPSHOT, THEME, THEME_ASSOCIATION, FEEDBACK_RELATION; Product Intelligence use case |
| **PD-010** Private, controlled, lifecycle-bound MVP Attachments | FR-ATT-001..013; NFR-CON-001 | Attachment Contract; INV-ATT-001..003; Acceptance and Consistency | Attachment Policy and Coordination | Intake Activity and Sequence; ATTACHMENT ownership, audience, validation, and deletion state |
| **PD-011** In-product and email notifications | FR-NOT-001..007 | Notification Contract; INV-NOTIFY-001; notification events | Notification Coordination | System Context email environment; clarification sequence; NOTIFICATION entity |
| **PD-012** Immediate anonymization/soft deletion, pre-purge restore, 30-day purge | FR-ACC-007; FR-LIFE-010; FR-OPS-007; FR-PRIV-002..009; FR-INT-009; NFR-REC-003 | Anonymization, Soft Deletion, and Retention; INV-DELETE-001; restore and purge events | Data Lifecycle and Privacy; Backup and Recovery | Deletion/recovery states and recovery activity; DELETION_RECORD; ATTACHMENT lifecycle |
| **PD-013** Global mutable project slug with historical redirect | FR-PROJ-001..005; FR-OPS-003 | Project Route Contract; INV-ROUTE-001; ProjectSlugChanged | Project Registry | Intake route activity; PROJECT_SLUG relationship and state |
| **PD-014** Bilingual orientation root without public discovery | FR-PROJ-008..010; NFR-UX-001 | Project Route Contract and Explicit Non-Guarantees | Public Feedback Experience; Project Registry | Root intent description; direct-route intake behavior; accepted root study |
| **PD-015** French and English MVP | NFR-UX-001..002 | User Experience Contract | Public Feedback Experience; Maintainer Feedback Experience; Notification Coordination | Applies across UC-01..10; no localization implementation model introduced |
| **PD-016** SaaS without unrequested commercial or complex-team scope | FR-OWN-007; FR-OPS-001, 010; NFR-EVO-004 | Evolvability Contract and Explicit Non-Guarantees | Workspace Ownership Policy; Workspace Access Control | Workspace ownership and fixed-role model; no billing, plan, marketplace, or custom-domain entity |
| **PD-017** Exact Attachment formats, limits, actual-content validation, and atomicity | FR-ATT-006..013; NFR-SEC-008; NFR-CON-001 | Acceptance and Consistency; Attachment Contract; INV-ATT-002..003; Anti-Abuse Contract | Attachment Policy and Coordination; Feedback Intake Coordination | Intake rejection/cleanup path; staged-to-accepted ATTACHMENT state |
| **PD-018** Daily 30-day backups, RPO 24 h, RTO 4 h | NFR-REC-001..003 | Anonymization, Soft Deletion, and Retention; User Experience and Internal SLO Contract | Backup and Recovery; Data Lifecycle and Privacy; Safe Observability | Backup/recovery activity and deletion replay gate |
| **PD-019** Quantitative anti-abuse without permanent tracking | NFR-SEC-004, 007..011; ERR-015 | Anti-Abuse Contract; INV-ABUSE-001 | Anti-Abuse Policy; Feedback Intake Coordination; Reporter Feedback Access | Intake validation/rejection branch; no persistent Reporter identity inferred |
| **PD-020** Internal availability, Web Vitals, operation, notification, capacity, and viewport objectives | NFR-UX-006; NFR-SLO-001..011 | User Experience and Internal SLO Contract | Safe Observability and each measured operation owner | System context measurement boundary; 320 px and load envelope remain constraints, not domain entities |

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
| INV-ATT-001..003 | FR-ATT-001..013 | Attachment Policy and Coordination | ATTACHMENT relationships and validation/deletion states |
| INV-AUTH-001..002 | FR-OPS-001..006 | Workspace Access Control | WORKSPACE_ACTOR and PROJECT_ASSIGNMENT |
| INV-BREAKGLASS-001 | FR-OPS-008..015 | Exceptional Access Control | Exceptional-access lifecycle and EXCEPTIONAL_ACCESS_GRANT |
| INV-NOTIFY-001 | FR-NOT-001..007 | Notification Coordination | NOTIFICATION and notification sequences |
| INV-INTEL-001..002 | FR-INT-001..010 | Product Intelligence | THEME, associations, relationships, Context |
| INV-DELETE-001 | FR-PRIV-002..009; NFR-REC-003 | Data Lifecycle and Privacy | Deletion/recovery states and DELETION_RECORD |
| INV-ABUSE-001 | NFR-SEC-004, 007..011 | Anti-Abuse Policy | Intake validation and rejection path |

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
| The root page was in scope without defined behavior. | PD-014 and FR-PROJ-008..010 now define the accepted bilingual orientation pattern and preserve direct routes without discovery. |
| SRS requirements had only broad proof categories. | Every normative requirement now has its own acceptance condition. |
| Immediate anonymization appeared compatible with full pre-purge restoration. | FR-PRIV-009 and the Contract make explicit that restoration cannot recreate already anonymized identity. |

## 5. Closed Pre-Architecture Parameter Matrix

All six previously open parameter groups are now validated and traced.

| Closed item | Intent | Requirement | Contract | Responsible owner | Model impact |
| --- | --- | --- | --- | --- | --- |
| Attachments | PD-010, PD-017; PRD 14.1 | FR-ATT-001..013; NFR-SEC-008 | INV-ACCEPT-001; INV-ATT-001..003 | Attachment Policy and Coordination | Atomic intake and staged Attachment state |
| Retention and recovery | PD-012, PD-018; PRD 14.2 | FR-PRIV-002..009; NFR-REC-001..003 | Deletion/Retention and recovery guarantees | Data Lifecycle and Privacy; Backup and Recovery | Restore/purge and backup recovery flows |
| Exceptional access | PD-007; PRD 14.3 | FR-OPS-008..015 | INV-BREAKGLASS-001 | Exceptional Access Control | Approval/grant/review lifecycle |
| Anti-abuse | PD-019; PRD 14.4 | NFR-SEC-004, 007..011 | INV-ABUSE-001 | Anti-Abuse Policy | Intake limit rejection path |
| Internal SLOs | PD-020; PRD 14.5 | NFR-UX-006; NFR-SLO-001..011 | User Experience and Internal SLO Contract | Safe Observability and measured-operation owners | Recovery gate and cross-cutting model constraints |
| Root experience | PD-014; root study | FR-PROJ-008..010 | Project Route Contract | Public Feedback Experience | Root intent description and direct-route bypass |

## 6. Architecture Gate Result

The Intent-to-Modeling chain is complete and the six former blockers are closed.
Architecture is authorized and derived in `07_ARCHITECTURE.md`; important
allocation decisions and alternatives are recorded in
`08_ARCHITECTURE_DECISIONS.md`. Architecture remains subordinate to this chain:
an ADR cannot silently change a product decision, requirement, contract, or
domain invariant.
