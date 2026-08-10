# Architecture Decision Records - Y7 Feedback

## 1. ADR Index

| ADR | Decision | Status |
| --- | --- | --- |
| ADR-001 | Managed Appwrite modular backend | Accepted |
| ADR-002 | Trusted Functions as the domain boundary | Accepted |
| ADR-003 | Server-authoritative offline state model | Accepted |
| ADR-004 | Feedback-specific accountless capability | Accepted |
| ADR-005 | Private staged Attachment saga | Accepted with fitness condition |
| ADR-006 | Transactional domain commits and idempotency | Accepted |
| ADR-007 | Stored notification feed and durable email outbox | Accepted |
| ADR-008 | Application-owned privacy-preserving anti-abuse | Accepted |
| ADR-009 | Scheduled purge and complete independent recovery set | Accepted |
| ADR-010 | Independently approved exceptional-access control plane | Accepted |
| ADR-011 | SLO-driven observability and evidence-based capacity | Accepted |
| ADR-012 | Vercel hosts the Vite PWA | Accepted |

An ADR is subordinate to `01_PRD.md` through `06_DECISION_TRACEABILITY.md`.
“Accepted” means selected for the proposed architecture; it does not claim that
implementation or production fitness has already been proven.

## ADR-001 - Managed Appwrite Modular Backend

**Status:** Accepted

**Decision drivers:** validated Appwrite constraint; NFR-EVO-001..004;
NFR-SLO-001, 005..011; NFR-REC-001..003.

### Context

Y7 Feedback needs authentication, trusted server execution, transactional
business records, private file storage, scheduled work, event-driven work, and
authenticated live invalidation. The product does not justify independent
service ownership or a Kubernetes operating model.

### Decision

Use one managed Appwrite Cloud project per environment. Allocate the backend as
a modular application sharing domain policy across synchronous API Functions,
async workers, and scheduled maintenance Functions. Use Appwrite Auth,
TablesDB/Transactions, private Storage, and Realtime within that boundary.

Use Vercel as the static origin for the Vite PWA, under the controls recorded in
ADR-012.

### Consequences

- The MVP has one operational backend and no distributed-domain protocol.
- Managed Appwrite reduces infrastructure work but makes region, plan limits,
  runtime quotas, and service recovery evidence production fitness concerns.
- A later self-hosted Appwrite deployment remains possible if a demonstrated
  regulatory or operational constraint requires it.
- Environment isolation is achieved with separate projects rather than tenant
  flags inside one development/production data set.

### Alternatives not selected

- **Microservices:** adds failure modes and ownership boundaries unsupported by
  current scale or responsibilities.
- **Replace Appwrite with another BaaS/backend:** contradicts the validated stack
  without a demonstrated technical impossibility.
- **Self-host Appwrite for MVP:** adds backup, patching, capacity, and availability
  duties before a need has been demonstrated.

## ADR-002 - Trusted Functions as the Domain Boundary

**Status:** Accepted

**Decision drivers:** FR-OWN-001..007; FR-ACC-*; FR-OPS-*; NFR-SEC-001..006;
INV-OWN-*; INV-AUTH-*.

### Context

Appwrite permissions protect rows and files for client sessions, while Server
SDK credentials intentionally bypass those permissions. Reporter access also
uses a domain proof rather than an Appwrite Auth account. Direct browser writes
would spread ownership, role, audience, idempotency, and deletion rules across
untrusted clients.

### Decision

Route all domain reads and mutations through trusted Appwrite Functions. Allow
direct browser use only for Appwrite Auth session handling and authenticated
Realtime subscriptions. Functions derive Workspace/Project scope from stored
ownership, map authenticated principals to fixed domain responsibilities, and
validate accountless proof themselves.

Store Workspace roles and Project Maintainer assignments as domain records in
TablesDB. Use Appwrite resource permissions as defense in depth, not as the only
authorization layer. Give Function groups distinct least-privilege API keys.

### Consequences

- Authorization is consistent for online, offline replay, aggregation, file
  access, and exceptional access.
- Reporter semantics remain independent of Appwrite Auth.
- Functions become a critical latency and availability path and must be measured
  against the API SLO.
- Production console/API-key access must be tightly controlled because it can
  bypass application policy.

### Alternatives not selected

- **Direct TablesDB client CRUD:** cannot safely express all domain invariants
  and accountless authorization.
- **Appwrite Teams as the domain model:** couples fixed product responsibilities
  to provider grouping and does not solve Reporter proof or exceptional access.
- **A second custom API platform:** duplicates an Appwrite Function capability
  without an established need.

## ADR-003 - Server-Authoritative Offline State Model

**Status:** Accepted

**Decision drivers:** PWA/offline-first constraint; FR-FDB-007..009;
NFR-CON-001..004; NFR-SEC-001; notification and lifecycle consistency.

### Context

TanStack Query can pause and retry mutations, but Y7 Feedback must also preserve
drafts, binary evidence, dependency ordering, proof/session changes,
idempotency, rate-limit retry, and explicit conflict outcomes across browser
restarts. Browser Background Sync is not universally available.

### Decision

Use:

- React for transient UI state;
- TanStack Query for in-memory server projections, invalidation, and refetch;
- selected TanStack Query persistence in IndexedDB as disposable scoped cache;
- a separate versioned IndexedDB draft and durable command outbox;
- Cache Storage only for versioned public application-shell assets;
- an app-open/focus/reconnect sync coordinator, with Background Sync only as a
  progressive enhancement.

Appwrite is always the source of truth. Queue append-oriented commands; require
live confirmation for authority-changing or conflict-sensitive operations.

### Consequences

- Offline work is preserved without a false “submitted” state.
- Local data must be partitioned and erased on logout, proof revocation,
  soft-delete visibility, assignment removal, and incompatible upgrades.
- Attachment persistence depends on browser quota; the product must preserve the
  text draft and disclose when file reselection is required.
- Queue schemas and migrations are application responsibilities even though no
  server database migration is defined in this pass.

### Alternatives not selected

- **TanStack mutation cache as the only durable queue:** insufficient ownership
  for binary dependencies and long-lived versioned commands.
- **Service worker as the only synchronizer:** its lifecycle and browser support
  are not reliable enough.
- **Local-last-write-wins:** violates ordered history and conflict guarantees.
- **Disable offline mutations:** contradicts the selected product direction and
  loses meaningful draft continuity.

## ADR-004 - Feedback-Specific Accountless Capability

**Status:** Accepted

**Decision drivers:** FR-REP-001..009; FR-ACC-001..007; NFR-SEC-001..006;
INV-REP-001; INV-ACCESS-001.

### Context

The reference is a real retrieval capability but cannot be sufficient access,
and a Reporter may have no verified contact or Appwrite account. Giving one
proof access to every item attributed to a Reporter would unnecessarily enlarge
the breach scope.

### Decision

Issue a stable human-usable reference plus an independent high-entropy,
Feedback-specific Access Proof after durable acceptance. Store only a one-way
verifier. Transmit proof outside URL query strings and logs. Permit revocation or
rotation without changing the reference. Do not create an Appwrite Auth user for
the Reporter.

Reporter feed updates use authorized API polling while visible and online,
because Appwrite Realtime requires an authenticated session. Persisting a proof
on a device is opt-in and must be scoped and erasable; memory is the default.

### Consequences

- Reference leakage does not expose content and one proof does not expose sibling
  Feedback.
- Losing proof and lacking an approved identity/contact recovery method can make
  the item unrecoverable to that browser; the confirmation UX must explain how
  to preserve the return material safely.
- Email can contain the non-secret reference but not the Access Proof.
- Polling generates bounded traffic and must cooperate with the 60/minute/IP
  limit.

### Alternatives not selected

- **Reference as bearer secret:** human-scale references are guessable/leakable
  and cannot meet FR-ACC-001.
- **Mandatory Reporter account:** changes the approved Reporter meaning and
  accountless product value.
- **One Reporter-wide capability:** broadens compromise and enables sibling
  enumeration.
- **Anonymous Appwrite user per Reporter:** creates provider identity state that
  is unnecessary for the domain and complicates deletion and linking.

## ADR-005 - Private Staged Attachment Saga

**Status:** Accepted with fitness condition

**Decision drivers:** FR-ATT-001..013; NFR-CON-001..003; NFR-SEC-008;
NFR-SLO-008; INV-ATT-001..003.

### Context

The Storage object and TablesDB records cannot commit in one transaction. Public
direct Storage upload would bypass the validated per-IP file rate limit and
private intake control. Proxying a validated 10 MB file through a Function must
fit the chosen Appwrite Cloud runtime limits.

### Decision

Use a private staging bucket and a manifest identified by `clientOperationId`.
Upload one file per trusted intake request. Apply rate limiting, actual-content
detection/parsing, archive/executable/polyglot rejection, antivirus, integrity
digest, 10 MB/file, and five-file manifest checks before domain commit.

After all files pass, use one TablesDB transaction for Feedback and Attachment
metadata. Files become domain-visible only after commit. Any rejection or failed
commit removes operation-owned staging; a scheduled sweeper reconciles orphans.
All retrieval passes through trusted authorization.

Before implementation, prove that the Appwrite Cloud Function ingress supports
10 MB plus multipart/protocol overhead within the upload SLO. Appwrite's public
documentation does not establish that limit. If the test fails, reopen this ADR
to compare a controlled upload gateway with self-hosted Appwrite. Do not fall
back to a public bucket or unrestricted client upload.

### Consequences

- Logical atomicity is explicit even though binary and row storage differ.
- Appwrite bucket extension/size settings are coarse defense only; trusted
  content inspection decides acceptance.
- Direct file transfer through a Function may add memory/latency pressure; a
  failed fitness test makes the replacement transport a blocking architecture
  decision without changing product behavior.
- Staging requires expiry, cleanup metrics, and reconciliation.

### Alternatives not selected

- **Public bucket:** violates controlled access and enables abuse/storage
  bypass.
- **Trust client MIME/extension:** explicitly forbidden and unsafe.
- **Commit Feedback before file validation:** violates initial submission
  atomicity.
- **Distributed transaction across Storage and TablesDB:** Appwrite offers no
  such primitive; a bounded saga is simpler and observable.

## ADR-006 - Transactional Domain Commits and Idempotency

**Status:** Accepted

**Decision drivers:** FR-FDB-007..009; FR-LIFE-*; FR-NOT-006; NFR-CON-001..004;
INV-ACCEPT-001; INV-LIFE-001.

### Context

Offline replay, network response loss, notification failure, and concurrent
maintainer actions must not create duplicates or incoherent history.

### Decision

Give every logical mutation a client-generated operation ID scoped to its
principal/access and target. In one Appwrite TablesDB transaction, write the
domain change, ordered event/history, in-product notification facts, durable
outbox entry, and idempotency result. Return the original result on safe retry.

Use an expected aggregate version for lifecycle and other controlled mutable
state. Reject a mismatch with a conflict outcome and require refetch; use
append-only identifiers for Messages, Notes, and clarifications.

### Consequences

- Notification delivery can retry independently while its intent cannot be lost.
- Idempotency records require bounded retention long enough to cover client
  replay and outbox lifetime; exact technical retention is set during data-policy
  implementation.
- Transaction size remains bounded by the five-file policy and one aggregate
  action.

### Alternatives not selected

- **At-least-once writes without idempotency:** duplicates feedback and messages.
- **Last-write-wins lifecycle:** discards attributable concurrent work.
- **Event sourcing:** adds replay/projection complexity not required to preserve
  the specified append history.

## ADR-007 - Stored Notification Feed and Durable Email Outbox

**Status:** Accepted

**Decision drivers:** FR-NOT-001..007; NFR-SLO-009..010; INV-NOTIFY-001.

### Context

Notification failure cannot undo a business action. Workspace actors have
Appwrite sessions; Reporters deliberately may not. Appwrite Messaging email
targets are associated with Appwrite users, which does not match the Reporter
model.

### Decision

Create recipient-scoped in-product notification records and email outbox entries
transactionally with the source event. Use Appwrite Realtime only as an
invalidation signal for authenticated actors, followed by a scoped TanStack
Query refetch. Use <=4-second visible/online API polling for an accountless
Reporter view.

Use an async Function and replaceable provider adapter for Reporter and workspace
email. Record provider acceptance/failure and reconcile stuck entries. Do not
force Reporter contacts into Appwrite Auth/Messaging target records.

### Consequences

- The feed is durable and authoritative even if Realtime disconnects.
- The five-second in-product SLO is met without fabricating Reporter accounts.
- Provider handoff can meet 30 seconds while recipient delivery remains outside
  the promise.
- Polling traffic counts toward anti-abuse and pauses while hidden/offline.

### Alternatives not selected

- **Realtime payload as notification truth:** messages can be missed and do not
  replace stored authorization state.
- **Appwrite Auth user for every contact:** violates the Reporter abstraction.
- **Send email inside the domain transaction:** couples business availability to
  an external provider.
- **WebSocket capability channel for Reporter MVP:** adds a second session system
  without a product need.

## ADR-008 - Application-Owned Privacy-Preserving Anti-Abuse

**Status:** Accepted

**Decision drivers:** NFR-SEC-004, 007..011; ERR-015; INV-ABUSE-001.

### Context

The four validated bounds overlap and include an application-scoped external
identity dimension. Appwrite built-in limits are route-specific and server SDK
requests can bypass client limits. Storing raw IP history would conflict with
intentional collection.

### Decision

Enforce all bounds at trusted Function ingress using transactional/atomic
short-lived counters. Derive IP keys with an HMAC and rotating secret; retain
current and previous boundary state only as long as required for enforcement.
Derive the external identity key from its Workspace, issuer/application, value,
and Project scope.

Return HTTP 429 and safe retry timing before any excess domain effect. Apply the
same policy to offline replay. CAPTCHA is not a required dependency.

### Consequences

- Limits are consistent across UI, direct HTTP attempts, and queued replay.
- Counter contention and latency are part of load testing.
- Operators can diagnose aggregate rate-limit health without a permanent raw-IP
  history.
- Future distributed scale may justify a dedicated atomic counter facility only
  if TablesDB tests fail; that is not an MVP assumption.

### Alternatives not selected

- **Appwrite built-in limits only:** cannot prove the validated dimensions.
- **Browser-only throttling:** is bypassable.
- **Permanent IP or device fingerprint:** contradicts privacy decisions.
- **Mandatory CAPTCHA:** explicitly not required for MVP.

## ADR-009 - Scheduled Purge and Complete Independent Recovery Set

**Status:** Accepted

**Decision drivers:** FR-PRIV-002..009; NFR-REC-001..003; INV-DELETE-001;
PD-012; PD-018.

### Context

Deletion must be immediate to ordinary access, become irreversible after 30
days, and survive disaster recovery. Appwrite native database backup alone must
not be assumed to restore private Storage and critical configuration.

### Decision

Soft-delete, required anonymization, proof revocation, Attachment hiding, and
purge eligibility commit together. Allow an explicitly authorized workspace
actor to perform audited restoration before purge without restoring anonymized
identity. Run an hourly idempotent
purger for records at least 30 days old and reconcile Storage deletion.

Create at least daily encrypted recovery sets covering TablesDB, private Storage,
and critical configuration in a separately controlled repository; expire them
after 30 days. Restore into isolation, reapply deletion/purge evidence, validate,
then enable traffic. Exercise representative recovery at least quarterly and
after material persistence changes.

### Consequences

- Business restoration after purge is deliberately absent even while encrypted
  backup media is completing its own 30-day expiry.
- Deletion/purge evidence must be available to recovery without exposing deleted
  business content.
- Backup credentials and restore authority require separation and audit.
- Complete-set export and restore time must be included in capacity planning.

### Alternatives not selected

- **Rely only on undocumented native backup coverage:** cannot prove Storage and
  configuration recovery.
- **Restore directly over production:** risks exposing deleted/cross-scope data
  before validation.
- **Delete from backups immediately:** incompatible with immutable/offsite backup
  mechanics and unnecessary when backup access is isolated and expiry is fixed.
- **Daily purge:** could leave eligible data beyond the first timely processing
  window; hourly processing gives a bounded operational delay.

## ADR-010 - Independently Approved Exceptional-Access Control Plane

**Status:** Accepted

**Decision drivers:** FR-OPS-008..015; NFR-SEC-005;
INV-BREAKGLASS-001; PD-007.

### Context

Platform operation must not imply standing access to every Workspace. A normal
approver is fixed, self-approval is forbidden, duration is at most one hour, and
break-glass is critical-only with review. Console/API credentials that bypass
policy would defeat those guarantees.

### Decision

Implement exceptional access as an application control plane using immutable
grant identity and append-only audit. Require a distinct authenticated Platform
Owner, fresh MFA, mandatory justification, exact Workspace/resource/action, and
absolute expiry <=1 hour. A new duration is a new approval and grant.

Trusted Functions check the grant on every exceptional action and append allow
or deny evidence before returning content. Give the operator no audit
update/delete capability and no standing data API key. Mark critical break-glass
explicitly and require a post-incident review record.

### Consequences

- Support workflows may be slower, as intended by the privacy boundary.
- Audit unavailability fails content access closed.
- The Platform Owner role must be separately staffed and protected; it does not
  become ordinary Workspace content authority.
- Emergency operating procedures must preserve independent approval even during
  an incident.

### Alternatives not selected

- **Operator self-approval:** explicitly forbidden.
- **Permanent support role:** violates absence of standing content access.
- **Broad Workspace-wide grant by default:** violates minimum resource/action
  scope.
- **Editable generic application logs as audit:** do not prevent operator
  tampering or prove grant linkage.

## ADR-011 - SLO-Driven Observability and Evidence-Based Capacity

**Status:** Accepted

**Decision drivers:** NFR-SLO-001..011; NFR-UX-006; NFR-REC-002;
PD-020.

### Context

The validated targets cover browser experience, API work, uploads,
notifications, availability, and disaster recovery. A single server response
metric cannot prove them, and an invented capacity number is forbidden.

### Decision

Use correlated but privacy-redacted real-user monitoring, synthetic probes,
Function/transaction histograms, outbox timing, Storage validation timing, and
recovery/load exercises. Maintain a documented monthly eligibility and
calculation policy. Alert on error-budget and latency burn before the monthly
objective is exhausted.

Release only with a reproducible load report that names the supported envelope
within which critical API, creation, Dashboard, upload, and notification SLOs
hold. Tune scoped indexes and bounded queries before adding new infrastructure.

### Consequences

- SLOs become design feedback rather than documentation-only aspirations.
- Telemetry needs its own access, minimization, and retention policy.
- Capacity can evolve with measured demand without turning an arbitrary number
  into product scope.
- The monitoring vendor is replaceable because measurement points and semantics
  are defined first.

### Alternatives not selected

- **Infrastructure metrics only:** cannot prove Web Vitals or user-visible
  notification timing.
- **Logs containing business payloads:** creates a privacy and exceptional-access
  bypass.
- **Preselect a large capacity target:** conflicts with the validated load-test
  decision.
- **Scale out before query evidence:** adds cost and complexity without proving
  the bottleneck.

## ADR-012 - Vercel Hosts the Vite PWA

**Status:** Accepted

**Decision drivers:** validated Vercel hosting decision; React/Vite/PWA stack;
FR-PROJ-001..010; NFR-UX-001..006; NFR-SLO-001..004.

### Context

The Vite application needs production delivery at `feedback.y7labs.studio`, SPA
deep links for direct Project routes, safe PWA updates, preview isolation, and
cache behavior compatible with the Web Vitals objectives. Appwrite remains the
authoritative backend and must not be replaced or duplicated at the edge.

### Decision

Host the built Vite PWA on Vercel. Configure route fallback only after static
asset resolution so current/historical Project and reserved system routes reach
the React router. Attach `feedback.y7labs.studio` as the production domain.

Cache content-hashed JavaScript, CSS, fonts, and static media as immutable.
Require revalidation for the HTML entry point, web app manifest, and service
worker. Do not proxy-cache authenticated, accountless, Attachment, or other
protected Appwrite responses through Vercel. Production and preview deployments
use separate public configuration and preview has no production secrets or data
access.

### Consequences

- Vercel owns frontend availability, TLS termination, static edge delivery, and
  deployment rollback; Appwrite continues to own all business authority.
- Deep-link rewrite and cache headers become release fitness tests.
- A Vercel outage can affect new online navigation even when an already-installed
  PWA shell remains locally usable.
- Vercel telemetry must obey the same minimization and retention governance as
  other operational telemetry.

### Alternatives not selected

- **Appwrite Sites or another static host:** contradicts the now-validated Vercel
  hosting choice without a demonstrated impossibility.
- **Vercel Functions as a second business backend:** duplicates the trusted
  Appwrite Function boundary and risks inconsistent authorization.
- **Cache protected Appwrite responses at Vercel:** risks cross-principal data
  exposure and stale authorization.
- **Immutable service-worker/HTML caching:** can prevent safe PWA rollout and
  recovery.

## 2. Deferred Implementation Records

The following topics should receive implementation ADRs only when evidence or a
selection exists:

- Appwrite Cloud region and plan;
- exact Appwrite Auth login and account-recovery methods;
- email, telemetry, antivirus, and backup repository vendors;
- controlled-upload transport reconsideration only if the 10 MB Function
  fitness test fails;
- concrete local-cache allow-list, IndexedDB quota behavior, and encryption
  handling;
- physical TablesDB indexes, Storage bucket configuration, and data migrations;
- operational/audit telemetry retention and SLO alert thresholds.
- exact Vercel project settings, preview promotion policy, and rollback runbook.

None authorizes a product behavior change. If one cannot meet an upstream
requirement, the architecture must be revisited explicitly rather than silently
weakening the contract.
