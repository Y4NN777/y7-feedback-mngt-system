# Responsibility Model - Y7 Feedback

## 1. Purpose

This document assigns behavior to conceptual responsibilities. It is not a
component diagram and does not imply deployable services, libraries, or vendors.
Several responsibilities may initially live in one implementation.

## 2. Core Responsibilities

### Workspace Ownership Policy

- Defines the root ownership boundary.
- Verifies that privileged operations stay within an authorized workspace.
- Prevents project, feedback, and attachment ownership from being reassigned by
  public input.

### Project Registry

- Stores project identity, workspace ownership, public slug, lifecycle state,
  and approved intake configuration.
- Resolves a public route to exactly one active project.
- Rejects unknown, inactive, invalid, or ambiguous routes.

### Public Feedback Experience

- Shows the resolved project before submission.
- Collects feedback according to the selected feedback type.
- Discloses requested reporter and diagnostic data before sending.
- Allows the reporter to review entered content and attachments.
- Presents accepted, rejected, and retryable outcomes accurately.

### Feedback Validation

- Applies the resolved project's feedback rules.
- Rejects incomplete, malformed, oversized, or unsupported input.
- Treats workspace and project identifiers from public input as untrusted.
- Produces actionable validation outcomes without exposing internal details.

### Feedback Intake Coordination

- Coordinates validation, anti-abuse checks, persistence, and attachment
  association as one logical submission.
- Applies idempotency to retries.
- Issues a confirmation reference only after durable acceptance.
- Ensures failed intake does not leave orphaned request-owned data.

### Attachment Coordination

- Enforces the approved attachment policy.
- Associates accepted evidence with exactly one feedback item.
- Prevents public listing or retrieval.
- Coordinates cleanup when submission fails.

### Feedback Repository

- Persists projects, feedback, attachments, and immutable ownership links.
- Retrieves data only within an authorized ownership scope.
- Preserves historical feedback when a project is deactivated.

### Access Control

- Establishes the trusted identity and permissions of workspace actors.
- Authorizes project configuration and feedback retrieval.
- Remains policy-neutral until roles and authentication are approved.

### Safe Observability

- Records enough operational evidence to diagnose failures and abuse.
- Excludes secrets and attachment content.
- Redacts reporter and feedback content by default until logging and retention
  policy explicitly permits otherwise.

## 3. Responsibility Boundaries

- The Public Feedback Experience never decides ownership or authorization.
- The Project Registry resolves ownership but does not accept feedback.
- Feedback Validation decides input validity but does not claim persistence.
- Feedback Intake Coordination decides when the overall operation is accepted.
- The Feedback Repository does not infer authorization from identifiers alone.
- Attachment Coordination does not make attachments public assets.
- Access Control does not define reporter identity policy.

## 4. Requirement Mapping

| Requirement area | Primary responsibility | Supporting responsibilities |
| --- | --- | --- |
| Workspace isolation | Workspace Ownership Policy | Access Control, Feedback Repository |
| Public slug resolution | Project Registry | Public Feedback Experience |
| Structured capture | Public Feedback Experience | Feedback Validation |
| Durable acceptance | Feedback Intake Coordination | Feedback Repository |
| Attachment lifecycle | Attachment Coordination | Feedback Intake Coordination, Feedback Repository |
| Project operation | Project Registry | Access Control, Workspace Ownership Policy |
| Safe failures | Feedback Intake Coordination | Feedback Validation, Safe Observability |
| Future workspace onboarding | Workspace Ownership Policy | Project Registry, Access Control |

## 5. Deferred Allocation Decisions

The following are intentionally not assigned to technical components yet:

- frontend framework and rendering model;
- API shape and process boundaries;
- persistence and object-storage products;
- identity and anti-abuse providers;
- hosting, regions, CDN, and deployment topology;
- whether management operations initially use a dedicated interface.

Those choices follow approved requirements and quality targets; they do not
define the domain.
