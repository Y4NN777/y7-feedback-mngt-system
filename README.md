# Y7 Feedback - Engineering Foundations

This repository defines Y7 Feedback through architecture, before implementation.
The documents preserve a strict dependency chain: a downstream document may
clarify an upstream decision, but may not redefine it.

```text
Intent -> Requirements -> Contract -> Responsibilities -> Modeling -> Architecture
```

The first six documents remain technology-independent product truth. Architecture
then allocates their responsibilities to the already selected frontend stack and
Appwrite without rewriting the upstream contract.

## Stable Product Statement

Y7 Feedback is an independent product that creates a continuous feedback loop
between reporters and the people improving a project. It captures structured
source feedback, preserves its context, supports clarification and resolution,
and turns authorized workspace data into product intelligence.

The service begins with projects operated by Y7 Labs and must support additional
customer workspaces without copying the product. SaaS means shared operation with
strict workspace isolation; it does not imply billing, plans, complex teams, or
custom domains.

The public service address is `feedback.y7labs.studio`. Projects use globally
unique slugs, for example `feedback.y7labs.studio/wisemoney`. A changed slug
retains its historical route as a redirect to the same project's current slug.

## Ownership Spine

```text
Workspace 1 --- * Project 1 --- * Feedback 1 --- 0..* Attachment
```

This is the minimum ownership spine, not the complete behavior model:

- **Workspace** is the customer ownership and isolation boundary.
- **Project** is the target for which feedback is collected.
- **Reporter** is the workspace-scoped source or subject of feedback, not an
  authentication account.
- **Feedback** is a living work item with source content, context, lifecycle,
  conversation, history, and derived analysis.
- **Attachment** is optional evidence owned by one feedback item.

The fuller conceptual model is derived in `docs/05_MODELING.md`.

## Document Order

1. [PRD](./docs/01_PRD.md) - intent, actors, scope, and validated product decisions.
2. [SRS](./docs/02_SRS.md) - testable behavior derived from the PRD.
3. [Contract](./docs/03_CONTRACT.md) - observable guarantees and invariants.
4. [Responsibilities](./docs/04_RESPONSIBILITIES.md) - one primary owner per guarantee.
5. [Modeling](./docs/05_MODELING.md) - behavior, lifecycle, relationships, and
   cardinalities.
6. [Decision Traceability](./docs/06_DECISION_TRACEABILITY.md) - decision-to-model
   coverage across the chain.
7. [Architecture](./docs/07_ARCHITECTURE.md) - context, logical boundaries, flows,
   security, offline behavior, recovery, and SLO tactics.
8. [Architecture Decisions](./docs/08_ARCHITECTURE_DECISIONS.md) - ADRs, alternatives,
   consequences, and implementation fitness conditions.

Supporting research is non-normative unless a recommendation is explicitly
promoted into the PRD:

- [Root Experience Study](./docs/research/ROOT_EXPERIENCE.md)

## Validated Direction

- Reporter attribution supports an unidentified source, a voluntarily supplied
  contact, an application-scoped external user identifier, or an identity
  asserted by a client application.
- Y7 Feedback does not become the client application's identity provider and
  does not use hidden behavioral tracking or fingerprinting.
- A reporter can confirm, retrieve, follow, clarify, update permitted
  information, and request deletion of a feedback item without requiring a Y7
  Feedback account.
- Reporter-visible conversation and workspace-internal notes are distinct.
- Feedback follows a defined lifecycle and can be reopened.
- In-product and email notifications are MVP capabilities when the recipient has
  an eligible channel.
- `bug`, `suggestion`, and `review` are structured MVP feedback types.
- Product Intelligence is an MVP capability built from preserved source data,
  context, relationships, themes, and trends.
- Workspace Owner, Project Maintainer, Platform Operator, and Platform Owner /
  Super Administrator remain distinct responsibilities without introducing
  configurable SaaS RBAC.
- Platform Operator access to workspace content is exceptional, justified,
  independently approved, scoped to at most one hour, and auditable.
- Attachments use the validated formats, 10 MB/file, five files/submission,
  actual-content validation, private access, and logical atomicity.
- Deletion immediately soft-deletes and anonymizes when required, supports an
  audited pre-purge restore, and purges after 30 days. Daily backups are retained
  30 days with RPO 24 hours and RTO 4 hours.
- Quantitative anti-abuse bounds and internal availability, performance,
  notification, capacity-testing, and 320 px objectives are fixed in the SRS.
- Public project slugs are global; historical slugs redirect to the same project.
- `/` is a bilingual orientation point for giving feedback, retrieving a
  feedback item, or entering Workspace management, without public discovery.
- The MVP public and reporter experiences support French and English.

## Explicitly Deferred

- billing, plans, quotas, trials, and subscriptions;
- configurable team-role systems and marketplace capabilities;
- custom domains and public review widgets;
- community voting and public discussion boards;
- automatic prioritization or autonomous AI decisions;
- external issue-tracker integrations;
- billing-driven infrastructure or architecture not justified by current load;
- exact email, malware-scanning, telemetry, and backup repository products;
- infrastructure-as-code, CI/CD, migrations, and application implementation.

## Architecture Gate

The gate is passed:

- each normative requirement has an acceptance condition;
- every invariant has one primary responsibility owner;
- attachment, retention, deletion-finalization, service-level, anti-abuse, and
  exceptional-access parameters have approved values;
- the root experience recommendation is accepted;
- the decision traceability matrix has no unexplained gap.

The validated implementation constraints are React, TypeScript, Vite, TanStack
Query, IndexedDB, PWA/offline-first behavior, Appwrite as backend, and Vercel as
PWA host. Their cooperation is defined downstream rather than retrofitted into
the product requirements.
