# API restructuring plan

Status: `IN_PROGRESS`  
Baseline: `main@12ad8ac`  
Goal: replace the flat `functions/api/src` layout with capability-oriented
runtime, infrastructure, migration and tooling boundaries without observable
behavior changes.

## Ledger

| Order | Task             | Outcome                                                                    | Status                                                                                                                                      |
| ----: | ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | `TASK-ARCH-001A` | Architecture contract, baseline and progressive root guard                 | `DONE` — baseline `main@12ad8ac`, architecture boundary tests and migration contract                                                        |
|     2 | `TASK-ARCH-001B` | Runtime, HTTP, configuration, observability and focused composition roots  | `DONE` — runtime shell moved; 1,229-line application composition reduced to a 128-line assembler backed by six focused capability factories |
|     3 | `TASK-ARCH-001C` | Appwrite schema/control-plane migrations and removal of Day 4 source names | `DONE` — PR #151 rebase-merged at `a196788`; schema parity, protected Preview migration, Quality and deployed Browser gates green           |
|     4 | `TASK-ARCH-001D` | Intake and attachment capabilities with Appwrite adapters                  | `DONE` — PR #152 rebase-merged at `a2e92d1`; Quality, deployed Browser and Vercel gates green                                               |
|     5 | `TASK-ARCH-001E` | Conversation and Workbench capabilities                                    | `IN_REVIEW` — capability-owned contracts, runtime handlers and concrete Appwrite adapters moved; complete local gate green                  |
|     6 | `TASK-ARCH-001F` | Administration and platform-access capabilities                            | `BLOCKED_BY_001E`                                                                                                                           |
|     7 | `TASK-ARCH-001G` | GitHub/GitLab provider boundaries                                          | `BLOCKED_BY_001F`                                                                                                                           |
|     8 | `TASK-ARCH-001H` | Intelligence, privacy and abuse boundaries                                 | `BLOCKED_BY_001G`                                                                                                                           |
|     9 | `TASK-TEST-003A` | Verification, fixtures and provisioning tooling layout                     | `BLOCKED_BY_001H`                                                                                                                           |
|    10 | `TASK-ARCH-001I` | Final root cleanup, dead-code/cycle audit and parity proof                 | `BLOCKED_BY_TEST_003A`                                                                                                                      |

## Target

`src/main.ts` remains the only root production module. All other source lives
under `runtime`, `capabilities`, `infrastructure`, `migrations`, `tooling` or
`shared`. Tests remain beside their module; deployed verifiers live under
`tooling/verification`.

Every capability slice replaces planning-era `Day*`, `G*` and `D*` source names
with domain names. Deployed values remain unchanged behind explicit `legacy`
constants. The marker `day4-control-plane-v1` is compatibility data and must not
be rewritten.

## Delivery sequence

1. Establish the baseline and architecture test without moving behavior.
2. Move the runtime shell and split the 1,272-line composition root into
   capability factories without introducing a dependency bag.
3. Move schema and additive migrations, renaming Day 4 source symbols while
   preserving all table definitions and the deployed version marker.
4. Move intake/attachments, conversations/workbench,
   administration/platform-access, providers, and intelligence/privacy in that
   order. Each move includes its tests and concrete Appwrite adapters.
5. Move all verification/provisioning programs after runtime paths stabilize,
   keeping temporary pnpm aliases for CI and operational consumers.
6. Enforce an empty legacy root, remove obsolete aliases and prove route,
   schema, runtime artifact and command-surface parity.

## Invariants and gates

- No route, payload, status, `ERR-*`, authorization order or domain behavior changes.
- No Appwrite identifier, environment variable, secret, OAuth callback or resource changes.
- One short-lived task branch and atomic, green commits per slice.
- No generic repository, service locator, speculative abstraction or dependency addition.
- Full pnpm install, format, lint, typecheck, tests, coverage, build, E2E and security gates per PR.
- Preview evidence is required whenever composition, deployed tooling or an external boundary changes.
- Rebase merge only after protected checks pass; delete the remote task branch.

## Completion

The Goal is complete only when the legacy root contains only `main.ts`,
`application.ts` has been replaced by focused composition roots, planning-era
source names have disappeared, all compatibility inventories match, every PR is
merged, and all local/protected/required Preview evidence is green.
