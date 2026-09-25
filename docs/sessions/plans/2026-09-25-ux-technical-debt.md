# UX coherence and technical-debt reduction plan

Status: `READY_FOR_IMPLEMENTATION`  
Prepared: 2026-09-25  
Baseline: `main@74f16050e5d60f75409afa539e2529a9f88458ec`

## Goal

Make Y7 Feedback feel like one finished product and reduce the concentrated structural debt that slows safe delivery, without rewriting working behavior or weakening the existing security, coverage, and real-service evidence.

## Source evidence

- UX/design review: `~/.gstack/projects/Y4NN777-y7-feedback-mngt-system/designs/design-audit-20260925/design-review.md`
- Technical audit: `~/.gstack/projects/Y4NN777-y7-feedback-mngt-system/technical-audit-20260925.md`
- Health logs: `~/.gstack/projects/Y4NN777-y7-feedback-mngt-system/health/`

## Delivery rules

- One short-lived `task/<TASK-ID>-<slug>` branch per slice, based on current `main`.
- Outside-in BDD and TDD; record the red run locally, commit only complete green behavior.
- Rebase merge only after the full PR gate passes; delete the remote branch.
- No broad formatting sweep, speculative abstraction, or mass rename.
- Every refactor must preserve public contracts, authorization order, idempotency, redaction, and deployed identifiers unless an explicit migration is included.

## Prioritized task ledger

| Order | Task | Priority | Outcome | Depends on | Validation |
|---:|---|---|---|---|---|
| 1 | `TASK-UX-002` | P1 | Document the current visual tokens and approve one product shell with public and operational density variants | none | `DONE` — BDD matrix, semantic tokens, Organic direction, green accessibility/token contract, and rendered 375/768/1280 evidence |
| 2 | `TASK-UX-003` | P1 | Apply the shared shell to Home, Retrieve, sign-in, and invalid-project recovery | UX-002 | Playwright visual/semantic assertions; no horizontal loss; first action visible at 768 px height |
| 3 | `TASK-UX-004` | P1 | Redesign the complete Reporter journey from project entry through intake, success, retrieval, and conversation | UX-003 | UC Reporter matrix in FR/EN, desktop/320 px, offline/retry/error states |
| 4 | `TASK-ARCH-001` | P1 | Decompose API composition by stable capabilities while keeping one Appwrite Function | none | composition contract tests; all route registries exhaustive; API coverage and Preview smoke unchanged |
| 5 | `TASK-ARCH-002` | P1 | Split `FeedbackIntake` by form, attachments, offline/replay, and accepted-result ownership | UX-002 | component tests per state owner; intake E2E and accessibility gates unchanged |
| 6 | `TASK-ARCH-003` | P1 | Split `WorkbenchPage` by inbox, detail, actions, notifications, and provider panels | UX-002 | role-denial tests, workbench E2E, focus/keyboard behavior, realtime invalidation |
| 7 | `TASK-TEST-002` | P1 | Create a coverage-exclusion ledger and replace unjustified whole-file/large-region ignores | ARCH-001 | every remaining ignore has category, owner, external evidence, and review date; thresholds stay green |
| 8 | `TASK-DATA-001` | P2 | Extract query/serialization mechanics from the largest Appwrite stores without generic repositories | ARCH-001 | same contract suite against old characterization and extracted adapters; transaction/failure tests |
| 9 | `TASK-NAME-001` | P2 | Replace planning-era `G*`, `D*`, and `Day*` names with capability names | ARCH-001, TEST-002 | compile-visible rename map; external IDs aliased/migrated; docs/scripts/CI updated atomically |
| 10 | `TASK-TEST-003` | P2 | Split oversized verifier and test programs by observable capability | TEST-002 | identical scenario inventory and cleanup guarantees; full local and protected gates pass |
| 11 | `TASK-UX-005` | P2 | Apply the shared shell and interaction grammar to authenticated team journeys | UX-003, ARCH-003 | Owner/Maintainer/Platform flows, FR/EN, 320 px, keyboard and screen-reader checks |
| 12 | `TASK-PERF-001` | P3 | Measure and reduce route startup cost after structural work | ARCH-001, ARCH-002, ARCH-003 | before/after cold and warm timings; bundle budgets; no speculative optimization |

## Task definitions

### `TASK-UX-002` — product shell and tokens

Given the current split visual language, when a designer/developer opens the approved reference, then typography, colors, spacing, corners, borders, focus states, and responsive density are explicit for both public and operational contexts.

Deliverables:

- token inventory and semantic names;
- shared header/navigation behavior;
- representative Home, Retrieve, Reporter form, team sign-in, and not-found compositions;
- no production rollout until the rendered comparison is accepted.

### `TASK-UX-003` — entry-surface coherence

Given a user transitions between anonymous entry routes, when each route renders, then it is visibly one product, names the current task, exposes one primary action, and provides a clear recovery path.

Required negative cases: missing project, invalid reference/proof, backend unavailable, and direct protected-route entry.

### `TASK-ARCH-001` — capability composition

Given the existing route registries, when a request is composed, then only the required capability dependencies are created and the root contains no domain-specific orchestration.

Candidate capability modules: intake, attachments, administration, conversations/workbench, providers, intelligence/privacy, platform access, operations/recovery.

Stop condition: do not introduce a service locator or generic dependency bag.

### `TASK-TEST-002` — honest coverage

Given every coverage exclusion, when the ledger is generated and reviewed, then its reason and proving evidence are explicit. Whole-file exclusions require a demonstrated live-only boundary; otherwise add a contract seam and tests.

The goal is trustworthy evidence, not a lower or cosmetically perfect percentage.

### `TASK-NAME-001` — capability nomenclature

Proposed mappings:

| Planning-era name | Stable capability name |
|---|---|
| `appwrite-day4-migration` | `appwrite-control-plane-schema` |
| `createDay4TableDefinitions` | `createControlPlaneTableDefinitions` |
| `g5-preview` | `recovery-preview` or `acceptance-preview` based on actual responsibility |
| G1 intake labels | intake acceptance |
| G2 attachment labels | attachment acceptance |
| G3 labels | team workflow acceptance |
| G4 labels | control-plane acceptance |
| G5 labels | recovery/release acceptance |

Migration rule: source symbols and human-facing evidence can change directly; deployed environment/resource identifiers change only with an additive compatibility plan.

## Release sequence

### Milestone A — coherent entry experience

Tasks: UX-002, UX-003.  
Exit: the four anonymous/entry surfaces look and behave like one responsive product.

### Milestone B — safer change boundaries

Tasks: ARCH-001, ARCH-002, ARCH-003, TEST-002.  
Exit: composition and the two largest frontend features have capability boundaries, with no behavior regression and an auditable exclusion surface.

### Milestone C — stable language and adapters

Tasks: DATA-001, NAME-001, TEST-003.  
Exit: planning abbreviations no longer define durable modules, shared verifier mechanics are evidence-based, and deployed compatibility is preserved.

### Milestone D — finished journeys and measured performance

Tasks: UX-004, UX-005, PERF-001.  
Exit: Reporter and team journeys are visually complete, accessible, responsive, and measured in deployed Preview.

## Global completion gates

- full repository quality commands from `AGENTS.md` pass;
- changed production modules meet coverage thresholds without new unjustified ignores;
- Reporter and team BDD matrices pass in FR/EN at desktop and 320 px;
- real Preview checks pass for every touched Appwrite/provider boundary;
- no regression in bundle budgets, authorization denial, idempotency, redaction, or cleanup;
- each task lands as a reviewable atomic PR with a clean history.

## Explicitly out of scope

- replacing Appwrite;
- splitting the single Function deployment solely for aesthetics;
- deleting functions without dead-code or behavior evidence;
- rewriting the application or design system in one PR;
- renaming deployed resources without a compatibility migration.

## Exact next action

Start `TASK-UX-002` on `task/TASK-UX-002-product-shell`: create a rendered token/shell proposal from the existing warm editorial direction, compare the five representative surfaces at 375/768/1280 px, and obtain acceptance before changing production components.
