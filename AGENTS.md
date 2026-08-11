# AGENTS.md — Engineering Contract

These repository-wide instructions govern all implementation work, including
the Day 1 and Day 2 Goal plan. They do not authorize development by themselves.

## 1. Repository and personal GitHub identity

The intended repository is owned by the personal GitHub account `Y4NN777`.
The locally configured origin is:

```text
git@github-personal:Y4NN777/y7-feedback-mngt-system.git
```

Before the first development commit, validate all four identity layers:

1. **Authentication:** `ssh -T git@github-personal` authenticates as
   `Y4NN777`.
2. **Destination:** `git remote get-url origin` returns the expected personal
   repository above.
3. **Attribution:** the repository-local `user.name` is `Y4NN777`, and
   `user.email` is an address verified by that GitHub account or its GitHub
   no-reply address. The literal address is never copied into curated session
   summaries or plans.
4. **Human authorship:** commits use the configured personal Git author. Never
   add `Co-Authored-By` or another machine-attribution trailer. This follows the
   Aïobi Messenger convention: the human operating the repository is the commit
   author; cryptographic GPG/SSH signing is optional and is not a delivery gate
   unless a future repository rule explicitly requires it.

Do not reuse organization, work, or alternate-account credentials. Do not
place SSH keys, signing keys, tokens, or credential-helper output in the
repository or curated session evidence.

Official references:

- [GitHub repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)

## 2. Branch and pull-request strategy

`main` is always releasable and receives no direct development commit.

Use one short-lived branch per reviewable task slice:

```text
task/TASK-DEL-001-delivery-spine
task/TASK-OWN-001-scope-policy
task/TASK-PROJ-001-project-routing
task/TASK-REP-001-reporter-attribution
```

Rules:

- branch from the latest validated `main`;
- keep one task or one tightly coupled vertical slice per branch;
- open a pull request into `main` from the personal account;
- link the task, requirements, scenarios, risks, and evidence in the pull
  request description;
- require the complete CI gate before merge;
- use linear history and preserve meaningful atomic commits;
- do not merge a branch containing fixup, temporary, generated, or failing
  commits;
- delete the remote task branch after merge;
- never force-push `main`; use `--force-with-lease` on a private task branch
  only when cleaning unreviewed local history.

Configure the strongest repository ruleset supported by the repository:

- pull request required before merge;
- required status checks;
- linear history;
- no force push or branch deletion for `main`;
- no bypass during the Day 1/Day 2 Goal.

If a personal-account repository setting cannot enforce one of these rules,
record that limitation and enforce the same rule through local checks and CI.

## 3. Atomic commit strategy

An atomic commit expresses one coherent, independently reviewable behavior or
structural change. It must be safe to revert without leaving unrelated work
half-reverted.

Every commit must:

- have one reason to change;
- include the behavior, tests, documentation, and configuration needed to keep
  that behavior green;
- leave install, format, lint, typecheck, relevant tests, and build passing;
- contain no unrelated rename, formatting sweep, dependency update, or cleanup;
- contain no generated evidence, secret, local environment file, or editor
  state;
- trace to at least one sprint task and requirement or architecture decision;
- be attributed to the personal GitHub account with no machine co-author
  trailer. Cryptographic signing may be used when configured, but its absence
  is not a failure.

Use Conventional Commits:

```text
<type>(<scope>): <imperative outcome>

Task: <TASK-ID>
Requirements: <requirement/invariant/ADR IDs>
Evidence: <commands or evidence path>
```

Allowed types:

- `feat` — product or domain behavior;
- `fix` — correction of verified behavior;
- `test` — independently useful passing test coverage;
- `refactor` — behavior-preserving structure;
- `perf` — measured performance improvement;
- `docs` — documentation or evidence only;
- `build` — dependencies or build system;
- `ci` — CI or repository automation;
- `chore` — repository maintenance with no product behavior.

Preferred scopes are `repo`, `web`, `domain`, `api`, `auth`, `routing`,
`intake`, `attachments`, `providers`, `observability`, and `e2e`.

Examples:

```text
build(repo): establish pnpm workspace quality gates
feat(domain): deny project access outside derived workspace scope
feat(routing): preserve historical project slugs as redirects
test(api): cover indistinguishable accountless access denial
```

TDD does not require a failing commit. Run and record the red test locally,
implement the smallest green change, refactor while green, and commit the
complete atomic outcome. Temporary commits may be created locally, but must be
autosquashed or rewritten into meaningful green commits before review.

## 4. Development methodology

Work uses outside-in BDD to define observable behavior and TDD to implement
each behavior.

### 4.1 Definition of Ready

Do not start a task until it has:

- task ID and requirement/invariant/ADR trace;
- explicit actor, scope, preconditions, command, and observable result;
- positive, authorization-denial, validation, retry, and failure examples as
  applicable;
- named trust boundary and prohibited-data list;
- deterministic fixtures and required real-service evidence identified;
- dependency and blocker state resolved.

### 4.2 BDD — define behavior first

For each requirement slice:

1. write a short behavior matrix using `Given / When / Then` semantics;
2. name every scenario with its use-case, error, or invariant ID;
3. cover the normal outcome and the meaningful denial/failure outcomes;
4. agree that the scenarios express the requirement without implementation
   detail;
5. automate the scenarios at the lowest layer that proves the behavior, with a
   small E2E set for critical actor journeys.

Example:

```gherkin
Scenario: INV-ACCESS-001 reference alone does not authorize retrieval
  Given an accepted Feedback with a reference and independent proof
  When a Reporter requests it with the reference only
  Then access is denied
  And the response does not reveal whether the reference exists
```

### 4.3 TDD — red, green, refactor

For each scenario:

1. **Red:** add the smallest meaningful automated test and run it to confirm it
   fails for the expected missing behavior, not for broken setup.
2. **Green:** implement the smallest production behavior that passes the test.
3. **Refactor:** improve names, boundaries, duplication, and design while the
   complete relevant suite stays green.
4. **Integrate:** run contract/integration checks across the next boundary.
5. **Commit:** create one human-attributed atomic commit only after all commit
   gates pass; add no machine co-author trailer.

Run red and green validations through the active Codex session so its generated
rollout transcript captures the commands and results. Summarize the final
evidence in the curated session summary. Never append evidence manually to the
raw Codex JSONL. Do not commit deliberately failing tests to the shared branch.

### 4.4 Vertical delivery

Prefer thin end-to-end behavior slices over layer-wide batches. A slice should
connect the appropriate domain policy, trusted Function contract, adapter,
projection/UI, and tests before moving to the next behavior.

Mocks or in-memory adapters may drive TDD, but cannot satisfy a task whose
acceptance evidence requires Appwrite, Vercel, GitHub, or GitLab. Such a task
remains `BLOCKED` until the real non-production check passes.

## 5. Architecture and coding standards

### 5.1 Boundaries

- `packages/domain` contains pure domain values, policies, commands, results,
  and ports. It imports no React, Appwrite SDK, provider SDK, browser API, or
  framework runtime.
- `functions/*` owns trusted orchestration and adapters. Every protected read or
  mutation derives Workspace/Project scope server-side before data access.
- `apps/web` owns interaction and projections. It performs no direct domain
  write to TablesDB or Storage; direct Appwrite use is limited to Auth session
  handling and authorized Realtime invalidation.
- Appwrite is authoritative. Browser cache, IndexedDB, and UI state never claim
  server acceptance.
- Provider adapters translate provider details at the boundary; GitHub/GitLab
  concepts do not leak into the core domain.

### 5.2 SOLID design principles

Apply SOLID at domain and architectural boundaries. Use it to keep behavior
testable and change-safe, not to manufacture abstractions without a concrete
variation or dependency.

#### Single Responsibility Principle

- Give each module one cohesive responsibility and one primary reason to
  change.
- Separate domain decisions, orchestration, persistence, provider translation,
  transport parsing, and rendering.
- Keep authorization, validation, idempotency, and redaction as explicit
  policies instead of incidental controller logic.
- Split a module when unrelated actors or requirements cause it to change; do
  not split merely to reduce line count.

#### Open/Closed Principle

- Extend supported providers, notification channels, validation strategies, or
  projections through stable ports and explicit implementations.
- Keep core invariants closed to adapter-specific modification. Adding GitLab
  behavior must not alter GitHub or core Feedback semantics.
- Use exhaustive domain types and versioned contracts. A new domain state or
  Feedback type requires an intentional compiler-visible update to every
  affected policy; it must never fall through silently.
- Prefer composition over inheritance.

#### Liskov Substitution Principle

- Every adapter must honor the complete semantic contract of its port,
  including errors, idempotency, authorization assumptions, ordering, and
  failure behavior.
- An in-memory test adapter must not be more permissive than the real adapter in
  ways that invalidate acceptance evidence.
- Run the same contract suite against in-memory and real non-production
  implementations wherever substitution is claimed.
- Never weaken preconditions, strengthen caller obligations, or hide failure in
  a subtype/implementation.

#### Interface Segregation Principle

- Define small capability-focused ports around use cases, such as reading a
  Project, committing intake, staging an Attachment, or publishing an outbox
  item.
- Do not create repository, service, or SDK-wrapper interfaces that expose
  unrelated operations to every caller.
- Give each trusted Function and adapter only the port methods and credentials
  it needs.
- Split read, write, administration, provider, and exceptional-access
  capabilities when their authorization or failure contracts differ.

#### Dependency Inversion Principle

- The domain owns its ports; Appwrite, browser, email, telemetry, GitHub, and
  GitLab adapters implement them from outer layers.
- High-level policies depend on domain contracts, never directly on SDK clients
  or environment globals.
- Construct concrete adapters only in composition roots. Pass dependencies
  explicitly into use cases.
- Keep frameworks replaceable at the boundary without pretending that all
  infrastructure semantics are identical.

SOLID compliance must remain pragmatic:

- introduce an interface only when it protects a boundary, enables a required
  substitution, or isolates a nondeterministic dependency;
- avoid speculative base classes, generic repositories, service locators, and
  one-method wrappers with no policy value;
- favor clear duplication over an incorrect shared abstraction, then refactor
  when the common contract is demonstrated by real use cases;
- prove boundary direction and substitutability with tests, not naming alone.

### 5.3 TypeScript

- Enable the strict TypeScript family, including unchecked-index and exact
  optional-property checks.
- Do not use `any`. Boundary data begins as `unknown` and is parsed into a
  validated type.
- Model commands and results with discriminated unions; make invalid states
  difficult to represent.
- Use opaque/branded identifiers where accidental cross-ID use is possible.
- Inject clock, ID, random, hashing, storage, and provider behavior through
  explicit ports so tests remain deterministic.
- Use UTC ISO-8601 timestamps at external boundaries.
- Exhaustively handle unions. A default branch must fail closed, not silently
  accept a new state.
- Keep modules cohesive and public exports deliberate. Avoid circular imports
  and cross-layer relative imports.

### 5.4 React and browser code

- Use semantic HTML before ARIA; every control has an accessible name and
  keyboard behavior.
- Keep FR/EN strings in typed message catalogs, not duplicated inside feature
  components.
- Preserve form state during locale changes.
- Never use color alone to convey state.
- Support 320 CSS pixels without horizontal content loss.
- TanStack Query owns remote projections; React owns transient render state;
  IndexedDB owns versioned drafts/outbox where specified.
- Never place Access Proofs in URLs, analytics, error reports, Cache Storage, or
  implicit persistent browser storage.
- Avoid effect-driven derived state and unstable list keys.

### 5.5 Trusted API and security

- Parse and validate every request at the boundary before authorization or
  persistence.
- Authenticate or validate proof, derive scope, authorize action, then access
  data—in that order.
- Return typed, stable, non-disclosing errors mapped to documented `ERR-*`
  outcomes.
- Require idempotency keys for retryable mutations and payload-hash conflicts
  for key reuse.
- Use transactions for facts that must become visible atomically.
- Use structured logging with allow-listed fields; redact by construction rather
  than by best-effort string replacement.
- Never log contact data, external identifiers, Access Proofs, Internal Notes,
  Attachment content/URLs, credentials, or provider tokens.
- Keep secrets server-only and prohibit secret-bearing `VITE_*` variables.
- Deny by default when identity, scope, audience, provider authority, or grant
  state cannot be verified.

### 5.6 Formatting, linting, and dependencies

- Use pnpm with a committed `pnpm-lock.yaml` and pinned package-manager version.
- Use one root command surface for format, lint, typecheck, test, build, E2E,
  coverage, and security checks.
- Enforce one deterministic formatter and TypeScript/React/accessibility lint
  rules in CI. Do not mix formatting changes with behavior changes.
- Add the smallest dependency that materially reduces risk or complexity.
- Pin automation actions and review production dependency changes explicitly.
- Commit no build output, coverage output, local database, test report, or
  environment file.

## 6. Test strategy

Tests prove behavior at progressively wider boundaries:

1. **Domain unit/property tests:** invariants, state transitions, parsing,
   idempotency decisions, scope policy, slug history, proof policy, and file
   manifest policy.
2. **Function contract tests:** request parsing, authentication/proof,
   authorization order, errors, redaction, and response/cache contract.
3. **Adapter integration tests:** real non-production Appwrite transaction,
   Storage, Realtime, GitHub, GitLab, and later provider boundaries.
4. **React component tests:** semantics, user actions, locale preservation,
   status truthfulness, and error recovery.
5. **Browser E2E:** critical Reporter and Workspace journeys in FR/EN and at
   desktop/320 px viewports.
6. **Operational fitness tests:** deployed isolation, ingress, cache headers,
   secret scans, retries, provider revocation, and orphan reconciliation.

Rules:

- name tests after observable outcomes, not method names;
- use Arrange/Act/Assert internally and Given/When/Then at behavior level;
- keep clock, IDs, random values, and fixtures deterministic;
- do not use snapshots as primary acceptance evidence;
- mock only true boundaries; test domain policies directly;
- include a negative authorization case for every protected operation;
- include response-loss retry for every idempotent operation;
- include forced failure at each atomicity boundary;
- require 100% branch coverage for authorization, proof, idempotency,
  lifecycle-transition, and Attachment acceptance policies;
- require at least 90% branch and statement coverage across changed production
  modules; coverage never substitutes for scenario completeness.

## 7. Quality gates

### Before an atomic commit

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test --filter <affected-workspace>
```

### Before opening or updating a pull request

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

### Before marking a sprint task `DONE`

- the complete requirement-specific behavior matrix passes;
- real-service evidence passes when required;
- the pull request is merged with a clean atomic history;
- the Codex-generated raw session snapshot exists locally and the curated
  summary records commands, outcomes, commit SHA, and evidence;
- the session summary links the evidence and lists remaining blockers;
- the Goal progress ledger is updated.

## 8. Review checklist

Every pull request answers these questions:

- Is the change traceable to task and requirement IDs?
- Does each changed module have one cohesive responsibility?
- Do dependencies point inward toward domain-owned contracts?
- Are ports capability-focused, and do alternate adapters pass the same
  contract tests?
- Is each new abstraction justified by a real boundary or variation?
- Does scope come from authoritative server records?
- Are denial and failure outcomes non-disclosing and tested?
- Can retry create a duplicate or false success?
- Can protected data reach logs, caches, email, provider payloads, or the wrong
  audience?
- Does FR/EN switching preserve user input?
- Is the flow keyboard-operable, screen-reader meaningful, non-color dependent,
  and usable at 320 px?
- Can the change be reverted independently?
- Does the commit history contain only meaningful green atomic commits?

## 9. Session evidence protocol

`docs/sessions/raw/` contains byte-for-byte snapshots of the JSONL rollout files
generated by Codex for the corresponding sessions.

Raw transcript rules:

- locate the active Codex rollout by session identity and repository `cwd`;
- preserve the original `rollout-*.jsonl` basename;
- copy the source file without transformation at session handoff/end;
- never create, append, edit, normalize, redact, merge, or reconstruct raw
  JSONL by hand;
- verify the snapshot against the source with a byte comparison or checksum;
- replace an earlier snapshot only with a newer byte-for-byte snapshot of the
  same source rollout;
- keep raw transcripts excluded from Git because they can contain prompts,
  tool outputs, filesystem metadata, identity data, or secrets;
- if the original Codex rollout is unavailable, record `raw unavailable` in the
  curated summary instead of fabricating a substitute.

`docs/sessions/<date>-summary.md` records the Goal, completed work, validation
results, commit/PR references, open blockers, and exact next action.

The curated summary must reference the copied rollout basename but must not
duplicate sensitive raw content. The Goal plan remains the authoritative
progress ledger. Session artifacts supply evidence; they do not redefine
requirements or mark work complete by assertion.

## 10. Pre-development approval checklist

Development may begin only after all items below are agreed:

- [ ] The active Goal scope and its acceptance gates are complete.
- [ ] Task sequencing and blocker rules are accepted.
- [ ] Personal GitHub identity, remote, human-authorship, and branch policy are
      verified.
- [ ] Atomic commit format and pull-request strategy are accepted.
- [ ] BDD/TDD workflow and test thresholds are accepted.
- [ ] Architecture, SOLID principles, and coding standards are accepted.
- [ ] pnpm and the required quality command surface are accepted.
- [ ] Session evidence protocol is accepted.
