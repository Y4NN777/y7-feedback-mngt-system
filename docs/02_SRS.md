# Software Requirements Specification - Y7 Feedback

## 1. Status and Normative Language

This SRS derives observable behavior from `01_PRD.md`. `MUST` and `MUST NOT`
are normative. Every normative requirement has an acceptance condition.

The product direction is approved, but the parameters listed in Section 15 are
still open. An `OPEN-*` entry records missing input and is not permission for an
implementation to invent a default.

## 2. Domain Vocabulary

- **Workspace** - customer ownership and isolation boundary.
- **Project** - feedback target owned by one workspace.
- **Reporter** - workspace-scoped source or subject of feedback, distinct from an
  authentication account.
- **Reporter identifier** - optional attribution evidence, with a kind, issuer,
  scope, value, and trust state.
- **Feedback** - a living project-owned work item containing source content,
  context, lifecycle, conversation, history, and derived analysis.
- **Reporter-visible message** - conversation entry intended for both reporter
  and authorized workspace actors.
- **Internal note** - workspace-only entry that is never part of the reporter
  conversation.
- **Attachment** - private evidence owned by one feedback item.
- **Context snapshot** - intentionally supplied information describing the
  situation in which feedback arose.
- **Theme and relationship** - accountable derived classification that does not
  replace source feedback.
- **Access proof** - confidential evidence authorizing accountless access to a
  feedback item; it is distinct from the confirmation reference.

## 3. Ownership and Isolation

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-OWN-001 | PD-002 | Every Project MUST belong to exactly one Workspace. | Creation without one workspace or with multiple workspaces is rejected. |
| FR-OWN-002 | PD-003 | Every Reporter MUST belong to exactly one Workspace. | A stored Reporter has one immutable workspace owner. |
| FR-OWN-003 | PD-002, PD-003 | Every Feedback MUST belong to exactly one Project and one Reporter in the same Workspace. | Cross-workspace project/reporter association and missing ownership are rejected. |
| FR-OWN-004 | PD-002 | Every Message, Internal Note, Attachment, lifecycle event, notification record, relationship, theme association, and context snapshot MUST inherit the Feedback workspace and project scope. | Reading each child through a different workspace or project scope is rejected. |
| FR-OWN-005 | PD-002 | Accepted Workspace and Project ownership MUST NOT be reassigned by an ordinary update. | Attempts to change workspace or project ownership through edit operations are rejected and leave ownership unchanged. |
| FR-OWN-006 | PD-002 | An actor authorized in one Workspace MUST NOT access another Workspace's business data. | A cross-workspace read, write, search, aggregate, attachment, or notification test returns no protected data. |
| FR-OWN-007 | PD-001, PD-016 | Adding a Project or Workspace MUST NOT require a separate copy of Y7 Feedback. | A second project and a second workspace use the same product behavior and ownership model. |

## 4. Project Routes and Lifecycle

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-PROJ-001 | PD-013 | A current project slug MUST be globally unique across Y7 Feedback. | A slug already owned as current or historical by another project cannot be assigned. |
| FR-PROJ-002 | PD-013 | `/wisemoney` MUST resolve to the initial WiseMoney project. | Opening the route resolves one project and displays WiseMoney before intake. |
| FR-PROJ-003 | PD-013 | A current slug MUST resolve to exactly one Project and derive its Workspace from trusted project ownership. | Public workspace or project identifiers cannot override the resolved scope. |
| FR-PROJ-004 | PD-013 | Changing a slug MUST make the new slug canonical and retain every old slug as a redirect to that same Project's current slug. | Each historical route redirects to the current route without changing project identity. |
| FR-PROJ-005 | PD-013 | A current or historical slug MUST NOT later identify a different Project. | Reassignment to another project is rejected, including after deactivation or soft deletion. |
| FR-PROJ-006 | PD-001 | Only an active Project MUST accept new feedback. | Unknown or inactive project routes create no feedback and show an unavailable outcome. |
| FR-PROJ-007 | PD-001 | Deactivating a Project MUST preserve its feedback, conversation, attachments, history, and intelligence ownership. | Historical data remains available to authorized actors after intake stops. |
| FR-PROJ-008 | PD-014 | `/` MUST NOT automatically list or enumerate Projects. | An unauthenticated root response contains no generated project catalog or project suggestions. |
| OPEN-ROOT-001 | PD-014 | The exact content and navigation behavior of `/` awaits explicit approval of or changes to `research/ROOT_EXPERIENCE.md`. | No additional root behavior is normative yet. |

## 5. Reporter Attribution

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-REP-001 | PD-003 | A Feedback MUST retain a Reporter association even when that Reporter is unidentified. | An unidentified submission creates no false verified identity but remains attributable to one workspace-scoped Reporter. |
| FR-REP-002 | PD-003 | A Reporter MUST support no identifier, voluntary contact, an application-scoped `external_user_id`, or an identity assertion from a Client Application. | Each approved attribution mode can be represented without creating a Y7 Feedback login account. |
| FR-REP-003 | PD-003 | Every external identifier MUST be scoped by Workspace and by its application or issuer. | Equal raw values from different workspaces or issuers do not resolve to the same Reporter. |
| FR-REP-004 | PD-003 | A public `external_user_id` value MUST NOT be treated as verified merely because a request supplied it. | Untrusted input remains unverified; only an approved client assertion can raise its trust state. |
| FR-REP-005 | PD-003 | Multiple Feedback items MAY be linked to one Reporter only when approved attribution evidence supports the match. | Unidentified submissions and unverified contacts are not silently merged. |
| FR-REP-006 | PD-002, PD-003 | Reporter matching MUST NOT cross Workspace boundaries. | The same contact or external identifier in two workspaces produces isolated Reporter scopes. |
| FR-REP-007 | PD-003 | Requested contact and identity data MUST be disclosed with its purpose and whether it is optional before submission. | The review step shows each collected reporter field, purpose, and optionality. |
| FR-REP-008 | PD-003 | Y7 Feedback MUST NOT fingerprint devices or observe unrelated behavior to infer Reporter continuity. | Reporter linking tests use only declared submitted data, approved assertions, or explicit access continuity. |
| FR-REP-009 | PD-003, PD-012 | Linking, correcting, merging, or anonymizing a Feedback-to-Reporter attribution MUST stay inside one Workspace and preserve an attributable history. | The controlled operation records prior attribution, resulting attribution, reason, actor/process, and time; an ordinary edit cannot perform it. |

## 6. Feedback Types, Capture, and Context

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-FDB-001 | PD-001, PD-008 | An active Project MUST accept the enabled system types `bug`, `suggestion`, and `review`. | Each enabled type can be submitted; each disabled or unknown type is rejected. |
| FR-FDB-002 | PD-008 | A Bug MUST state what does not work and MUST allow expected behavior, observed behavior, reproduction steps, and context when applicable. | A missing problem statement is rejected; optional details can be omitted or supplied independently. |
| FR-FDB-003 | PD-008 | A Suggestion MUST state the proposed improvement and why it would help, and MUST allow usage context when applicable. | Missing proposal or rationale is rejected; optional context can be omitted. |
| FR-FDB-004 | PD-008 | A Review MUST state the experienced outcome and the reporter's appreciation. | Missing experience or appreciation is rejected; no numeric rating is required. |
| FR-FDB-005 | PD-008 | An active Project MUST enable at least one system feedback type and MAY provide type-specific guidance, but MUST NOT redefine a type's core meaning. | Configuration cannot activate intake with no type and cannot accept a different semantic payload under an existing type. |
| FR-FDB-006 | PD-001 | Before sending, the reporter MUST be able to review the target Project, type, source content, Reporter data, Context, and Attachments that will be submitted. | The final review exposes every submitted category and permits correction before acceptance. |
| FR-FDB-007 | PD-004 | Acceptance MUST return a unique confirmation reference and establish accountless access only after durable ownership and source content exist. | Persistence failure returns no successful confirmation or usable access. |
| FR-FDB-008 | PD-001 | Intake MUST distinguish accepted, rejected, and retryable outcomes. | Each outcome is visibly different and a failed outcome is never labelled accepted. |
| FR-FDB-009 | PD-004 | The original accepted source content MUST remain distinguishable from later reporter revisions, messages, maintainer notes, and derived analysis. | A later change cannot erase the original value or its author and time. |
| FR-CTX-001 | PD-009 | Feedback MUST support an intentional Context snapshot with applicable application version, page/screen, feature, platform, operating system, device, locale, environment, and functional context. | Each supported context dimension can be omitted or stored with the Feedback when supplied. |
| FR-CTX-002 | PD-009 | Every Context value MUST retain its source and collection purpose. | A value can be identified as reporter-supplied, client-asserted, or system-observed for a disclosed operational purpose. |
| FR-CTX-003 | PD-009 | Context supplied by a public request MUST NOT be treated as trusted application evidence. | Trust-sensitive queries distinguish unverified public context from approved client assertions. |
| FR-CTX-004 | PD-009 | The reporter MUST be informed of Context sent with the submission before acceptance. | The review step displays a meaningful summary of submitted Context. |
| FR-CTX-005 | PD-009 | Project-specific Context MUST be bounded by declared names, types, purposes, and sensitivity rules. | Undeclared, oversized, malformed, or executable context is rejected. |

## 7. Accountless Reporter Access

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-ACC-001 | PD-004 | The confirmation reference MUST identify a Feedback item but MUST NOT, by itself, authorize access to protected content. | Knowing only another feedback reference cannot retrieve its data. |
| FR-ACC-002 | PD-004 | Accountless access MUST require a valid Feedback-specific Access Proof or an approved identity proof associated with the Reporter. | Valid proof retrieves only permitted data; missing, invalid, expired, or revoked proof does not. |
| FR-ACC-003 | PD-004 | An authorized Reporter MUST be able to view the Feedback source, current state, reporter-visible history, visible Messages, and permitted Attachments. | The reporter view contains these items and omits all Internal Notes and workspace-only data. |
| FR-ACC-004 | PD-004 | An authorized Reporter MUST be able to add a clarification and update information explicitly permitted by policy. | The change is attributed and historical source values remain recoverable. |
| FR-ACC-005 | PD-004 | Access Proof MUST be revocable without changing Feedback ownership or confirmation reference. | Revocation blocks the old proof while leaving the Feedback and reference intact. |
| FR-ACC-006 | PD-004 | Accountless access to one Feedback MUST NOT imply access to every Feedback attributed to the same Reporter. | A feedback-specific proof cannot enumerate or retrieve sibling feedback items. |
| FR-ACC-007 | PD-012 | An authorized Reporter MUST be able to submit a deletion request for the accessed Feedback. | A valid request is recorded and visible as received without claiming immediate purge. |

## 8. Conversation, Notes, and Lifecycle

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-CONV-001 | PD-004 | Every reporter-visible Message MUST belong to one Feedback and retain its author and creation time. | An orphaned, unauthored, or undated visible message is rejected. |
| FR-CONV-002 | PD-005 | Every Internal Note MUST belong to one Feedback and MUST be visible only to authorized workspace actors. | Reporter access, emails, exports intended for reporters, and public responses contain no Internal Note. |
| FR-CONV-003 | PD-004 | An assigned Project Maintainer MUST be able to send a reporter-visible response and request additional information. | The response appears in the authorized reporter view; an information request also produces the required lifecycle transition. |
| FR-CONV-004 | PD-004 | An authorized Reporter MUST be able to add a clarification to the Feedback conversation. | The clarification appears with Reporter authorship and cannot be represented as a maintainer entry. |
| FR-CONV-005 | PD-004, PD-005 | A Message MUST NOT silently change audience between reporter-visible and internal. | Audience conversion is rejected; correction requires a new attributable action. |
| FR-LIFE-001 | PD-004 | Feedback status MUST be one of `received`, `under_review`, `awaiting_reporter`, `resolved`, or `closed`. | Any other primary lifecycle status is rejected. |
| FR-LIFE-002 | PD-004 | Newly accepted Feedback MUST enter `received`. | The acceptance result and first lifecycle event both record `received`. |
| FR-LIFE-003 | PD-004 | `under_review` MUST mean that an authorized maintainer is actively understanding, analyzing, or acting on the Feedback. | A transition to this state records the responsible workspace actor. |
| FR-LIFE-004 | PD-004 | `awaiting_reporter` MUST correspond to a reporter-visible request for information. | The state cannot be entered without an associated visible request. |
| FR-LIFE-005 | PD-004 | An accepted Reporter clarification while `awaiting_reporter` MUST return the Feedback to `under_review`. | The clarification and resulting transition are both present in history. |
| FR-LIFE-006 | PD-004 | `resolved` MUST mean that a maintainer has recorded a substantive conclusion and expects no current treatment action. | A transition to `resolved` records the maintainer and a reporter-visible resolution statement. |
| FR-LIFE-007 | PD-004 | `closed` MUST mean that no active treatment or exchange is expected; closing MUST NOT delete the Feedback. | Closed feedback remains retrievable and retains all history. |
| FR-LIFE-008 | PD-004 | An assigned Project Maintainer or Workspace Owner MUST be able to reopen `resolved` or `closed` Feedback into `under_review` with a reason. | Reopening records the prior state, actor, reason, and time. |
| FR-LIFE-009 | PD-004 | Every lifecycle transition MUST preserve previous states, actor, time, and reason or triggering action. | The complete ordered state history can be retrieved by an authorized workspace actor. |
| FR-LIFE-010 | PD-012 | Soft-deletion state MUST be separate from the feedback-treatment lifecycle. | Soft deletion cannot be expressed as one of the five treatment statuses. |

Allowed primary transitions are:

| From | To | Trigger |
| --- | --- | --- |
| `received` | `under_review` | Maintainer begins treatment. |
| `received`, `under_review` | `awaiting_reporter` | Maintainer sends an information request. |
| `awaiting_reporter` | `under_review` | Reporter clarifies or maintainer resumes with a recorded reason. |
| `received`, `under_review`, `awaiting_reporter` | `resolved` | Maintainer records a substantive conclusion. |
| Any non-deleted treatment state | `closed` | Maintainer or Workspace Owner records closure. |
| `resolved`, `closed` | `under_review` | Maintainer or Workspace Owner records reopening. |

## 9. Attachments

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-ATT-001 | PD-010 | The MVP MUST allow supported Attachments on Feedback intake. | At least one approved attachment policy can accept evidence for an active project. |
| FR-ATT-002 | PD-010 | Every accepted Attachment MUST belong to exactly one Feedback and inherit its scope. | An attachment without feedback or in a different workspace/project scope is rejected. |
| FR-ATT-003 | PD-010 | An Attachment MAY identify the Message or source submission through which it was added without changing its Feedback ownership. | Evidence added in an approved phase remains owned by the same Feedback. |
| FR-ATT-004 | PD-010 | Attachments MUST NOT be publicly listable or retrievable. | Access without authorized Reporter or workspace-actor scope returns no content or identifying metadata. |
| FR-ATT-005 | PD-010 | Attachment authorization MUST follow Feedback authorization and Message audience. | A Reporter cannot retrieve evidence attached only to an Internal Note. |
| FR-ATT-006 | PD-010 | Declared type, actual content, size, count, and security policy MUST be validated before acceptance. | A file violating any approved rule is not marked accepted. |
| FR-ATT-007 | PD-010 | Failed intake MUST NOT leave request-owned Attachment data as an unassociated durable object. | Cleanup verification finds no durable orphan after failure. |
| FR-ATT-008 | PD-010, PD-012 | Attachment metadata collection, visibility, anonymization, retention, and deletion MUST follow an explicit approved policy. | Policy tests prove that undeclared metadata is neither exposed nor retained beyond its rule. |

`OPEN-ATT-001`: formats, byte limits, count, validation depth, metadata treatment,
initial-submission atomicity, later-message attachment behavior, and retention
periods are not yet supplied.

## 10. Roles, Project Operation, and Exceptional Access

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-OPS-001 | PD-006 | The MVP MUST use the fixed responsibilities Workspace Owner, Project Maintainer, and Platform Operator without a configurable role builder. | Authorization can be tested against these roles without defining custom roles. |
| FR-OPS-002 | PD-006 | A Workspace Owner MUST be able to create, configure, activate, and deactivate Projects in that Workspace. | The same action against another Workspace is rejected. |
| FR-OPS-003 | PD-006, PD-013 | A Workspace Owner MUST be able to change a Project slug subject to global current-and-historical uniqueness. | A valid rename creates the canonical slug and redirect; a collision is rejected. |
| FR-OPS-004 | PD-006 | A Workspace Owner MUST be able to assign and remove Project Maintainers for Projects in that Workspace. | Assignment grants only the selected project scope; removal ends new access. |
| FR-OPS-005 | PD-006 | A Project Maintainer MUST access only assigned Projects and MUST be able to read Feedback, permitted Attachments, visible Messages, Internal Notes, lifecycle history, and Product Intelligence in that scope. | Assigned-project operations succeed; unassigned-project operations return no protected data. |
| FR-OPS-006 | PD-004, PD-005, PD-006 | A Project Maintainer MUST be able to respond, request information, add Internal Notes, change lifecycle state, resolve, close, and reopen Feedback in assigned Projects. | Each capability succeeds in-scope and is rejected out-of-scope. |
| FR-OPS-007 | PD-012 | Feedback deletion by a workspace actor MUST require the actor capability and preserve an audit record. | An unauthorized deletion fails; an authorized one records actor, scope, reason, and time. |
| FR-OPS-008 | PD-007 | A Platform Operator MUST NOT have standing access to Workspace business content. | Normal operator credentials cannot read Feedback content, Reporter identifiers, Messages, Internal Notes, or Attachments. |
| FR-OPS-009 | PD-007 | Exceptional operator access MUST be explicitly authorized, purpose-bound, workspace-scoped, time-limited, revocable, and audited. | Access outside its approved scope or time fails; grant and use events identify authorizer, operator, purpose, scope, and time. |
| FR-OPS-010 | PD-001, PD-016 | The MVP MUST provide an explicit first-party operational path for project management and feedback work; a vendor console MUST NOT be the product contract. | UC-07 and UC-08 can be completed without directly editing vendor-owned data. |

`OPEN-OPS-001`: the role or authority allowed to approve exceptional Platform
Operator content access has not been supplied.

## 11. Notifications

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-NOT-001 | PD-011 | The MVP MUST present relevant notifications in the recipient's authorized product experience. | The event appears only in the correct Reporter or workspace scope. |
| FR-NOT-002 | PD-011 | The MVP MUST support email notification when an intended recipient has an eligible email address and the approved purpose permits its use. | Eligible events request email delivery; absence of an eligible address does not fabricate one or fail the domain action. |
| FR-NOT-003 | PD-004, PD-011 | Reporter notification events MUST include acceptance, visible maintainer response, information request, reporter-visible status change, and deletion-request outcome. | Each event produces an in-product notification and conditional email for the correct Reporter. |
| FR-NOT-004 | PD-006, PD-011 | Maintainer notification events MUST include new assigned-project Feedback, Reporter clarification, and deletion request. | Each event notifies only currently authorized actors for that project. |
| FR-NOT-005 | PD-005, PD-011 | Internal Note content MUST NOT appear in Reporter notifications. | Reporter in-product and email outputs contain no internal-note content or existence disclosure. |
| FR-NOT-006 | PD-011 | Notification failure MUST NOT roll back an already accepted Feedback, Message, lifecycle transition, or deletion request. | Simulated delivery failure preserves the domain action and records a non-success delivery outcome. |
| FR-NOT-007 | PD-011 | Email content MUST NOT include access secrets, Internal Notes, or unnecessary sensitive Feedback content. | Generated email fixtures contain none of the prohibited data. |

## 12. Product Intelligence

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-INT-001 | PD-009 | Authorized workspace actors MUST be able to filter and aggregate Feedback by Project, type, status, time, and available approved Context. | Each supported dimension changes results within the authorized scope. |
| FR-INT-002 | PD-003, PD-009 | Authorized actors MUST be able to examine repeated Feedback associated with the same Reporter when approved attribution exists. | Linked Reporter results include only legitimately associated Feedback in the same Workspace. |
| FR-INT-003 | PD-009 | Authorized actors MUST be able to create and manage workspace-owned Themes and associate Feedback with them. | Theme membership is attributable and source Feedback remains unchanged. |
| FR-INT-004 | PD-009 | Authorized actors MUST be able to record explicit relationships between Feedback items in the same Workspace. | A cross-workspace relationship is rejected; each accepted relationship retains author and time. |
| FR-INT-005 | PD-009 | Product Intelligence MUST support comparison of counts and patterns across time, application version, screen/page, feature, and other approved Context when present. | A controlled dataset produces the expected grouped and time-ordered results. |
| FR-INT-006 | PD-009 | Derived classifications MUST remain distinguishable from Reporter source content and submitted Context. | Editing or deleting a derived theme does not modify source data. |
| FR-INT-007 | PD-009 | Every derived classification or relationship MUST retain its source or author and creation time. | Results expose provenance to authorized workspace actors. |
| FR-INT-008 | PD-002, PD-009 | Search, grouping, relationships, themes, and aggregates MUST enforce Workspace and permitted Project scope. | Cross-workspace and unassigned-project intelligence tests return no protected data. |
| FR-INT-009 | PD-009, PD-012 | Soft-deleted Feedback MUST be excluded from ordinary Product Intelligence results. | The same query ceases to include an item after soft deletion. |
| FR-INT-010 | PD-009 | MVP compliance MUST NOT depend on automated or AI classification. | All required intelligence acceptance scenarios pass with accountable structured and manual classifications. |

## 13. Privacy, Deletion, Security, and Consistency

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-PRIV-001 | PD-003, PD-009 | The service MUST disclose requested Reporter, Context, and diagnostic data, its purpose, and intended audience before collection. | Intake review and relevant policy text enumerate every collected category. |
| FR-PRIV-002 | PD-012 | An approved deletion operation MUST anonymize Reporter attribution associated with the Feedback and soft-delete the Feedback. | Ordinary views cannot identify the Reporter or retrieve the item after completion. |
| FR-PRIV-003 | PD-012 | Soft-deleted Feedback MUST be absent from ordinary Reporter, maintainer, notification, search, and Product Intelligence views. | Each ordinary retrieval path omits the item. |
| FR-PRIV-004 | PD-012 | Soft deletion MUST preserve a minimal auditable record until the approved purge point. | Authorized audit can prove the deletion action without exposing removed Reporter content beyond policy. |
| FR-PRIV-005 | PD-012 | Anonymization MUST remove or irreversibly detach direct Reporter identifiers from the soft-deleted Feedback according to policy. | Searches by former contact or external identifier no longer return the Feedback. |
| FR-PRIV-006 | PD-012 | Retention and purge MUST be applied independently to source Feedback, identifiers, Messages, Internal Notes, Attachments, notifications, lifecycle events, exceptional-access audit, and backups. | A policy test for each data class reaches its specified retention outcome. |
| NFR-SEC-001 | PD-002 | Privileged credentials and Access Proofs MUST remain outside unauthorised public outputs and logs. | Response and log inspection finds no such secrets. |
| NFR-SEC-002 | PD-002 | All protected reads, writes, searches, aggregates, attachment access, and notification access MUST enforce scope at a trusted boundary. | Tampered public identifiers cannot expand the authorized scope. |
| NFR-SEC-003 | PD-002 | Public requests MUST NOT assign Workspace, Project ownership, authorization, lifecycle status, trusted Reporter identity, or storage location. | Each forged field is ignored or rejected and no protected state is changed. |
| NFR-SEC-004 | PD-001 | Public intake and accountless retrieval MUST apply approved bounded anti-abuse controls. | Requests beyond each approved bound are rejected without protected-data disclosure. |
| NFR-SEC-005 | PD-003, PD-007 | Logs MUST NOT contain Attachment content, Access Proofs, privileged credentials, Internal Notes, or unapproved Reporter and Feedback content. | Representative log inspection contains only allowed redacted fields. |
| NFR-SEC-006 | PD-002 | Public and unauthorized errors MUST NOT expose internal identifiers, existence across scopes, stack details, or credentials. | Error cases return safe outcomes with indistinguishable cross-scope disclosure. |
| NFR-CON-001 | PD-001, PD-010 | Success MUST imply durable Feedback ownership, source content, initial lifecycle state, confirmation reference, and every accepted Attachment association. | Immediately retrieving after success returns the complete accepted result. |
| NFR-CON-002 | PD-001 | Retrying one logical accepted operation MUST NOT create duplicate Feedback, Message, transition, deletion request, or Attachment association. | Repeating a request with the same logical-operation identity produces one domain effect. |
| NFR-CON-003 | PD-001 | A failed operation MUST NOT be presented as accepted. | Every simulated failure lacks a success outcome and preserves invariants. |
| NFR-CON-004 | PD-004 | Domain history MUST remain ordered and attributable despite retry or notification failure. | Controlled concurrent and retry scenarios produce one coherent ordered history. |

`OPEN-RET-001`: concrete retention periods, purge timing, restoration authority,
and backup-expiry behavior are not yet supplied.

`OPEN-ABUSE-001`: quantitative intake, retrieval, messaging, and notification
anti-abuse bounds are not yet supplied.

## 14. Accessibility, Localization, and Evolvability

| ID | Source | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| NFR-UX-001 | PD-015 | Public intake, Reporter follow-up, workspace operation, validation, notifications, and errors MUST be available in French and English. | Each user-facing MVP flow and notification template completes in both languages. |
| NFR-UX-002 | PD-015 | Changing language MUST preserve safe, unsent user input. | Switching language retains entered non-secret content and selected project context. |
| NFR-UX-003 | PD-001 | All controls, state changes, errors, and conversation authorship MUST be programmatically labelled. | Accessibility inspection exposes a meaningful accessible name and state. |
| NFR-UX-004 | PD-001 | Public, Reporter, and workspace workflows MUST be operable by keyboard and assistive technology. | Each core use case completes without pointer-only interaction. |
| NFR-UX-005 | PD-004 | Lifecycle state and notification meaning MUST NOT rely on color alone. | Text or programmatic state distinguishes every lifecycle and delivery outcome. |
| NFR-EVO-001 | PD-001 | Core behavior and source schemas MUST NOT depend on WiseMoney-specific rules. | A second project passes the same core use cases with different guidance and context. |
| NFR-EVO-002 | PD-002 | Workspace isolation MUST be testable with at least two Workspaces before external onboarding. | A complete cross-workspace isolation suite passes for every protected data type. |
| NFR-EVO-003 | PD-008, PD-009 | Project configuration MUST NOT execute arbitrary customer code. | Configuration containing executable behavior is rejected. |
| NFR-EVO-004 | PD-016 | Commercial or complex-team concepts MUST NOT be required for core Workspace ownership, feedback work, or Product Intelligence. | Core use cases complete with no billing, plan, invitation, or custom-role record. |
| NFR-EVO-005 | PD-003 | Reporter attribution MUST remain independent of the workspace-actor authentication mechanism. | Changing an administrative authentication mechanism does not change Reporter meaning or ownership. |

`OPEN-SLO-001`: quantitative availability, latency, capacity, viewport, and
notification-delivery objectives are not yet supplied.

## 15. Error Outcomes

| ID | Condition | Required outcome |
| --- | --- | --- |
| ERR-001 | Current or historical project slug cannot be resolved | Reject intake; disclose no other Project; create nothing. |
| ERR-002 | Project is inactive | Reject new intake; preserve historical data. |
| ERR-003 | Slug rename collides with a current or historical slug | Reject rename; preserve all existing routes. |
| ERR-004 | Feedback violates type or Context rules | Return actionable field outcomes; create nothing. |
| ERR-005 | Reporter identity or Context assertion is untrusted | Treat it as unverified or reject the assertion; never elevate trust. |
| ERR-006 | Accountless Access Proof is invalid, expired, or revoked | Return no protected Feedback data. |
| ERR-007 | Request violates Workspace, Project, role, or audience scope | Reject without disclosing scoped data or existence. |
| ERR-008 | Lifecycle transition is invalid | Reject transition; preserve current state and history. |
| ERR-009 | Attachment violates policy | Apply the approved atomicity policy; never mark the rejected evidence accepted. |
| ERR-010 | Persistence fails before intake acceptance | Do not confirm; remove request-owned staged data. |
| ERR-011 | Duplicate logical operation | Return the original result or a deterministic duplicate outcome with one domain effect. |
| ERR-012 | Notification delivery fails | Preserve the domain event; record a non-success delivery outcome. |
| ERR-013 | Exceptional operator grant is missing or outside scope/time | Reject content access and record the denied attempt. |
| ERR-014 | Dependency is unavailable | Return a safe retryable outcome when retry can succeed without duplicating effects. |

## 16. Remaining Approval Blockers

The following inputs are still required before architecture comparison:

1. `OPEN-ATT-001` - attachment limits, validation, metadata, atomicity, and
   retention.
2. `OPEN-RET-001` - retention, irreversible purge, restoration, and backup expiry.
3. `OPEN-OPS-001` - exceptional Platform Operator access approval authority.
4. `OPEN-ABUSE-001` - quantitative anti-abuse bounds.
5. `OPEN-SLO-001` - measurable service and device targets.

`OPEN-ROOT-001` blocks only unapproved root-page behavior. It does not block the
already specified no-catalog rule or direct project routes.
