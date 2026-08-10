# Y7 Feedback

Y7 Feedback is an independent feedback-management platform that connects
Reporters, product context, Maintainers, treatment history, and Product
Intelligence in one continuous improvement loop.

The public platform is intended for `feedback.y7labs.studio`. Each active
Project has a direct public route such as `/wisemoney`, while Workspace business
data remains strictly isolated.

## Current Status

Product requirements, contracts, responsibilities, domain models, architecture,
and the delivery sprint are defined. Application implementation has not yet
been committed to this repository.

The complete source of truth starts at the
[documentation index](./docs/README.md).

## Validated Stack

- React and TypeScript;
- Vite;
- TanStack Query;
- IndexedDB;
- installable, connectivity-aware PWA;
- Vercel for PWA delivery;
- Appwrite as the authoritative backend.

## Domain Spine

```text
Workspace 1 --- * Project 1 --- * Feedback 1 --- 0..* Attachment
```

Reporter attribution is distinct from authentication. Feedback is a living
object with source content, Context, conversation, Internal Notes, lifecycle,
history, Attachments, notifications, and accountable derived analysis.

## Documentation

Read the documents in their declared dependency order:

```text
Intent
  -> Requirements
  -> Contract
  -> Responsibilities
  -> Modeling
  -> Architecture
  -> Delivery Plan
```

- [Documentation index](./docs/README.md)
- [Architecture](./docs/07_ARCHITECTURE.md)
- [Architecture decisions](./docs/08_ARCHITECTURE_DECISIONS.md)
- [One-week delivery sprint](./docs/09_ONE_WEEK_SPRINT_PLAN.md)

Downstream implementation must satisfy the documented requirements and must not
silently redefine product or security guarantees.
