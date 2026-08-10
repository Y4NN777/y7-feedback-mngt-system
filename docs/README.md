# Y7 Feedback Documentation

Y7 Feedback is a multi-project feedback platform built around a continuous loop
between Reporters and the people improving a product.

The documents in this directory describe the product, its observable behavior,
its domain model, and its architecture.

## Product

The platform captures structured feedback and its relevant Context, preserves
the conversation and treatment history, and supports analysis across Reporters,
versions, screens, features, themes, and time.

Projects use direct public routes under `feedback.y7labs.studio`. Workspace data
is isolated, Reporter identity remains independent from authentication, and the
service root exposes no public Project or Workspace directory.

## Core Model

```text
Workspace 1 --- * Project 1 --- * Feedback 1 --- 0..* Attachment
```

- **Workspace** owns the customer boundary and its data.
- **Project** is the product or application receiving Feedback.
- **Reporter** is the source or subject of Feedback.
- **Feedback** contains source content, Context, conversation, lifecycle,
  history, Attachments, notifications, and derived analysis.
- **Attachment** is private evidence owned by one Feedback item.

## Document Map

1. [Product Requirements](./01_PRD.md) — purpose, actors, scope, and product
   decisions.
2. [System Requirements](./02_SRS.md) — testable functional and non-functional
   requirements.
3. [Core Contract](./03_CONTRACT.md) — observable guarantees, permissions,
   lifecycle rules, and invariants.
4. [Responsibilities](./04_RESPONSIBILITIES.md) — ownership of domain rules and
   system behavior.
5. [Modeling](./05_MODELING.md) — use cases, activities, lifecycle, identities,
   relationships, and cardinalities.
6. [Decision Traceability](./06_DECISION_TRACEABILITY.md) — links between product
   decisions, requirements, contracts, responsibilities, and models.
7. [Architecture](./07_ARCHITECTURE.md) — frontend, Appwrite, persistence,
   offline synchronization, security, recovery, and observability.
8. [Architecture Decisions](./08_ARCHITECTURE_DECISIONS.md) — architectural
   choices, alternatives, and consequences.

Supporting research:

- [Root Experience Study](./research/ROOT_EXPERIENCE.md)

## Technology

- React, TypeScript, and Vite;
- TanStack Query and IndexedDB;
- installable, connectivity-aware PWA;
- Vercel for frontend delivery;
- Appwrite for authentication, trusted Functions, TablesDB, private Storage,
  scheduled work, and Realtime.

## Product Boundaries

Y7 Feedback does not include billing, plans, configurable role builders, custom
customer domains, public Feedback boards, community voting, a marketplace, or
autonomous product decisions.
