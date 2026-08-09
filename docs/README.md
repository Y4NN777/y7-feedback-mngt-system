# Y7 Feedback - Engineering Kickoff

This directory applies the methodology in `../BASICS/` to Y7 Feedback. No
application code should be introduced until the documents below are reviewed.

## Product Definition

Y7 Feedback is a public, multi-application feedback service hosted at
`feedback.y7labs.studio`. Each registered product receives a stable slug, for
example `feedback.y7labs.studio/wisemoney`, where users can submit reviews,
suggestions, and bug reports with optional attachments.

## Document Order

1. [PRD](./01_PRD.md) - problem, users, scope, and success criteria.
2. [SRS](./02_SRS.md) - verifiable system requirements.
3. [Contract](./03_CONTRACT.md) - guarantees, invariants, and refusals.
4. [Responsibilities](./04_RESPONSIBILITIES.md) - ownership derived from requirements.
5. [Modeling](./05_MODELING.md) - UML behavior and C4 structure.

## Current Decisions

- The service is independent from WiseMoney and must support multiple products.
- The root domain is `feedback.y7labs.studio`.
- Product pages use `/:appSlug`; `wisemoney` is the first slug.
- Feedback data is logically partitioned by application.
- Attachments are private and physically partitioned by application bucket.
- Appwrite is the selected managed data and object-storage platform.
- Public submission passes through a server-side boundary and anti-abuse check.
- Public review display and a custom moderation console are post-MVP capabilities.

## Open Decisions

- Final Y7 Feedback visual identity and per-application branding contract.
- Attachment limits and allowed MIME types.
- Feedback retention and deletion periods.
- Whether submitters can track a report beyond receiving a reference.
- Notification channel for newly submitted high-severity reports.
- Administrator identity provider for the post-MVP moderation console.

## Exit Gate Before Code

Implementation may start only when:

- every MVP requirement has an acceptance test;
- every security invariant has one primary owner;
- open decisions that affect the data model are resolved;
- the context, submission, and attachment flows are reviewed;
- the first Appwrite application record and bucket naming policy are approved.
