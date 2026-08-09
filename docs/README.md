# Y7 Feedback - Engineering Foundations

This directory defines Y7 Feedback before architecture or implementation. The
documents follow the mandatory chain in `../BASICS/`; a downstream document may
clarify an upstream decision, but may not redefine it.

```text
Intent -> Requirements -> Contract -> Responsibilities -> Modeling -> Architecture
```

Architecture, vendors, data stores, authentication providers, deployment
topology, and application frameworks are deliberately absent from this chain.

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

The fuller conceptual model is derived in `05_MODELING.md`.

## Document Order

1. [PRD](./01_PRD.md) - intent, actors, scope, and validated product decisions.
2. [SRS](./02_SRS.md) - testable behavior derived from the PRD.
3. [Contract](./03_CONTRACT.md) - observable guarantees and invariants.
4. [Responsibilities](./04_RESPONSIBILITIES.md) - one primary owner per guarantee.
5. [Modeling](./05_MODELING.md) - behavior, lifecycle, relationships, and
   cardinalities.
6. [Decision Traceability](./06_DECISION_TRACEABILITY.md) - decision-to-model
   coverage across the chain.

Supporting research is non-normative unless a recommendation is explicitly
promoted into the PRD:

- [Root Experience Study](./research/ROOT_EXPERIENCE.md)

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
- Workspace Owner, Project Maintainer, and Platform Operator remain distinct
  responsibilities without introducing configurable SaaS RBAC.
- Platform Operator access to workspace content is exceptional, justified,
  limited, and auditable.
- Attachments, anonymization, and soft deletion are part of the MVP.
- Public project slugs are global; historical slugs redirect to the same project.
- `/` must not automatically publish a project catalog. Its exact experience is
  still under product review.
- The MVP public and reporter experiences support French and English.

## Explicitly Deferred

- billing, plans, quotas, trials, and subscriptions;
- configurable team-role systems and marketplace capabilities;
- custom domains and public review widgets;
- community voting and public discussion boards;
- automatic prioritization or autonomous AI decisions;
- external issue-tracker integrations;
- implementation architecture and vendor selection.

## Gate Before Architecture

Architecture comparison may begin only after:

- each normative requirement has an acceptance condition;
- every invariant has one primary responsibility owner;
- remaining attachment, retention, deletion-finalization, service-level, and
  exceptional-access parameters have explicit values or approved policies;
- the root experience recommendation has either been accepted or kept outside
  the architecture-driving scope;
- the decision traceability matrix has no unexplained gap.
