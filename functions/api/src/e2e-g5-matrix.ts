export interface E2eG5Scenario {
  readonly id: string;
  readonly requirementIds: readonly string[];
  readonly actor: string;
  readonly fixtureOwner: string;
  readonly environment: "local_browser" | "appwrite_preview";
  readonly positiveOracle: string;
  readonly negativeOracle: string;
  readonly cleanupOracle: string;
  readonly evidenceCommand: string;
}

const previewCleanup =
  "The verifier removes every request-owned row, file, user, session and provider fixture.";
const browserCleanup =
  "Playwright closes the isolated browser context and leaves no protected cache or persisted proof.";

const useCases: readonly E2eG5Scenario[] = [
  {
    id: "UC-01",
    requirementIds: ["UC-01", "FR-PROJ-002", "FR-PROJ-003"],
    actor: "Reporter",
    fixtureOwner: "apps/web/e2e/root.spec.ts",
    environment: "local_browser",
    positiveOracle:
      "Current and historical slugs resolve to the intended Project in FR and EN.",
    negativeOracle:
      "An unavailable route reveals neither another Project nor the requested slug.",
    cleanupOracle: browserCleanup,
    evidenceCommand: "pnpm verify:e2e:g5:browser",
  },
  {
    id: "UC-02",
    requirementIds: ["UC-02", "FR-FDB-001", "FR-CTX-001"],
    actor: "Reporter",
    fixtureOwner: "functions/api/src/verify-appwrite-deployed-g1.ts",
    environment: "appwrite_preview",
    positiveOracle: "A valid Bug, Suggestion or Review is durably accepted once.",
    negativeOracle: "Invalid type or Context input creates no acceptance fact.",
    cleanupOracle: previewCleanup,
    evidenceCommand: "pnpm verify:appwrite:deployed:g1:domain",
  },
  {
    id: "UC-03",
    requirementIds: ["UC-03", "FR-ATT-001", "FR-ATT-009"],
    actor: "Reporter",
    fixtureOwner: "functions/api/src/verify-appwrite-g2-attachment.ts",
    environment: "appwrite_preview",
    positiveOracle:
      "Permitted evidence is scanned, accepted and retrievable by its authorized audience.",
    negativeOracle: "Rejected evidence produces no accepted Feedback or Attachment.",
    cleanupOracle: previewCleanup,
    evidenceCommand: "pnpm verify:appwrite:g2:attachments",
  },
  {
    id: "UC-04",
    requirementIds: ["UC-04", "FR-ACC-001", "FR-ACC-004"],
    actor: "Reporter",
    fixtureOwner: "functions/api/src/verify-appwrite-deployed-g1.ts",
    environment: "appwrite_preview",
    positiveOracle:
      "Durable acceptance returns a reference and an independent accountless Access Proof.",
    negativeOracle: "A reference alone never authorizes protected retrieval.",
    cleanupOracle: previewCleanup,
    evidenceCommand: "pnpm verify:appwrite:deployed:g1:domain",
  },
  {
    id: "UC-05",
    requirementIds: ["UC-05", "FR-CONV-001", "FR-LIFE-001"],
    actor: "Reporter and Project Maintainer",
    fixtureOwner: "functions/api/src/verify-appwrite-g3-conversation-lifecycle.ts",
    environment: "appwrite_preview",
    positiveOracle:
      "Reporter-visible conversation and lifecycle changes preserve original submission history.",
    negativeOracle: "Internal Notes never enter the Reporter projection.",
    cleanupOracle: previewCleanup,
    evidenceCommand: "pnpm verify:appwrite:g3:conversation-lifecycle",
  },
  {
    id: "UC-06",
    requirementIds: ["UC-06", "FR-PRIV-001", "FR-PRIV-004"],
    actor: "Reporter",
    fixtureOwner: "functions/api/src/verify-appwrite-g4-privacy.ts",
    environment: "appwrite_preview",
    positiveOracle:
      "An authorized deletion request applies the documented deletion lifecycle.",
    negativeOracle:
      "Deleted identity and content remain unavailable and cannot be resurrected by restore.",
    cleanupOracle: previewCleanup,
    evidenceCommand: "pnpm verify:appwrite:g4:privacy",
  },
  {
    id: "UC-07",
    requirementIds: ["UC-07", "FR-OPS-002", "FR-OPS-010"],
    actor: "Workspace Owner",
    fixtureOwner: "functions/api/src/verify-appwrite-g3-admin.ts",
    environment: "appwrite_preview",
    positiveOracle:
      "The Owner manages Projects, slugs, activation and Maintainer assignments through Y7.",
    negativeOracle: "A non-Owner cannot perform an administrative mutation.",
    cleanupOracle: previewCleanup,
    evidenceCommand: "pnpm verify:appwrite:g3:admin",
  },
  {
    id: "UC-08",
    requirementIds: ["UC-08", "FR-OPS-004", "FR-LIFE-003"],
    actor: "Project Maintainer",
    fixtureOwner: "functions/api/src/verify-appwrite-g3-workbench.ts",
    environment: "appwrite_preview",
    positiveOracle:
      "An assigned Maintainer can work Feedback through the authorized Workbench actions.",
    negativeOracle:
      "Unassigned and cross-Project actors receive a non-disclosing denial.",
    cleanupOracle: previewCleanup,
    evidenceCommand: "pnpm verify:appwrite:g3:workbench",
  },
  {
    id: "UC-09",
    requirementIds: ["UC-09", "FR-NOT-001", "FR-NOT-005"],
    actor: "Reporter and authorized workspace actor",
    fixtureOwner: "functions/api/src/verify-appwrite-g3-workbench.ts",
    environment: "appwrite_preview",
    positiveOracle:
      "A source event becomes visible to each eligible in-product and email recipient.",
    negativeOracle:
      "An ineligible or foreign audience receives no notification content.",
    cleanupOracle: previewCleanup,
    evidenceCommand: "pnpm verify:appwrite:g3:notifications",
  },
  {
    id: "UC-10",
    requirementIds: ["UC-10", "FR-INT-001", "FR-INT-009"],
    actor: "Authorized workspace actor",
    fixtureOwner: "functions/api/src/verify-appwrite-g4-intelligence.ts",
    environment: "appwrite_preview",
    positiveOracle:
      "Authorized actors filter, relate and compare only current in-scope source Feedback.",
    negativeOracle:
      "Cross-Workspace and deleted facts never enter intelligence results.",
    cleanupOracle: previewCleanup,
    evidenceCommand: "pnpm verify:appwrite:g4:intelligence",
  },
  {
    id: "UC-11",
    requirementIds: ["UC-11", "FR-OPS-011", "FR-SEC-009"],
    actor: "Platform Operator",
    fixtureOwner: "functions/api/src/verify-appwrite-g4-platform-access.ts",
    environment: "appwrite_preview",
    positiveOracle:
      "A justified, approved, scoped and time-bounded grant permits only the requested operation.",
    negativeOracle:
      "Standing, self-approved, expired or out-of-scope business-content access is denied and audited.",
    cleanupOracle: previewCleanup,
    evidenceCommand: "pnpm verify:appwrite:g4:platform-access",
  },
  {
    id: "UC-12",
    requirementIds: ["UC-12", "FR-SRC-001", "FR-SYNC-001"],
    actor: "Workspace Owner and assigned Project Maintainer",
    fixtureOwner: "functions/api/src/verify-preview-provider-state-sync.ts",
    environment: "appwrite_preview",
    positiveOracle:
      "A selected GitHub or GitLab repository receives one linked issue and synchronized state.",
    negativeOracle:
      "Internal Notes, Access Proofs, Attachments and Reporter identifiers never reach the provider.",
    cleanupOracle: previewCleanup,
    evidenceCommand: "pnpm verify:providers:g4:state-sync",
  },
];

type ErrorScenarioSeed = readonly [
  id: string,
  requirementId: string,
  actor: string,
  fixture: string,
  outcome: string,
  evidenceCommand: string,
  environment: E2eG5Scenario["environment"],
];

const errors: readonly E2eG5Scenario[] = (
  [
    [
      "ERR-001",
      "FR-PROJ-002",
      "Reporter",
      "verify-appwrite-deployed-g1.ts",
      "Project resolution is rejected without disclosure or writes.",
      "pnpm verify:appwrite:deployed:g1:domain",
      "appwrite_preview",
    ],
    [
      "ERR-002",
      "FR-PROJ-004",
      "Reporter",
      "verify-appwrite-deployed-g1.ts",
      "Inactive Project intake is rejected while history remains intact.",
      "pnpm verify:appwrite:deployed:g1:domain",
      "appwrite_preview",
    ],
    [
      "ERR-003",
      "FR-PROJ-009",
      "Workspace Owner",
      "verify-appwrite-g3-admin.ts",
      "A colliding current or historical slug is rejected with routes unchanged.",
      "pnpm verify:appwrite:g3:admin",
      "appwrite_preview",
    ],
    [
      "ERR-004",
      "FR-FDB-002",
      "Reporter",
      "verify-appwrite-deployed-g1.ts",
      "Invalid type or Context fields receive actionable errors and create nothing.",
      "pnpm verify:appwrite:deployed:g1:domain",
      "appwrite_preview",
    ],
    [
      "ERR-005",
      "FR-REP-006",
      "Reporter",
      "verify-appwrite-deployed-g1.ts",
      "Untrusted attribution remains unverified and grants no authority.",
      "pnpm verify:appwrite:deployed:g1:domain",
      "appwrite_preview",
    ],
    [
      "ERR-006",
      "FR-ACC-005",
      "Reporter",
      "verify-appwrite-deployed-g1.ts",
      "Invalid, expired and revoked proofs disclose no protected Feedback.",
      "pnpm verify:appwrite:deployed:g1:domain",
      "appwrite_preview",
    ],
    [
      "ERR-007",
      "FR-OWN-003",
      "Workspace actor",
      "verify-appwrite-g3-composed.ts",
      "Cross-scope or wrong-role access is denied without existence disclosure.",
      "pnpm verify:appwrite:g3:composed",
      "appwrite_preview",
    ],
    [
      "ERR-008",
      "FR-LIFE-006",
      "Project Maintainer",
      "verify-appwrite-g3-conversation-lifecycle.ts",
      "Invalid lifecycle transition preserves state and history.",
      "pnpm verify:appwrite:g3:conversation-lifecycle",
      "appwrite_preview",
    ],
    [
      "ERR-009",
      "FR-ATT-009",
      "Reporter",
      "verify-appwrite-g2-attachment.ts",
      "A policy-invalid Attachment rejects the logical submission atomically.",
      "pnpm verify:appwrite:g2:attachments",
      "appwrite_preview",
    ],
    [
      "ERR-010",
      "FR-FDB-007",
      "Reporter",
      "verify-appwrite-g1.ts",
      "Forced persistence failure confirms nothing and removes staged data.",
      "pnpm verify:appwrite:g1",
      "appwrite_preview",
    ],
    [
      "ERR-011",
      "FR-FDB-008",
      "Reporter",
      "verify-appwrite-deployed-g1.ts",
      "Retry returns the original result with exactly one domain effect.",
      "pnpm verify:appwrite:deployed:g1:domain",
      "appwrite_preview",
    ],
    [
      "ERR-012",
      "FR-NOT-006",
      "Notification recipient",
      "verify-preview-mail-catcher.ts",
      "Delivery failure preserves the event and records a non-success outcome.",
      "pnpm verify:mail:g3",
      "appwrite_preview",
    ],
    [
      "ERR-013",
      "FR-OPS-013",
      "Platform Operator",
      "verify-appwrite-g4-platform-access.ts",
      "Missing, expired or out-of-scope grant is denied and audited.",
      "pnpm verify:appwrite:g4:platform-access",
      "appwrite_preview",
    ],
    [
      "ERR-014",
      "FR-OPS-009",
      "Any API actor",
      "verify-appwrite-g3-composed.ts",
      "Unavailable dependency returns a safe retryable result without duplicate effects.",
      "pnpm verify:appwrite:g3:composed",
      "appwrite_preview",
    ],
    [
      "ERR-015",
      "FR-SEC-004",
      "Public caller",
      "verify-appwrite-g4-abuse.ts",
      "Exceeded abuse bound returns safe HTTP 429 and creates no excess effect.",
      "pnpm verify:appwrite:g4:abuse",
      "appwrite_preview",
    ],
    [
      "ERR-016",
      "FR-PRIV-008",
      "Reporter or restore operator",
      "verify-recovery-g5.ts",
      "Unauthorized or post-purge restore is rejected without resurrection.",
      "pnpm verify:recovery:g5",
      "appwrite_preview",
    ],
    [
      "ERR-017",
      "FR-SRC-005",
      "Provider callback caller",
      "verify-preview-source-provider.ts",
      "Invalid authorization, selection or signature changes no authoritative state.",
      "pnpm verify:providers:g3:sources",
      "appwrite_preview",
    ],
    [
      "ERR-018",
      "FR-SYNC-009",
      "Project Maintainer",
      "verify-preview-provider-issue.ts",
      "Missing active consent blocks public Reporter content while retaining the Y7 action.",
      "pnpm verify:providers:g3:issue-link",
      "appwrite_preview",
    ],
    [
      "ERR-019",
      "FR-SYNC-011",
      "Provider webhook caller",
      "verify-preview-provider-reconciliation.ts",
      "Conflicting, stale or unverifiable events are quarantined and reconciled once.",
      "pnpm verify:providers:g4:reconciliation",
      "appwrite_preview",
    ],
  ] as const satisfies readonly ErrorScenarioSeed[]
).map(([id, requirementId, actor, fixture, outcome, evidenceCommand, environment]) => ({
  id,
  requirementIds: [id, requirementId],
  actor,
  fixtureOwner: `functions/api/src/${fixture}`,
  environment,
  positiveOracle: outcome,
  negativeOracle:
    "No unauthorized disclosure, duplicate domain effect or unrelated state change occurs.",
  cleanupOracle: previewCleanup,
  evidenceCommand,
}));

export function buildE2eG5Matrix(): readonly E2eG5Scenario[] {
  return [...useCases, ...errors];
}
