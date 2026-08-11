# Product Requirements Document - Y7 Feedback

## 1. Product Intent

Y7 Feedback exists to create a durable learning loop between the people who use
or evaluate a project and the people responsible for improving it.

It is not merely a message form. It must help a reporter explain an experience,
help a maintainer understand and clarify it, preserve what happened during its
treatment, and make recurring problems and needs visible from the original
feedback and its legitimate context.

The product begins as shared feedback infrastructure for Y7 Labs projects. It is
intended to support independent customer workspaces through the same product,
with strict ownership and access isolation.

## 2. Problem

Product feedback is commonly fragmented across private messages, unrelated
forms, app stores, screenshots, and informal conversations. These channels lose
the target project, reporter continuity, product version, usage context,
evidence, clarification history, and treatment outcome.

As a result:

- reporters cannot reliably know whether feedback was received or acted upon;
- maintainers repeatedly ask for missing context through disconnected channels;
- related problems reported by the same or different people remain isolated;
- teams cannot reliably compare problems across versions, screens, features, or
  time;
- each new project risks introducing another incompatible process.

Y7 Feedback must solve this without hard-coding WiseMoney, requiring a separate
product copy per project, becoming the client application's identity provider,
or turning legitimate context collection into hidden surveillance.

## 3. Target Actors

- **Reporter** - the workspace-scoped source or subject of feedback. A Reporter
  may be unidentified or associated with legitimate identity information, and
  is not necessarily an authentication account.
- **Workspace Owner** - owns a workspace, its projects, access assignments, and
  workspace-level feedback responsibilities.
- **Project Maintainer** - works on feedback for specifically assigned projects.
- **Platform Operator** - operates Y7 Feedback. This role has no ordinary right
  to read all workspace business content.
- **Platform Owner / Super Administrator** - governs exceptional platform
  access and is organizationally distinct from the requesting Platform Operator
  for approval purposes.
- **Client Application** - may send project context or assert an application
  identity through a trusted interaction. It cannot assign ownership or
  authorization merely by sending public fields.

## 4. Product Principles

### P-01 - Preserve the source

Reporter content and submitted context remain distinguishable from maintainer
interpretation and derived Product Intelligence.

### P-02 - Maintain the loop

Acceptance is the start of a feedback lifecycle, not the end of a form request.
Reporter and maintainer must be able to clarify, act, resolve, and learn.

### P-03 - Collect intentionally

Identity and context are collected only for an explicit feedback, analysis,
security, or communication purpose. Y7 Feedback does not fingerprint a device or
observe unrelated behavior to recognize a reporter.

### P-04 - Separate identity from access

Reporter attribution, reporter access to a feedback item, client-application
identity, and workspace-actor authentication are different concerns.

### P-05 - Isolate by workspace

Every project, reporter, feedback item, conversation, attachment, and derived
analysis is owned within one workspace. No convenience feature may weaken that
boundary.

### P-06 - Keep interpretation accountable

Themes, relationships, trends, and later automated analysis are derived data.
They must not silently replace or rewrite source feedback.

### P-07 - Let architecture follow behavior

The product definition does not select a framework, host, storage system,
identity provider, notification provider, or deployment topology.

## 5. Core Use Cases

### UC-01 - Reach the intended project

A reporter opens a current or historical public project route and can verify the
current project that will receive feedback.

### UC-02 - Submit structured feedback

A reporter submits a `bug`, `suggestion`, or `review` using the information
meaningful to that type, with optional legitimate reporter and product context.

### UC-03 - Add evidence

A reporter attaches permitted evidence needed to understand the feedback.

### UC-04 - Confirm and recover access

After durable acceptance, the reporter receives a unique reference and a means
to retrieve the feedback without creating a Y7 Feedback account.

### UC-05 - Follow and clarify feedback

The reporter views the current state and reporter-visible conversation, responds
to information requests, and updates information that policy permits without
silently replacing the original submission.

### UC-06 - Request deletion

The reporter requests deletion of a feedback item. The service applies the
approved anonymization, soft-deletion, and retention policy.

### UC-07 - Manage projects and maintainers

A Workspace Owner creates and configures projects, changes their active state,
changes their public slug, and assigns Project Maintainers.

### UC-08 - Work a feedback item

An assigned Project Maintainer reads feedback and evidence, adds internal notes,
communicates with the reporter, requests information, changes lifecycle state,
records resolution, and reopens feedback when further work is justified.

### UC-09 - Receive relevant notifications

Reporters and authorized workspace actors receive in-product and, when an
eligible address exists, email notification of relevant feedback events.

### UC-10 - Learn across feedback

Authorized workspace actors filter, relate, group, and compare source feedback
by type, reporter attribution when available, context, theme, version, place,
and time without gaining access to another workspace.

### UC-11 - Operate the platform safely

A Platform Operator diagnoses and operates the service without ordinary access
to workspace business content. Exceptional access is explicitly granted,
justified, limited, and audited.

### UC-12 - Connect feedback to development work

A Workspace Owner connects selected GitHub or GitLab.com repositories to a
Project. An assigned Project Maintainer can create one linked external issue
from a Feedback item and keep its treatment state and reporter-visible
conversation synchronized without exposing Internal Notes, Access Proofs,
Attachments, or Reporter identifiers.

## 6. MVP Product Scope

- One initial Y7 Labs workspace with multiple projects, beginning with
  WiseMoney.
- A globally unique public slug per project, with `/wisemoney` as the first
  route and historical slug redirects after a rename.
- French and English public intake and reporter follow-up experiences.
- Workspace-scoped Reporter records supporting unidentified attribution,
  voluntary contact, application-scoped external identifiers, and identity
  assertions from client applications.
- Structured `bug`, `suggestion`, and `review` experiences.
- Intentional product context, including applicable version, screen or page,
  feature, platform, operating system, device, locale, environment, and
  functional context.
- Accountless confirmation, retrieval, status visibility, clarification,
  permitted updates, and deletion requests.
- Reporter-visible messages, separate internal notes, lifecycle history, and
  reopening.
- In-product and email notifications.
- Attachments used as evidence.
- Maintainer workflows and structured Product Intelligence.
- An explicit administration capability for Y7 Labs that preserves the future
  Workspace Owner and Project Maintainer responsibilities.
- Anonymization and soft deletion.
- A bilingual root orientation experience at `/` for starting feedback,
  retrieving existing feedback, or entering Workspace management, without
  project discovery or Workspace exposure.
- Optional GitHub and GitLab.com source connections for repository metadata,
  releases, a Y7 Feedback badge/link, and one active external issue per Feedback.
- Bidirectional synchronization of the linked issue state and reporter-visible
  conversation, subject to Workspace authorization, provider-author checks, and
  explicit Reporter consent before publication to a public repository.

The service root `/` is a bilingual orientation point, not a directory. Direct
Project URLs remain the normal contextual entry into intake. The observations
behind this decision remain in the
[Root Experience Study](./research/ROOT_EXPERIENCE.md).

## 7. Feedback Types and Source Information

The initial types express different reporter intents; they are not arbitrary
form names.

- **Bug** captures what does not work. Expected behavior, observed behavior,
  reproduction steps, and context are captured when applicable.
- **Suggestion** captures the proposed improvement, why it would help, and its
  usage context when applicable.
- **Review** captures the experienced outcome and the reporter's appreciation.
  A structured rating is not implied until its analytical value and semantics
  are approved.

Projects may enable the applicable system types and provide project-specific
guidance. Arbitrary executable project forms are not part of the MVP.

## 8. Feedback Lifecycle

The product lifecycle follows this intent:

```text
Submit -> Understand -> Clarify -> Analyze -> Act -> Resolve -> Learn
```

The MVP workflow distinguishes feedback that is received, under review, waiting
for reporter information, resolved, or closed. A Project Maintainer can reopen a
resolved or closed item when further work is justified. Resolution records a
maintainer conclusion; closure records that no active exchange or treatment is
expected. Neither state deletes the feedback.

## 9. Product Intelligence Scope

Product Intelligence in the MVP means that authorized workspace actors can use
preserved structured information to:

- find recurring problems and needs;
- relate feedback items and group them under accountable themes;
- compare feedback by version, time, screen/page, feature, platform, locale,
  environment, and other approved context;
- identify repeated feedback associated with a reporter when legitimate
  identity information exists;
- observe whether reported patterns increase or decrease over time or after a
  version change.

The MVP does not require autonomous classification, automatic prioritization,
or AI-generated product decisions. Those may later enrich, but never replace,
the source model.

## 10. SaaS Evolution Scope

The future SaaS problem adds independent customer workspaces. Each customer can
own projects, assign maintainers, and work only with its own reporter,
conversation, attachment, notification, and intelligence data. The shared
service must not require a code fork or dedicated product copy for each customer.

SaaS does not currently imply:

- subscriptions, billing, plans, quotas, or trials;
- configurable role builders or complex team hierarchies;
- custom domains;
- marketplaces;
- public review widgets or public feedback boards;
- contractual service-level agreements.

## 11. Explicitly Out of Scope

- Y7 Feedback acting as the client application's identity provider.
- Hidden fingerprinting or behavioral surveillance.
- Automatic or unconsented public publication of feedback, reviews,
  conversations, or reporter profiles.
- Community comments and voting.
- A real-time chat product unrelated to a feedback item.
- Product roadmaps generated automatically from feedback.
- Autonomous AI classification, prioritization, or resolution.
- Reading private client-application data that was not intentionally supplied.
- Commercial SaaS mechanics listed in Section 10.
- Any specific implementation architecture or vendor.

## 12. Success Criteria

- A reporter can complete the feedback loop from submission through later
  retrieval and reporter-visible resolution without a Y7 Feedback account.
- A maintainer can obtain the source, evidence, context, and clarification needed
  to act without mixing internal notes with reporter-visible messages.
- Reopening preserves the prior lifecycle and conversation history.
- Authorized workspace actors can identify and compare recurring feedback from
  structured source data and accountable derived classifications.
- Every accepted item and all of its related data retain one workspace and one
  project ownership scope.
- A second workspace can be introduced without changing existing ownership or
  exposing data across workspaces.
- Platform operation does not grant routine access to customer business content.
- A renamed project remains reachable from its historical slug without routing
  that slug to another project.
- The root helps a person start feedback, recover an existing feedback item, or
  enter Workspace management without exposing a project or Workspace catalog.
- Soft-deleted feedback is absent from ordinary work and intelligence views, and
  its reporter attribution is anonymized according to policy.
- The service meets its internal availability, responsiveness, recovery, and
  notification objectives under a load envelope established by testing.
- Failed or partially failed operations are never represented as fully accepted.

## 13. Validated Product Decisions

| ID | Decision |
| --- | --- |
| PD-001 | Y7 Feedback is an independent, multi-project feedback-loop product. |
| PD-002 | Workspace is the customer ownership and SaaS isolation boundary. |
| PD-003 | Reporter is workspace-scoped and distinct from authentication accounts. |
| PD-004 | Accountless retrieval, conversation, lifecycle, history, and reopening are MVP capabilities. |
| PD-005 | Reporter-visible messages and workspace-internal notes are separate. |
| PD-006 | Workspace Owner assigns Project Maintainers; roles are fixed rather than a configurable RBAC product. |
| PD-007 | Platform Operator content access is exceptional, independently approved by a Platform Owner / Super Administrator, justified, narrowly scoped, limited to one hour, and audited; critical break-glass use additionally requires post-incident review. |
| PD-008 | `bug`, `suggestion`, and `review` are structured MVP types. |
| PD-009 | Intentional context and structured Product Intelligence are MVP capabilities. |
| PD-010 | Attachments are optional per feedback but supported by the MVP under a private, content-validated, bounded, logically atomic policy. |
| PD-011 | Notifications support in-product and email delivery. |
| PD-012 | Deletion uses immediate anonymization when required and immediate soft deletion, permits authorized audited restoration before a 30-day purge, and has no business restoration after purge. |
| PD-013 | Project slugs are global; historical slugs redirect after a rename. |
| PD-014 | `/` is a bilingual orientation point for giving feedback, retrieving feedback, or entering Workspace management; it exposes no automatic catalog or public search, while direct Project URLs remain accessible. |
| PD-015 | The MVP supports French and English. |
| PD-016 | SaaS evolution excludes unrequested commercial and complex-team features. |
| PD-017 | MVP Attachments accept JPEG, PNG, WebP, GIF, PDF, TXT, and CSV only, at 10 MB per file and five files per submission; archives and executables are forbidden and actual content is validated. |
| PD-018 | Daily backups are retained for 30 days and recovery targets are RPO 24 hours and RTO 4 hours. |
| PD-019 | Public abuse controls are 60 requests/minute/IP, 10 feedback submissions/minute/IP, 20 uploaded files/minute/IP, and 30 feedback/hour/external identity/project, with HTTP 429 on excess and no unnecessary permanent tracking. |
| PD-020 | Internal SLOs are 99.9% monthly availability, approved Web Vitals and P95 operation targets, with capacity established by load testing and a 320 px minimum viewport. |
| PD-021 | A Project may optionally connect selected GitHub and GitLab.com repositories. One Feedback may have one active linked issue with bidirectional state and reporter-visible conversation synchronization. Public-repository content publication requires explicit Reporter consent; Y7 never synchronizes Internal Notes, Access Proofs, Reporter identifiers, or Attachments automatically. The portfolio is not an integration source. |

## 14. Validated Operating Parameters

These values complete the product inputs required for architecture. They are
internal product objectives and policies, not commercial service-level
agreements.

1. Attachment policy: JPEG, PNG, WebP, GIF, PDF, TXT, and CSV; at most 10 MB per
   file and five files per submission; archives and executables forbidden;
   actual-content validation, private controlled storage, logical submission
   atomicity, and the Feedback lifecycle apply.
2. Data lifecycle: immediate soft deletion, immediate anonymization when
   required, authorized and audited restoration before definitive purge after 30
   days, and no business restoration after purge. Daily backups are retained for
   30 days, with RPO 24 hours and RTO 4 hours.
3. Exceptional access: a Platform Owner / Super Administrator other than the
   requesting operator approves a justified resource/action-scoped grant for at
   most one hour. Extension requires a new approval. Critical break-glass use is
   justified, audited, and reviewed after the incident.
4. Anti-abuse: 60 requests/minute/IP, 10 submissions/minute/IP, 20 uploaded
   files/minute/IP, and 30 feedback/hour/external identity/project; excess
   receives HTTP 429. Accountless protection creates no unnecessary persistent
   tracking and CAPTCHA is not mandatory for the MVP.
5. Internal SLOs: 99.9% availability/month; LCP P75 <= 2.5 s, INP P75 <= 200
   ms, CLS P75 <= 0.1; critical API P95 <= 500 ms; Feedback creation P95 <= 1 s
   excluding upload; Dashboard P95 <= 1 s; upload processing P95 <= 2 s after
   receipt; in-product notification P95 <= 5 s; email-provider handoff P95 <= 30
   s; minimum viewport 320 px. Capacity is established by load testing.
6. Development integration: GitHub and GitLab.com connections are optional and
   restricted to repositories selected by a Workspace Owner. A linked issue is
   synchronized bidirectionally with one Feedback, while Y7 preserves source
   history, audience boundaries, explicit public-publication consent, and
   provider-independent Project identity.
