# Stage 5 Definition of Ready — Reporter, Feedback Source, and Context

## Trace

- Tasks: `TASK-REP-001`, `TASK-FDB-001`; incremental `TASK-SEC-001` and
  `TASK-UX-001`.
- Requirements: `FR-REP-001..009`, `FR-FDB-001..006`, `FR-FDB-009`,
  `FR-CTX-001..005`, `INV-REP-001`, `INV-OWN-002..003`, and `NFR-EVO-001`.
- Architecture: sections 5.1, 5.2, 7.2, and 18.

## Actors and boundaries

- Reporter submits without a Y7 account as unidentified, with voluntary
  contact, with a public external identifier, or through a verified Client
  Application assertion.
- Active Project configuration selects enabled system types and declares
  bounded Context dimensions; it cannot redefine core type meaning or execute
  customer code.
- Trusted validation separates Reporter attribution, original source, Context,
  and later derived classification.
- Browser review displays every submitted category before acceptance and keeps
  safe draft input during FR/EN changes.

## Prohibited behavior and data

- No device/browser fingerprint, unrelated behavioral observation, hidden
  continuity key, Y7 login creation, implicit identity verification, or
  cross-Workspace/issuer/application merge.
- No undeclared, malformed, oversized, or executable Context.
- No mutation of original source by Context, classification, later revision,
  or localization.

## BDD scenarios

### BDD-REP-001 — unidentified attribution remains attributable

Given an unidentified submission, when attribution is created, then it receives
one Workspace-scoped Reporter record with no identifier or verified identity;
another unidentified submission does not silently reuse it.

### BDD-REP-002 — public identity stays unverified

Given voluntary contact or a public external identifier, when it is submitted,
then its purpose/provenance is retained, trust is unverified, and equality alone
does not merge Reporters.

### BDD-REP-003 — verified assertion matches only exact scope

Given an approved Client Application assertion, when the same value is resolved
inside the same Workspace, issuer, and application, then it may reuse one
Reporter; a different Workspace, issuer, or application creates an isolated
Reporter.

### BDD-REP-004 — controlled attribution history

Given an existing Reporter attribution, when an authorized correction, link,
merge, or anonymization occurs inside its Workspace, then prior/resulting
attribution, reason, actor/process, and UTC time are appended; ordinary edits or
cross-Workspace targets are denied.

### BDD-FDB-001 — enabled system type semantics

Given an active Project with at least one enabled type, when Bug, Suggestion, or
Review source is validated, then its required semantic fields are enforced;
disabled/unknown types and an active configuration with no type are rejected.

### BDD-FDB-002 — original source is immutable and separate

Given a valid draft, when it is prepared for review, then original typed source,
Reporter attribution, Context, Attachments metadata, and derived classification
occupy distinct fields and classification cannot overwrite source.

### BDD-CTX-001 — Context is declared, bounded, and attributable

Given standard or Project-declared Context, when values are validated, then each
retains name, typed value, disclosed purpose, source, and trust; public values
remain unverified and undeclared/malformed/oversized/executable values fail.

### BDD-UX-INTAKE-001 — bilingual intentional review

Given `/wisemoney`, when the visitor selects a type, enters safe source and
optional Reporter/Context data, and changes language, then input is preserved
and the review shows Project, type, source, Reporter disclosure, Context, and
Attachment category in FR/EN with keyboard and 320 px support.

## Test layers

- Pure domain matrices for Reporter scoping, trust, history, source semantics,
  Project configuration, and Context validation.
- React Testing Library for type/source validation, locale preservation, and
  complete intentional review.
- Playwright for the direct `/wisemoney` FR/EN keyboard journey, axe, and 320 px.
- Existing secret/log/cache/build scans.

`TASK-REP-001` and `TASK-FDB-001` can become `DONE` only after the domain and
affected UI exit criteria pass. No durable acceptance, reference, proof, or
Attachment success is claimed in this stage.
