# Core Contract - Y7 Feedback

## 1. Purpose

This contract states the observable promises and prohibitions that every Y7
Feedback implementation must preserve. It defines actors, accepted operations,
outputs, invariants, permissions, lifecycle, and semantic events. It is not an
API, database, component, deployment, or vendor specification.

## 2. Actors and Authority

| Actor | Ordinary authority | Explicit limits |
| --- | --- | --- |
| Reporter | Submit Feedback; use valid accountless access; view reporter-visible data; clarify; update permitted information; request deletion. | Cannot assign ownership or status, see Internal Notes, enumerate other Feedback, or gain workspace access. |
| Client Application | Supply declared Context or assert an application identity through an approved trusted interaction. | Does not become a workspace actor and cannot grant ownership or authorization through public fields. |
| Workspace Owner | Manage Projects and their slugs; assign Project Maintainers; work with all Feedback in the Workspace; authorize deletion according to policy. | Has no authority in another Workspace. |
| Project Maintainer | Work with Feedback, Attachments, Messages, Internal Notes, lifecycle, and Product Intelligence for assigned Projects. | Has no authority in unassigned Projects or another Workspace. |
| Platform Operator | Operate and diagnose the shared platform using operational data. | Has no standing right to Workspace business content; exceptional content access requires a grant. |

Reporter attribution is not administrative authentication. A person may act as
a Reporter and as a workspace actor through different, independently authorized
interactions.

## 3. Observable Operations

### 3.1 Project resolution

- **Input:** a current or historical public slug.
- **Success:** one active Project identity and its trusted Workspace scope; a
  historical slug redirects to that Project's current canonical slug.
- **Failure:** an unavailable result that creates nothing and reveals no other
  Project.

### 3.2 Feedback intake

- **Input:** a resolved active Project, enabled feedback type, valid source
  content, optional declared Reporter information, optional Context, optional
  Attachments, and logical-operation identity.
- **Success:** an accepted Feedback in `received`, durable source ownership,
  accepted evidence associations, unique confirmation reference, accountless
  Access Proof, and accurate confirmation.
- **Failure:** actionable rejection or safe retryable outcome, no false
  confirmation, and no durable orphaned request evidence.

### 3.3 Accountless feedback access

- **Input:** confirmation reference plus valid Access Proof, or another approved
  identity proof associated with the Reporter.
- **Success:** only the source, current state, reporter-visible history,
  reporter-visible Messages, permitted Attachments, and allowed actions for that
  Feedback.
- **Failure:** no protected content and no disclosure of sibling Feedback or
  Workspace-internal data.

### 3.4 Feedback work

- **Input:** an authorized Workspace Owner or assigned Project Maintainer action
  to respond, request information, add an Internal Note, transition state,
  resolve, close, reopen, relate, classify, or delete.
- **Success:** one attributable domain change within the authorized scope, an
  updated ordered history, and relevant notification requests.
- **Failure:** no partial unauthorized change and no cross-scope disclosure.

### 3.5 Reporter continuation

- **Input:** authorized clarification, permitted source revision, or deletion
  request.
- **Success:** an attributable addition or revision that preserves the original
  source; or a recorded deletion request.
- **Failure:** no change outside the authorized Feedback or permitted fields.

### 3.6 Product Intelligence

- **Input:** authorized scope, filters, grouping dimensions, theme operation, or
  Feedback relationship.
- **Success:** results derived only from permitted non-soft-deleted Workspace data
  with source and derived information distinguishable.
- **Failure:** no result, aggregate, identifier, or existence disclosure from an
  unauthorized scope.

## 4. Ownership Invariants

- **INV-OWN-001** Every Project belongs to exactly one Workspace.
- **INV-OWN-002** Every Reporter belongs to exactly one Workspace.
- **INV-OWN-003** Every Feedback belongs to exactly one Project and one Reporter
  in the same Workspace.
- **INV-OWN-004** Every Message, Internal Note, Attachment, Context snapshot,
  lifecycle event, notification record, theme association, and Feedback
  relationship belongs through one Feedback to its Project and Workspace.
- **INV-OWN-005** Ordinary updates never reassign accepted Workspace or Project
  ownership.
- **INV-OWN-006** Reporter matching, Feedback relationships, Product Intelligence,
  and access never cross Workspace boundaries.

Reporter attribution may be linked, corrected, merged, or anonymized only
through a controlled, attributable operation inside the same Workspace. This is
not Workspace or Project ownership transfer. An anonymized attribution conveys
no continuing real-person identity.

## 5. Project Route Contract

- **INV-ROUTE-001** A current or historical slug is reserved globally for one
  Project and is never reassigned to another Project.
- The current slug is the canonical public route.
- Changing the current slug preserves all previous slugs as redirects to the
  same Project's current route.
- Redirects preserve Project and Workspace identity and cannot form a route to a
  different Project.
- Only the current route of an active Project accepts new Feedback.
- Deactivation stops intake without deleting or moving historical data.
- `/wisemoney` identifies the initial WiseMoney Project.
- `/` does not automatically enumerate Projects. No additional root experience
  is guaranteed until the pending recommendation is approved.

## 6. Reporter Attribution Contract

- **INV-REP-001** Reporter means the Workspace-scoped source or subject of
  Feedback, never an implied Y7 Feedback authentication account.
- A Reporter may have no identifier, a voluntary contact, an external identifier,
  or a Client Application identity assertion.
- Every identifier retains its kind, application or issuer, scope, value, and
  trust state.
- `external_user_id` equality has meaning only inside the same Workspace and
  application/issuer scope.
- Publicly supplied identity or Context is unverified unless an approved trusted
  interaction establishes otherwise.
- Unidentified submissions and unverified contacts are not silently merged.
- Linking, correcting, merging, or anonymizing attribution preserves the prior
  attribution, resulting attribution, reason, actor or process, and time.
- Y7 Feedback does not use fingerprinting or unrelated behavioral observation to
  create Reporter continuity.
- Collected identity and contact data is disclosed with purpose, audience,
  optionality, and retention policy before collection.

## 7. Reference and Access Contract

- **INV-ACCESS-001** The confirmation reference is a stable Feedback locator, not
  sufficient authorization to protected content.
- Accountless access requires a Feedback-specific Access Proof or another
  approved proof associated with the Reporter.
- Feedback-specific proof grants no implicit access to other Feedback attributed
  to the same Reporter.
- Proof can be revoked without changing the confirmation reference, ownership,
  source content, or history.
- An authorized Reporter sees only reporter-visible content and actions.
- Internal Notes, exceptional-access audit, maintainer-only classification data,
  and unrelated Feedback never enter the Reporter view.
- Access failure does not reveal whether a guessed reference exists in another
  scope.

## 8. Source, Type, and Context Contract

- **INV-SOURCE-001** The original accepted source remains distinguishable from
  every later revision, Message, Internal Note, lifecycle event, and derived
  classification.
- `bug`, `suggestion`, and `review` retain the meanings established by the PRD.
- An active Project enables at least one system type and may add guidance or
  disable inapplicable types; it does not redefine their core meaning.
- A source revision records prior value, new value, author, time, and reason or
  triggering action. It never masquerades as the original submission.
- **INV-CTX-001** Each Context value retains its source, purpose, and trust state.
- Context is bounded and declarative. It cannot execute client code or accept
  undeclared unbounded data.
- Context presented as a Client Application assertion through public input
  remains untrusted.
- Source content and submitted Context remain separate from themes, trends, and
  other Product Intelligence.

## 9. Acceptance and Consistency Contract

- **INV-ACCEPT-001** A success outcome means that Feedback ownership, source,
  initial lifecycle event, confirmation reference, and every accepted Attachment
  association are durable.
- A confirmation reference and usable Access Proof are issued only after
  acceptance.
- A rejected, interrupted, or uncommitted operation is never presented as
  accepted.
- Retrying one logical operation creates at most one Feedback, Message,
  transition, deletion request, or Attachment association.
- Request-owned Attachment data is removed when its Feedback cannot be accepted.
- Notification delivery is not part of the transaction that accepts the domain
  change; delivery failure cannot undo accepted Feedback or history.
- Ordered domain history remains coherent after retry, concurrency, or
  notification failure.

Attachment atomicity remains governed by `OPEN-ATT-001`; until approved, the
contract does not choose between rejecting an entire initial submission and
explicitly allowing submission without rejected evidence.

## 10. Conversation and Visibility Contract

- **INV-VIS-001** Every reporter-visible Message belongs to one Feedback and has
  an author and creation time.
- **INV-VIS-002** Every Internal Note belongs to one Feedback and is visible only
  to authorized Workspace actors.
- A reporter-visible Message and an Internal Note are different records; one is
  never silently converted into the other.
- A maintainer information request is reporter-visible and causes the Feedback
  to enter `awaiting_reporter`.
- An accepted Reporter clarification is recorded with Reporter authorship.
- A Reporter clarification while awaiting information returns the Feedback to
  `under_review`.
- Reporter outputs and notifications reveal neither Internal Note content nor
  its existence.

## 11. Feedback Lifecycle Contract

### 11.1 State meanings

| State | Meaning |
| --- | --- |
| `received` | Accepted and awaiting active maintainer treatment. |
| `under_review` | An authorized maintainer is understanding, analyzing, or acting. |
| `awaiting_reporter` | A visible information request is waiting for Reporter clarification. |
| `resolved` | A maintainer recorded a substantive reporter-visible conclusion and no current treatment action is expected. |
| `closed` | No active treatment or exchange is expected; data remains preserved. |

### 11.2 Transition guarantees

- New Feedback starts in `received`.
- A Project Maintainer or Workspace Owner controls treatment state.
- `awaiting_reporter` requires an associated reporter-visible information
  request.
- `resolved` requires an associated reporter-visible resolution statement.
- `resolved` or `closed` can be reopened into `under_review` by an assigned
  Project Maintainer or Workspace Owner with a reason.
- **INV-LIFE-001** Every transition retains previous state, next state, actor,
  time, and reason or triggering action.
- **INV-LIFE-002** Closing, deactivating a Project, anonymizing, and soft-deleting
  are distinct operations with distinct meanings.

## 12. Attachment Contract

- **INV-ATT-001** Every accepted Attachment belongs to exactly one Feedback.
- An Attachment may identify the source submission, visible Message, or Internal
  Note through which it was added without changing ownership.
- Attachments are private even when intake is public.
- An authorized Reporter may retrieve only Attachments permitted by Feedback
  access and conversation audience.
- Workspace actors retrieve Attachments only within role and Project scope.
- Declared type, actual content, size, count, and security policy are validated
  before acceptance.
- Rejected or failed request evidence is not retained as an unassociated durable
  object.
- Metadata collection, visibility, anonymization, retention, and deletion follow
  the approved Attachment policy.

Formats, limits, security depth, metadata treatment, atomicity, later-message
evidence behavior, and retention are intentionally unresolved in
`OPEN-ATT-001`.

## 13. Role and Exceptional Access Contract

- **INV-AUTH-001** A Workspace Owner acts only in its Workspace.
- **INV-AUTH-002** A Project Maintainer acts only on assigned Projects.
- Workspace Owner assigns and removes Project Maintainers.
- Removing an assignment ends future Maintainer authorization without deleting
  actions already recorded in history.
- Platform Operator's ordinary authority excludes Feedback content, Reporter
  identifiers, Messages, Internal Notes, and Attachments.
- **INV-BREAKGLASS-001** Exceptional operator access exists only through an
  explicit grant containing authorizer, operator, purpose, Workspace scope,
  allowed content scope, start, expiry, and revocation state.
- Every exceptional grant, use, denied attempt, and revocation is auditable.
- Expired, revoked, or out-of-scope exceptional access is rejected.

The authority allowed to approve a grant remains `OPEN-OPS-001`; no
implementation may self-authorize Platform Operator access by default.

## 14. Notification Contract

- Relevant events create in-product notification records in the recipient's
  authorized scope.
- Email delivery is requested only when an eligible address exists and its
  approved purpose permits use.
- Reporter events include acceptance, visible maintainer response, information
  request, reporter-visible state change, and deletion outcome.
- Maintainer events include new Feedback in an assigned Project, Reporter
  clarification, and deletion request.
- **INV-NOTIFY-001** A notification inherits the scope and audience of its source
  event.
- Reporter notification contains no Internal Note, Access Proof, or unnecessary
  sensitive source content.
- Delivery success, non-success, and retry remain distinguishable from the
  underlying domain action.

## 15. Product Intelligence Contract

- Product Intelligence uses only authorized, non-soft-deleted Workspace data.
- Feedback can be filtered and aggregated by Project, type, status, time,
  legitimate Reporter attribution, and available approved Context.
- A Theme is Workspace-owned derived classification with an author or source and
  creation time.
- A Feedback relationship joins Feedback only within one Workspace and retains
  author, time, and declared meaning.
- **INV-INTEL-001** Theme membership, relationships, counts, and trends never
  rewrite source Feedback or submitted Context.
- **INV-INTEL-002** Derived analysis retains provenance and remains identifiable
  as derived.
- Removing or correcting derived analysis leaves the source and its history
  intact.
- MVP guarantees do not depend on automated or AI classification.

## 16. Anonymization, Soft Deletion, and Retention Contract

- A Reporter can request deletion through authorized Feedback access.
- A deletion request is a recorded request, not a false promise of immediate
  irreversible purge.
- An approved deletion operation anonymizes direct Reporter attribution for the
  Feedback and marks the Feedback soft-deleted.
- **INV-DELETE-001** Soft-deleted Feedback is absent from ordinary Reporter,
  maintainer, search, notification, and Product Intelligence views.
- A minimal deletion audit remains until the approved purge point.
- Searching by former contact or external identifier does not return anonymized
  Feedback.
- Retention and purge rules apply explicitly to each data class, including
  backups; absence of a supplied duration is not indefinite-retention approval.

Concrete periods, restoration authority, purge timing, and backup expiry remain
`OPEN-RET-001`.

## 17. Semantic Events

These events describe observable domain facts and required audit evidence. They
do not require an event bus, event sourcing, or any transport technology.

| Event | Required meaning and evidence |
| --- | --- |
| `ProjectSlugChanged` | Project, Workspace, previous slug, current slug, actor, time. |
| `FeedbackAccepted` | Feedback, Project, Workspace, Reporter, type, reference, `received`, time. |
| `ReporterIdentifierAssociated` | Reporter, identifier scope and trust state, source, actor/asserting client, time. |
| `FeedbackSourceRevised` | Feedback, affected field, prior and new values, Reporter, reason, time. |
| `ReporterMessageAdded` | Feedback, Reporter author, reporter-visible audience, time. |
| `MaintainerMessageAdded` | Feedback, workspace actor author, reporter-visible audience, time. |
| `InternalNoteAdded` | Feedback, workspace actor author, internal audience, time. |
| `InformationRequested` | Feedback, visible request, maintainer, resulting state, time. |
| `FeedbackStatusChanged` | Feedback, previous and next state, actor, reason/trigger, time. |
| `FeedbackReopened` | Feedback, prior terminal state, actor, reason, `under_review`, time. |
| `AttachmentAccepted` | Attachment, Feedback, source entry if any, policy outcome, time. |
| `ThemeAssociated` | Theme, Feedback, author/source, time. |
| `FeedbackRelated` | Both same-Workspace Feedback items, declared meaning, author, time. |
| `DeletionRequested` | Feedback, authorized requester, time. |
| `FeedbackAnonymized` | Feedback, policy, actor/process, time. |
| `FeedbackSoftDeleted` | Feedback, actor/process, reason, time, retention rule reference. |
| `NotificationRequested` | Source event, recipient scope, channel, time. |
| `NotificationDeliveryRecorded` | Notification, channel, outcome, time. |
| `ExceptionalAccessGranted` | Authorizer, operator, purpose, scope, start, expiry, time. |
| `ExceptionalAccessUsed` | Grant, operator, accessed scope, purpose, time. |
| `ExceptionalAccessRevoked` | Grant, revoker, reason, time. |

## 18. User Experience Contract

- Public intake, Reporter follow-up, workspace operation, validation outcomes,
  in-product notifications, email notifications, and errors are available in
  French and English.
- Changing language preserves safe unsent input and the resolved Project context.
- Controls, errors, authorship, and lifecycle state expose programmatic labels
  and do not communicate meaning through color alone.
- Core Reporter and workspace workflows remain operable by keyboard and
  assistive technology.
- Quantitative viewport and performance behavior is not guaranteed until
  `OPEN-SLO-001` is approved.

## 19. Evolvability Contract

- Core feedback behavior and source meaning contain no WiseMoney-specific rule.
- Additional Projects and Workspaces use the same ownership, Reporter,
  conversation, lifecycle, Attachment, notification, and Product Intelligence
  contracts.
- Introducing an external customer Workspace does not require a product copy or
  change the ownership of existing data.
- Billing, plans, quotas, invitations, custom roles, custom domains, and
  marketplace concepts are not prerequisites for the core behavior.
- Project configuration remains declarative and cannot execute arbitrary
  customer code.
- Reporter attribution remains independent of the chosen workspace-actor
  authentication mechanism.

## 20. Explicit Non-Guarantees

This contract does not guarantee:

- a Y7 Feedback account for Reporters;
- access to all Feedback linked to one Reporter through one Feedback Access Proof;
- public Feedback, public reviews, voting, or community discussion;
- real-time chat unrelated to a Feedback item;
- automatic prioritization, classification, or resolution;
- a structured numeric Review rating;
- billing, plans, quotas, custom domains, complex teams, or a marketplace;
- any framework, database, object store, identity provider, email provider,
  hosting platform, CDN, region, process boundary, or deployment topology;
- any root `/` behavior beyond not automatically enumerating Projects;
- attachment, retention, or service-level values that remain explicitly open.
