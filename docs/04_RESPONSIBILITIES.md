# Requirement-to-Responsibility Map - Y7 Feedback

## 1. Derivation Rules

Each guarantee has one primary owner. Components below are conceptual; they do
not prescribe a framework or deployment topology.

## 2. Responsibility Catalog

### R-REG - Application Registry

Owns slug normalization, application activation, allowed origins, enabled
feedback types, branding data, and attachment-partition mapping.

Derived from: FR-APP-001..005, FR-OPS-001..002, BR-001, BR-005,
INV-TEN-001..004.

### R-PRES - Public Experience

Owns product discovery, visible application context, guided forms, localization,
accessible interaction, safe draft preservation, and acknowledgement display.

Derived from: FR-SUB-003..008, FR-CTX-002..004, FR-UX-001..006,
INV-UX-001..003.

### R-GATE - Submission Gateway

Owns request-size bounds, origin checks, anti-abuse verification, rate limiting,
idempotency admission, public error mapping, and authoritative orchestration.

Derived from: FR-APP-005, FR-VAL-001..005, NFR-SEC-001..006,
NFR-PERF-003, NFR-REL-002..003.

### R-VALID - Feedback Policy Validator

Owns type-specific schemas, field normalization, length constraints, impact
vocabulary, diagnostic-context policy, and forbidden-field rejection.

Derived from: FR-SUB-001..008, FR-CTX-001..004, BR-002..004.

### R-FILE - Attachment Coordinator

Owns file policy, content validation, per-application storage selection,
temporary ownership, private permissions, durable association, and cleanup.

Derived from: FR-ATT-001..006, NFR-REL-001, INV-FILE-001..003.

### R-STORE - Submission Repository

Owns unique submission identity, initial status, application immutability,
idempotent persistence, attachment-link persistence, and operator queries.

Derived from: FR-SUB-009, FR-VAL-004..005, FR-OPS-003..004, BR-002..003,
INV-CON-001..004.

### R-OPS - Operator Access

Owns privileged application registration and feedback review, with scoped access
and no public credential exposure.

Derived from: FR-OPS-001..004, NFR-SEC-001, INV-PRV-001..004.

### R-OBS - Safe Observability

Owns request correlation, aggregate operational metrics, redaction, failure
classification, and alerting without feedback content.

Derived from: NFR-SEC-005..006, NFR-REL-003, success criteria.

## 3. Guarantee Ownership Matrix

| Guarantee | Primary owner | Collaborators |
| --- | --- | --- |
| Slug resolves to one active app | R-REG | R-GATE, R-PRES |
| Browser cannot choose app/bucket IDs | R-GATE | R-REG, R-FILE |
| Type-specific payload is valid | R-VALID | R-PRES, R-GATE |
| Automated abuse fails closed | R-GATE | Anti-abuse dependency |
| One key creates at most one record | R-STORE | R-GATE |
| Attachments remain private | R-FILE | R-STORE, R-OPS |
| Failed flow leaves no owned files | R-FILE | R-GATE |
| Success means complete durability | R-GATE | R-FILE, R-STORE |
| Logs contain no user content | R-OBS | Every component |
| Interface remains localized/accessibile | R-PRES | R-VALID |

## 4. Proposed Structural Mapping

Only after responsibility derivation, the selected delivery constraints map the
conceptual owners as follows:

| Responsibility | Proposed structure |
| --- | --- |
| R-PRES | React/Vite public web application |
| R-GATE | Vercel server function boundary |
| R-REG, R-STORE | Appwrite database accessed server-side |
| R-FILE | Vercel orchestration plus private Appwrite buckets |
| R-VALID | Shared pure schemas used by browser and server |
| R-OPS | Appwrite console for MVP |
| R-OBS | Structured Vercel logs with mandatory redaction |

Cloudflare Turnstile fulfills the anti-abuse dependency but does not own
submission authorization; R-GATE remains responsible for verification and
policy.

## 5. Change Boundaries

- Product branding changes should affect R-REG and R-PRES, not persistence.
- A new feedback type should affect R-VALID and R-PRES, with an explicit schema
  migration if persistence fields change.
- Replacing Appwrite should affect R-STORE and R-FILE adapters, not product forms.
- Replacing Turnstile should affect the anti-abuse adapter, not acceptance rules.
- Adding a custom operator dashboard should consume R-OPS contracts without
  weakening public permissions.
