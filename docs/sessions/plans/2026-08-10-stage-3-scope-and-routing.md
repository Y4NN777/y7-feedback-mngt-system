# Stage 3 Definition of Ready — Scope, Authorization, and Routing

## Trace

- Tasks: local portions of `TASK-OWN-001`, `TASK-AUTH-001`, and
  `TASK-PROJ-001`; incremental `TASK-SEC-001` and `TASK-UX-001`.
- Requirements: `FR-OWN-001..007`, `FR-PROJ-001..010`, `FR-OPS-001..006`,
  `FR-OPS-010`, `NFR-SEC-002..003`, and `NFR-EVO-002`.
- Architecture: sections 5.1, 6.2, and 7.1.

## Domain boundaries

- Workspace is the immutable customer isolation boundary.
- Project has exactly one Workspace owner and its scope is derived only from
  the authoritative Project record.
- Slug reservation is global, permanent across current/history/inactive state,
  and separate from route presentation.
- Authentication identifies a principal; fixed domain responsibility,
  Workspace membership, and current Project assignment authorize capability.
- Removal of a Maintainer assignment affects the next decision without changing
  Project or historical business ownership.

## BDD scenarios

### BDD-OWN-001 — immutable same-scope ownership

Given Projects in two Workspaces, when a child scope is derived or an ordinary
update is requested, then the Project record supplies Workspace/Project scope
and any cross-Workspace association or reassignment is rejected.

### BDD-AUTH-001 — fixed Owner and Maintainer capabilities

Given an Owner, an assigned Maintainer, an unassigned Maintainer, and a Platform
Operator, when protected capabilities are evaluated, then the Owner is limited
to its Workspace, the Maintainer to assigned Projects, and the other two receive
the same non-disclosing denial for business content.

### BDD-AUTH-002 — assignment removal is immediate

Given an assigned Maintainer, when the authoritative assignment is removed,
then the next decision denies read, write, search, aggregate, file,
notification, and Realtime capabilities for that Project.

### BDD-PROJ-001 — global permanent slug reservation

Given two Projects, when a current or historical slug is claimed by one, then
claim or rename by the other is rejected even if the first Project is inactive.

### BDD-PROJ-002 — canonical and historical resolution

Given a Project renamed twice, when each slug is resolved, then the current slug
returns the Project and historical slugs redirect to the same Project's current
slug without accepting caller-supplied Workspace scope.

### BDD-PROJ-003 — neutral unavailable intake

Given an unknown or inactive Project slug, when public intake resolves it, then
the outcome is a neutral unavailable result, discloses no other identifier, and
accepts no intake.

## Local evidence matrix

- Two Workspaces and at least two Projects.
- Owner same/cross Workspace.
- Maintainer assigned/unassigned/removed/sibling/cross Workspace.
- Platform roles with no standing content capability.
- Current/history/collision/non-reassignment/inactive/unknown slug cases.
- Existing bilingual root no-enumeration and desktop/320 px browser cases.

The local matrix cannot mark the Appwrite-backed parent tasks done. Real Auth
principals, TablesDB ownership, row/file permissions, Realtime channels, and
deployed routes remain in the external evidence lane.
