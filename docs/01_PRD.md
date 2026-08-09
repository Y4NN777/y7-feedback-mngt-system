# Product Requirements Document - Y7 Feedback

## 1. Product Intent

Y7 Feedback exists to give projects one consistent place to receive useful,
structured feedback from the people who use or evaluate them.

The product begins as shared feedback infrastructure for Y7 Labs projects. Its
declared evolution is a SaaS through which independent customers can own a
workspace, register projects, and manage feedback without receiving a separate
copy of the software.

This trajectory justifies a workspace ownership boundary. It does not justify
billing, subscriptions, complex teams, or other SaaS features until those
problems enter scope.

## 2. Problem

Feedback is commonly fragmented across private messages, unrelated forms, app
stores, and informal conversations. The receiving project is not always clear,
bug reports frequently omit reproduction context, evidence is separated from the
report, and every new project risks creating another incompatible collection
process.

A reusable service must solve this without hard-coding WiseMoney or requiring a
separate deployment for each project.

## 3. Actors

- **Reporter** - provides feedback about a project. No authentication state is
  assumed by this role.
- **Workspace owner** - owns a feedback space and its projects.
- **Project maintainer** - needs access to feedback for projects they manage.
- **Platform operator** - operates the shared Y7 Feedback service.

The relationship between workspace owner and project maintainer is deliberately
not expanded into a complete role system at this stage.

## 4. Core Use Cases

### UC-01 - Reach a project feedback space

A reporter opens a stable project feedback address and can verify which project
will receive the feedback.

### UC-02 - Submit feedback

A reporter selects an available feedback type and provides the information
required for that type.

### UC-03 - Add evidence

A reporter may attach supported evidence when the project permits attachments.

### UC-04 - Receive confirmation

A reporter can distinguish an accepted submission from a failed attempt.

### UC-05 - Manage projects

An authorized workspace actor can register and configure multiple projects in the
same feedback service.

### UC-06 - Review project feedback

An authorized workspace actor can access feedback belonging to their projects
without gaining access to another workspace.

## 5. Initial Product Scope

- One operational workspace owned by Y7 Labs.
- Multiple projects in that workspace, beginning with WiseMoney.
- Root service page and stable project slug pages.
- Structured review, suggestion, and bug-report experiences.
- Project-specific guidance and optional attachments.
- Clear acceptance and failure outcomes.
- A means for authorized Y7 Labs actors to configure projects and retrieve their
  feedback.
- Foundations that preserve workspace ownership and project isolation.

The initial scope does not decide whether reporters are anonymous, identified by
contact information, verified, or authenticated. That is an unresolved product
policy, not an implementation default.

## 6. SaaS Evolution Scope

The future SaaS problem adds independent customer workspaces. A customer must be
able to own projects and access only its own feedback. The shared service must not
require a code fork or dedicated frontend deployment for each customer.

The following are not implied merely by saying “SaaS” and remain future product
decisions:

- subscriptions and billing;
- plans and quotas;
- invitations and complex team roles;
- custom domains;
- public review widgets;
- external issue-tracker integrations;
- service-level agreements.

## 7. Out of Scope Until Decided

- A mandatory or anonymous reporter identity model.
- Public publication of reviews.
- Community comments and voting.
- Reporter-to-maintainer conversation.
- Product roadmaps generated from feedback.
- Automatic prioritization or AI classification.
- Reading private data from the project being reviewed.
- Commercial SaaS mechanics listed in Section 6.

## 8. Success Criteria

- A reporter can reach the intended project and submit an allowed feedback type.
- The receiving maintainer can determine which workspace and project own every
  accepted feedback item.
- Evidence remains associated with the correct feedback and project.
- A second Y7 Labs project can be added without duplicating the feedback service.
- Introducing a second workspace does not require changing the meaning or shape
  of existing project feedback.
- Unauthorized actors cannot retrieve feedback or evidence from another project
  or workspace.
- Failed submissions are never presented as accepted.

Numeric performance, completion, retention, and availability targets remain open
until product expectations are supplied; inventing them here would create false
requirements.

## 9. Product Questions Blocking Final SRS Approval

1. Which reporter identity modes must the product support?
2. Is identity policy global, workspace-specific, or project-specific?
3. Can reporters return later to track or amend feedback?
4. Who configures projects in the initial release, and through which product
   capability rather than temporary operational tooling?
5. Which actors can review feedback inside a workspace?
6. Are review, suggestion, and bug fixed system types or project configuration?
7. What retention and deletion rights apply to reporter data and attachments?
