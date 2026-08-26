# Stage 4 Definition of Ready — Provider and Upload Foundation

## Trace

- Tasks: local portion of `TASK-SRC-001` and `TASK-ATT-001`; incremental
  `TASK-SEC-001`.
- Requirements: `FR-OWN-008`, `FR-SRC-001..003`, `FR-SRC-006`,
  `NFR-SEC-001..006`, and `INV-SRC-001`.
- Architecture: section 13.1.
- Decision: `ADR-013`.

## Scope boundary

The local slice proves provider-neutral policy and a reproducible ingress probe.
It does not claim a GitHub App installation, GitLab OAuth grant, encrypted
production secret facility, deployed callback, or Appwrite Function limit.
Those acceptance results require the external evidence lane.

## Actors and trust boundaries

- Workspace Owner initiates and manages a Project-scoped connection.
- Maintainer, Reporter, cross-Workspace actor, and Platform Operator have no
  connection-administration capability.
- Trusted callback boundary binds one actor, Workspace, Project, provider,
  nonce digest, expiry, and safe relative return path.
- Provider adapter exposes only authorized repository identities and an opaque
  encrypted-grant reference.
- Upload probe sends deterministic 10 MiB content plus multipart overhead and
  reports only bounded transport facts.

## Prohibited data

Provider tokens, callback raw nonces, signing material, cookies, authorization
headers, repository content, Access Proofs, Reporter data, and response bodies
must not enter domain records, browser output, logs, probe results, or commits.

## BDD scenarios

### BDD-SRC-001 — Owner-only callback initiation

Given fixed actor responsibilities and an authoritative Project, when a
connection is initiated, then only an Owner in that Project's Workspace receives
an opaque callback state; unsafe return paths and other actors are denied.

### BDD-SRC-002 — callback binding and replay denial

Given an unexpired callback challenge, when completion supplies the exact actor,
provider, Project scope, and nonce, then it may create one connection; wrong,
expired, cross-scope, or replayed completion is denied.

### BDD-SRC-003 — explicit authorized repository selection

Given provider-authorized repository identities, when the Owner selects a
subset, then only that subset becomes usable; unselected, unavailable, or
cross-provider identities cannot be used.

### BDD-SRC-004 — suspension, reconnect, and revocation

Given an active connection, when it is suspended or disconnected, then provider
use stops immediately; only an Owner may reconnect, and disconnect invokes the
grant-revocation port exactly once without exposing the grant.

### BDD-ATT-001 — deterministic 10 MiB ingress probe

Given a fixed multipart boundary and exactly 10 MiB of file bytes, when the
probe is built, then total content length is larger than 10 MiB and stable; the
request includes no file or response content in its result.

### BDD-ATT-002 — safe transport outcome

Given an injectable Function endpoint, when the probe succeeds or fails, then
the result reports status, file byte count, total byte count, and acceptance
only; timeout and rejection disclose no response body or authorization value.

## Local evidence

- Owner/maintainer/operator/cross-Workspace matrix.
- Wrong nonce/provider/actor/scope, expiry, replay, and unsafe-return cases.
- Selected/unselected/provider-mismatch and lifecycle cases.
- Exact 10 MiB file bytes, deterministic overhead, success/rejection/timeout.
- Full repository gates and prohibited-data scan.

`TASK-SRC-001`, `TASK-ATT-001`, and Gate G1 remain blocked until the same
contracts pass against real non-production GitHub, GitLab.com, Appwrite, and
Vercel boundaries.

## Deployed provider callback tranche

### BDD-SRC-REAL-001 — trusted initiation

Given a real Appwrite JWT and an authoritative Project, when a connection is
initiated, then only the Workspace Owner receives a provider authorization URL
whose opaque one-use state is bound to that Owner, Workspace, Project,
provider, expiry, and safe return path. Missing, forged, Maintainer, and
cross-scope principals receive the same non-disclosing denial.

### BDD-SRC-REAL-002 — callback exchange and replay denial

Given a pending state, when GitHub or GitLab returns the matching state and
authorization code to the direct Preview Function domain, then the backend
exchanges the code, encrypts the grant in Appwrite, and records only immutable
authorized repository identities. Wrong, expired, cross-provider, malformed,
or replayed callbacks create no usable connection and disclose no grant.

### BDD-SRC-REAL-003 — explicit selection

Given the provider-authorized repository identities, when the initiating Owner
selects a subset through an authenticated command, then only that subset becomes
active. Empty, duplicate, unlisted, cross-provider, and cross-scope selections
are denied without changing the pending connection.

### BDD-SRC-REAL-004 — real revocation

Given an active real grant, when the owning Workspace Owner disconnects it,
then Y7 invokes the matching provider revocation endpoint, removes the encrypted
grant, and marks provider use disconnected. Retry and duplicate commands cannot
produce a false success or expose credentials.

### BDD-SRC-REAL-005 — prohibited-data boundary

Given every success and failure above, then responses, redirect targets,
structured logs, telemetry, browser storage, Git history, and curated evidence
contain no authorization code, access/refresh token, client secret, raw state
nonce, grant envelope, or provider response body.
