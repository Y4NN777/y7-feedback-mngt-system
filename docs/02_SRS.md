# Software Requirements Specification - Y7 Feedback

## 1. Status

This SRS is a **provisional derivation** from the accepted direction. It defines
only behavior supported by stated needs. Sections marked OPEN require a product
decision before implementation.

## 2. Domain Vocabulary

- **Workspace** - ownership and isolation boundary for one customer of the
  feedback service. Y7 Labs is the first workspace.
- **Project** - target for which a workspace collects feedback. WiseMoney is the
  first project.
- **Reporter** - actor providing feedback; this term carries no authentication
  or anonymity guarantee.
- **Feedback** - structured information submitted to one project.
- **Attachment** - optional evidence associated with feedback.
- **Authorized workspace actor** - actor permitted to configure or retrieve data
  within a workspace. Exact roles are OPEN.

## 3. Core Functional Requirements

### Workspace and project ownership

- **FR-OWN-001** Every project MUST belong to exactly one workspace.
- **FR-OWN-002** Every feedback item MUST belong to exactly one project and,
  through that project, exactly one workspace.
- **FR-OWN-003** The workspace and project association of accepted feedback MUST
  NOT change.
- **FR-OWN-004** An authorized actor MUST NOT access feedback or attachments owned
  by another workspace.
- **FR-OWN-005** Adding a workspace or project MUST NOT require a separate copy of
  the feedback service.

### Public project resolution

- **FR-PROJ-001** The service MUST resolve a public project slug to one active
  project.
- **FR-PROJ-002** The service MUST display the resolved project identity before a
  reporter submits feedback.
- **FR-PROJ-003** The service MUST reject unknown, inactive, ambiguous, or invalid
  project slugs.
- **FR-PROJ-004** The service MUST derive workspace and project ownership from its
  trusted project registry, not from independently supplied public identifiers.
- **FR-PROJ-005** Public project slug uniqueness and future custom-domain behavior
  are OPEN architectural/product decisions; `/wisemoney` MUST remain a valid
  initial route.

### Feedback capture

- **FR-FDB-001** The service MUST allow a reporter to submit feedback to a
  resolved active project.
- **FR-FDB-002** Every feedback item MUST have one type allowed by the project.
- **FR-FDB-003** The initial product MUST support review, suggestion, and bug
  report experiences unless the PRD scope is revised.
- **FR-FDB-004** Each feedback type MUST define its required information and
  reject incomplete content.
- **FR-FDB-005** The reporter MUST be able to review the target project, feedback
  type, entered content, and any disclosed diagnostic context before sending.
- **FR-FDB-006** The service MUST distinguish accepted, rejected, and retryable
  outcomes.
- **FR-FDB-007** The service MUST issue a unique confirmation reference only after
  durable acceptance.
- **FR-FDB-008** A confirmation reference MUST NOT imply status tracking unless a
  tracking capability is explicitly approved.

### Reporter identity - OPEN

- **OPEN-ID-001** Supported identity modes are not yet defined. Candidate modes
  include no persisted identity, optional contact, verified contact, or an
  authenticated account.
- **OPEN-ID-002** The authority that chooses identity policy (platform,
  workspace, or project) is not yet defined.
- **OPEN-ID-003** Follow-up, tracking, amendment, export, and deletion behavior
  cannot be specified until identity policy is decided.
- **FR-ID-001** Regardless of the selected mode, the service MUST disclose which
  identity/contact data is requested and why before submission.
- **FR-ID-002** The service MUST NOT describe a reporter as anonymous when it
  collects data capable of identifying or contacting that reporter.

### Attachments

- **FR-ATT-001** A project MAY allow attachments.
- **FR-ATT-002** Every accepted attachment MUST belong to exactly one feedback
  item and inherit its project and workspace ownership.
- **FR-ATT-003** Public actors MUST NOT list or retrieve stored attachments.
- **FR-ATT-004** The service MUST validate allowed type and size before durable
  acceptance.
- **FR-ATT-005** If feedback acceptance fails, request-owned attachments MUST NOT
  remain as unassociated durable data.
- **OPEN-ATT-001** Allowed formats, file count, byte limits, retention, and malware
  handling require explicit decisions.

### Workspace operation

- **FR-OPS-001** An authorized workspace actor MUST be able to create, activate,
  deactivate, and configure projects belonging to that workspace.
- **FR-OPS-002** An authorized workspace actor MUST be able to retrieve feedback
  for permitted projects.
- **FR-OPS-003** Deactivating a project MUST stop new feedback without deleting
  existing feedback.
- **FR-OPS-004** The initial release MUST provide an explicit operational path for
  UC-05 and UC-06; treating a vendor console as the permanent product behavior is
  not sufficient for the SaaS direction.
- **OPEN-OPS-001** Initial actor roles, authentication, invitations, and whether a
  custom management interface belongs to MVP require product decisions.

## 4. Core Business Rules

- **BR-001** Workspace is the root ownership boundary.
- **BR-002** Project is the public feedback target and always has one workspace.
- **BR-003** Feedback cannot exist without a project.
- **BR-004** Attachment cannot exist without feedback after a request completes.
- **BR-005** Project deactivation affects future intake, not historical ownership.
- **BR-006** Reporter identity is independent from workspace ownership.
- **BR-007** SaaS commercial concepts are not part of the core feedback model.

## 5. System-Wide Requirements

### Security and isolation

- **NFR-SEC-001** Privileged service credentials MUST remain outside public
  clients.
- **NFR-SEC-002** All reads and writes MUST enforce workspace/project scope at a
  trusted boundary.
- **NFR-SEC-003** Public requests MUST NOT assign workspace, project ownership,
  authorization, status, or storage location.
- **NFR-SEC-004** The public intake MUST implement bounded anti-abuse controls.
- **NFR-SEC-005** Logs MUST NOT contain attachment content, secrets, or privileged
  credentials. Logging of reporter/content fields remains subject to privacy
  decisions and SHOULD default to redaction.
- **NFR-SEC-006** Public errors MUST NOT expose internal credentials, resource
  identifiers, or stack details.

### Consistency

- **NFR-CON-001** A success response MUST imply durable feedback ownership and
  durable association of all accepted attachments.
- **NFR-CON-002** Retrying the same accepted operation MUST NOT create duplicate
  feedback.
- **NFR-CON-003** A failed operation MUST NOT be presented as accepted.

### Accessibility and localization

- **NFR-UX-001** The public intake MUST support French and English.
- **NFR-UX-002** All controls and errors MUST be programmatically labelled.
- **NFR-UX-003** The submission flow MUST be operable by keyboard and assistive
  technology.
- **NFR-UX-004** Changing language SHOULD preserve safe entered content.
- **NFR-UX-005** Quantitative viewport and performance thresholds remain OPEN
  until target-device and service-level expectations are decided.

### Evolvability

- **NFR-EVO-001** Core feedback behavior MUST NOT depend on WiseMoney-specific
  fields or rules.
- **NFR-EVO-002** Workspace isolation MUST be testable with at least two
  workspaces before external SaaS onboarding.
- **NFR-EVO-003** Project configuration MUST NOT execute arbitrary client code.
- **NFR-EVO-004** Billing, plans, and teams MAY be added around workspace
  ownership without changing existing feedback ownership.

## 6. Error Contract

| ID | Condition | Required outcome |
| --- | --- | --- |
| ERR-001 | Project cannot be uniquely resolved | Reject; create nothing. |
| ERR-002 | Project is inactive | Reject new intake; preserve history. |
| ERR-003 | Feedback violates its type rules | Return actionable validation errors. |
| ERR-004 | Request violates workspace/project scope | Reject without disclosing scoped data. |
| ERR-005 | Abuse controls reject request | Reject; create nothing. |
| ERR-006 | Attachment violates policy | Reject attachment or request according to an OPEN atomicity policy. |
| ERR-007 | Persistence fails | Do not confirm acceptance; clean request-owned data. |
| ERR-008 | Duplicate operation | Return original result or a deterministic duplicate outcome. |
| ERR-009 | Dependency unavailable | Return a safe retryable outcome. |

## 7. Traceability

| Product capability | Requirements | Required proof |
| --- | --- | --- |
| Resolve `/wisemoney` | FR-PROJ-001..005 | Route and registry tests |
| Capture structured feedback | FR-FDB-001..008 | Schema, API, and E2E tests |
| Preserve ownership | FR-OWN-001..005 | Cross-workspace isolation tests |
| Associate evidence | FR-ATT-001..005 | File policy and cleanup tests |
| Operate projects | FR-OPS-001..004 | Authorization and lifecycle tests |
| Evolve beyond Y7 Labs | NFR-EVO-001..004 | Second-workspace acceptance scenario |

## 8. Approval Blockers

This SRS must not be marked final until the following are answered:

1. Reporter identity modes and policy ownership.
2. Reporter follow-up and data-right behavior.
3. Initial workspace actor authentication and permissions.
4. Attachment and retention policies.
5. Feedback-type configuration boundaries.
6. Public slug uniqueness and namespace strategy for SaaS customers.
7. Numeric performance, availability, and abuse-control targets.
