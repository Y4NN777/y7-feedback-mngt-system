# Stage 2 Definition of Ready — Environment and Observability

## Trace

- Tasks: local portions of `TASK-DEL-002`, `TASK-OBS-001`, and
  `TASK-VER-001`; incremental `TASK-SEC-001`.
- Requirements: `NFR-SEC-001`, `NFR-SEC-005..006`, `NFR-SLO-001..010`, and
  `NFR-EVO-001..005`.
- Architecture: sections 4.2, 5.3, 6.1, 17, and 18.
- Decisions: `ADR-001`, `ADR-011`, and `ADR-012`.

## Scope boundary

This stage implements every locally provable environment and observability
control. It does not fabricate Appwrite, Vercel, telemetry, domain, or monthly
SLO evidence. Parent tasks remain blocked until their operational acceptance
tests run against real non-production and production boundaries.

## Actors and ports

- Build/runtime bootstrap supplies public or trusted-server configuration.
- Trusted Function creates correlation context and emits safe structured events.
- Browser performance adapter emits minimized Web Vital measurements through a
  replaceable telemetry port.
- Synthetic probe checks only public root and trusted health outcomes.
- Telemetry sink receives allowlisted operational fields, never business
  payloads or credentials.

## Prohibited telemetry

No log, metric, trace, RUM event, probe output, client configuration, or build
asset may contain an Access Proof, API key, provider token, Attachment bytes,
Internal Note, contact, external Reporter identifier, Feedback source body, raw
request body, stack trace, or cookie/authorization value.

## BDD scenarios

### BDD-ENV-001 — valid public environment identity

Given a complete public configuration, when it is parsed, then only the
environment, matching backend environment, HTTPS Appwrite endpoint, public
Project ID, and release identifier are returned.

### BDD-ENV-002 — public configuration fails closed

Given missing values, a preview/production identity mismatch, a non-HTTPS
remote endpoint, or a secret-bearing `VITE_` key, when public configuration is
parsed, then startup is rejected with a stable non-secret error code.

### BDD-ENV-003 — trusted configuration remains server-only

Given trusted Function variables, when configuration is parsed, then an API
key is required, environment identities must match, and no server parser or
secret variable name is reachable from the public package export.

### BDD-ENV-004 — environments cannot share authority

Given two differently named environments, when their Appwrite identities are
compared, then sharing the same endpoint and Project ID is rejected.

### BDD-OBS-001 — request correlation

Given any trusted Function request, when it is handled, then one opaque
correlation ID appears in the response header and every emitted event for that
request.

### BDD-OBS-002 — structured telemetry is minimized

Given nested representative prohibited fields and allowed operational fields,
when an event is serialized, then only allowlisted fields remain and the output
contains no prohibited fixture payload.

### BDD-OBS-003 — RUM adapter exposes only Web Vital facts

Given an LCP, INP, or CLS observation, when the browser adapter emits it, then
the event contains only metric name, value, rating, navigation type,
environment, and release—without URL query, user, Workspace, Project, or
Feedback data.

### BDD-OBS-004 — deterministic synthetic probe

Given injectable HTTP responses, when the bilingual root and API health probe
runs, then it reports a bounded availability result; a timeout, non-200, wrong
health body, or missing language marker fails without response-body disclosure.

### BDD-VER-001 — host policy remains public-only

Given the Vercel and PWA configuration, when it is inspected and browser-tested,
then SPA fallback follows static asset resolution, HTML/manifest/service worker
revalidate, hashed assets are immutable, and no protected API response is
proxied or cached.

## Required test layers

- Unit tests for public/server configuration parsing and cross-environment
  comparison.
- Function tests for correlation, structured redaction, safe errors, and health.
- Browser/unit tests for minimized Web Vital mapping.
- Node contract tests for synthetic probe classification and Vercel policy.
- Existing build-asset secret scan and desktop/320 px browser suite.

## Local exit commands

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm test:e2e
pnpm security:scan
```

Local completion moves `TASK-OBS-001` to `IN PROGRESS`; it does not mark
`TASK-DEL-002`, `TASK-OBS-001`, or `TASK-VER-001` done without populated real
measurement series and deployed cross-environment/deep-link/cache evidence.
