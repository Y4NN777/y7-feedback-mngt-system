# Y7 Feedback

Y7 Feedback gives product teams one place to collect, understand, discuss, and
act on user feedback.

Each Project has a public feedback route, such as
`feedback.y7labs.studio/wisemoney`. Reporters can submit feedback, attach
evidence, receive a reference, return without creating an account, follow the
status, answer Maintainer questions, and request deletion.

## Capabilities

- structured Bug, Suggestion, and Review submissions;
- optional Reporter identity and product Context;
- private Attachments;
- accountless Feedback retrieval;
- Reporter-visible conversations and separate Internal Notes;
- treatment lifecycle, resolution, closure, and reopening;
- in-product and email notifications;
- themes, relationships, trends, and Product Intelligence;
- strict Workspace and Project isolation;
- French and English experiences;
- offline-aware PWA behavior.

## Technology

- React and TypeScript;
- Vite;
- TanStack Query;
- IndexedDB;
- Vercel;
- Appwrite.

## Domain Model

```text
Workspace 1 --- * Project 1 --- * Feedback 1 --- 0..* Attachment
```

A Reporter belongs to a Workspace and remains distinct from an authentication
account. Feedback owns its source, Context, conversation, lifecycle, history,
Attachments, notifications, and derived analysis.

## Documentation

- [Documentation index](./docs/README.md)
- [Product requirements](./docs/01_PRD.md)
- [System requirements](./docs/02_SRS.md)
- [Architecture](./docs/07_ARCHITECTURE.md)
- [Architecture decisions](./docs/08_ARCHITECTURE_DECISIONS.md)
