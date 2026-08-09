# Y7 Feedback - Engineering Foundations

This directory applies the method in `../BASICS/` to Y7 Feedback. The documents
must be read in order. Architecture and vendor choices may not redefine the
problem stated in the PRD.

## Stable Product Statement

Y7 Feedback collects structured feedback for multiple projects through one
service. It starts with projects operated by Y7 Labs and is intended to evolve
into a SaaS where independent customers own and manage their own feedback space.

The public address is `feedback.y7labs.studio`. A project has a stable public
slug, for example `feedback.y7labs.studio/wisemoney`.

## Minimal Domain

```text
Workspace 1 --- * Project 1 --- * Feedback 1 --- 0..* Attachment
```

- **Workspace** is the minimum ownership and isolation boundary required by the
  stated SaaS direction. For the initial release, Y7 Labs is the first workspace.
- **Project** is anything for which feedback is collected. WiseMoney is the first
  project. The term does not assume that every target is a mobile or web app.
- **Feedback** is the core information submitted to a project.
- **Attachment** is optional evidence linked to feedback.
- **Reporter** is an actor, not necessarily a stored account. Identity policy is
  deliberately unresolved until product rules define it.

## Document Order

1. [PRD](./01_PRD.md) - the problem and product trajectory.
2. [SRS](./02_SRS.md) - verifiable behavior, independent of vendors.
3. [Contract](./03_CONTRACT.md) - guarantees and invariants.
4. [Responsibilities](./04_RESPONSIBILITIES.md) - ownership derived from guarantees.
5. [Modeling](./05_MODELING.md) - behavior first, then structural consequences.

## Decisions Already Supplied

- The feedback system is an independent product.
- It supports more than one project.
- It begins with Y7 Labs projects.
- Its design must permit later operation as a SaaS for independent customers.
- `/wisemoney` is the first public project route.
- Reviews, suggestions, bug reports, guidance, and uploads are expected product
  capabilities.

## Decisions Not Yet Supplied

- Which reporter identity modes exist and who chooses the mode.
- Whether feedback can be tracked or answered by a reporter.
- Which SaaS administration capabilities belong to the first release.
- Which feedback types are globally fixed versus configurable per project.
- File limits, retention, moderation, notification, and deletion policies.
- Whether public reviews are ever displayed.
- Commercial plans, billing, quotas, trials, and custom domains.

Undecided items must remain explicit. They must not be converted into defaults by
the SRS or architecture.

## Gate Before Implementation

Implementation planning starts only after:

- the PRD is accepted as an accurate problem definition;
- every MUST in the SRS has an acceptance condition;
- reporter identity and MVP operator access are decided;
- retention and attachment rules have concrete limits;
- every invariant has one primary responsibility owner;
- SaaS evolution is supported without implementing unrequested billing or team
  features.
