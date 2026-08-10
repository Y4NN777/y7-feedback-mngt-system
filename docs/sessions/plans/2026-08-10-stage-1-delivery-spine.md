# Stage 1 Definition of Ready — Delivery Spine

## Trace

- Tasks: `TASK-DEL-001`, foundation of `TASK-TEST-001`, incremental
  `TASK-SEC-001` and `TASK-UX-001`.
- Requirements: `NFR-CON-001..004`, `NFR-UX-001..006`,
  `NFR-EVO-001..005`.
- Architecture: sections 4.1, 4.2, 5.1, 5.3, and 6.2.
- Decisions: `ADR-001`, `ADR-002`, `ADR-012`.

## Actors and boundaries

- Developer: installs, checks, tests, builds, and runs the system from a clean
  checkout.
- Public visitor: reaches the bilingual root without Project enumeration.
- Trusted Function caller: receives an explicit health response or a
  non-disclosing fail-closed result.
- Browser/Vercel boundary: serves only static shell assets and never embeds a
  server or provider secret.
- Appwrite boundary: remains behind the trusted Function package; the browser
  performs no direct domain write.

## Determinism

- Node and pnpm versions are pinned by repository metadata.
- Tests use no network, current clock, random identifier, external account, or
  production service.
- Browser tests run against the built local application.
- Real Appwrite and Vercel evidence belongs to Stage 2 and remains separate from
  this local foundation proof.

## Prohibited data

The source, logs, test output, PWA cache, and client bundle must contain no:

- Appwrite server key;
- GitHub or GitLab token/secret;
- Access Proof or proof verifier;
- Reporter contact/external identifier;
- Internal Note;
- Attachment content or private URL.

## BDD scenarios

### BDD-DEL-001 — reproducible workspace

Given a clean checkout with the committed pnpm lockfile, when the developer
runs the frozen install, typecheck, tests, and build, then every workspace
completes without an undeclared dependency or generated source change.

### BDD-DEL-002 — explicit application boundaries

Given the repository workspace, when its package graph is inspected, then the
React application, pure domain package, and trusted Function package are
separate named workspaces with explicit scripts.

### BDD-API-001 — non-cacheable health

Given the trusted Function entrypoint, when `GET /health` is invoked, then it
returns status 200 with `{ "status": "ok" }` and `Cache-Control: no-store`.

### BDD-API-002 — unknown operation fails closed

Given the trusted Function entrypoint, when an unknown method/path is invoked,
then it returns a non-disclosing 404 result with `Cache-Control: no-store`.

### BDD-ROOT-001 — French root orientation

Given the default French root, when a visitor opens `/`, then the page presents
exactly the three approved intents—give feedback via a supplied Project link,
retrieve existing Feedback, and enter Workspace management—without search,
Project list, or Workspace list.

### BDD-ROOT-002 — English root orientation

Given a visitor on the root, when English is selected by keyboard, then the
same three intents are presented in English and the document language becomes
`en` without navigation or fabricated Project data.

### BDD-PWA-001 — safe shell caching

Given a production build, when the PWA manifest and service worker are
generated, then only versioned public shell/localization/font assets are
precache candidates, `/api/*` is excluded, and no protected runtime response is
cached.

### BDD-SEC-001 — client secret exclusion

Given prohibited secret names and representative sentinel values, when source
and built assets are scanned, then the scan fails on any match and passes on the
approved application shell.

### BDD-UX-001 — accessible 320 px root

Given the built root at a 320 CSS pixel viewport, when a visitor navigates all
interactive controls by keyboard, then focus remains visible, all controls have
accessible names, state meaning is not color-only, axe reports no serious or
critical violation, and no horizontal page overflow occurs.

## Required test layers

- Node structural acceptance test for workspace topology and root command
  surface.
- Vitest domain unit tests including an invalid-locale negative case.
- Vitest trusted Function contract tests including fail-closed behavior.
- React Testing Library component tests for both locales and no enumeration.
- Playwright browser tests for FR/EN, keyboard, axe, PWA artifacts, and 320 px.
- Static security scan over source and built assets.

## Stage exit commands

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

Stage 1 is complete only when every command passes and the Goal progress ledger
links the resulting evidence. Passing Stage 1 does not claim the deployed
Appwrite/Vercel evidence required by later Day 1 tasks.
