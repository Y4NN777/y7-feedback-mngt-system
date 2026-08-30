export const g3ComposedSteps = [
  "reporter_submission_and_scoped_notification",
  "maintainer_clarification",
  "reporter_answer_without_internal_notes",
  "maintainer_resolution_and_closure",
  "valid_reporter_reopen",
  "assignment_removal_ends_access",
  "notification_failure_and_reconciliation",
  "single_selected_repository_issue",
  "fixture_cleanup",
] as const;

export type G3ComposedStep = (typeof g3ComposedSteps)[number];

export const g3ResidueKinds = [
  "feedback",
  "access_grants",
  "reporters",
  "lifecycle",
  "messages",
  "internal_notes",
  "conversation_idempotency",
  "notifications",
  "notification_signals",
  "notification_delivery_attempts",
  "publication_consents",
  "external_issue_links",
  "provider_outbox",
  "source_connections",
  "provider_grants",
] as const;

export type G3ResidueKind = (typeof g3ResidueKinds)[number];

export interface G3StepEvidence {
  readonly step: G3ComposedStep;
  readonly fixtureId: string;
}

export interface G3ResidueEvidence {
  readonly kind: G3ResidueKind;
  readonly count: number;
}

export interface G3ComposedEvidence {
  readonly fixtureId: string;
  readonly steps: readonly G3StepEvidence[];
  readonly residue: readonly G3ResidueEvidence[];
}

export interface G3ComposedGateResult {
  readonly result: "APPWRITE_G3_COMPOSED_PASSED";
  readonly fixtureId: string;
  readonly scenarioCount: 9;
  readonly cleanupPassed: true;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function evaluateG3ComposedEvidence(
  evidence: G3ComposedEvidence,
): G3ComposedGateResult {
  if (!/^g3c_[a-f0-9]{14}$/u.test(evidence.fixtureId)) {
    throw new Error("G3_COMPOSED_FIXTURE_ID_INVALID");
  }
  if (
    evidence.steps.some(({ fixtureId }) => fixtureId !== evidence.fixtureId) ||
    !unique(evidence.steps.map(({ step }) => step))
  ) {
    throw new Error("G3_COMPOSED_FIXTURE_COHESION_INVALID");
  }
  const completed = new Set(evidence.steps.map(({ step }) => step));
  if (g3ComposedSteps.some((step) => !completed.has(step))) {
    throw new Error("G3_COMPOSED_STEP_MISSING");
  }
  if (!unique(evidence.residue.map(({ kind }) => kind))) {
    throw new Error("G3_COMPOSED_RESIDUE_DUPLICATE");
  }
  const residue = new Map(evidence.residue.map(({ kind, count }) => [kind, count]));
  if (
    g3ResidueKinds.some((kind) => residue.get(kind) !== 0) ||
    evidence.residue.some(({ count }) => !Number.isSafeInteger(count) || count < 0)
  ) {
    throw new Error("G3_COMPOSED_RESIDUE_PRESENT");
  }
  return {
    result: "APPWRITE_G3_COMPOSED_PASSED",
    fixtureId: evidence.fixtureId,
    scenarioCount: 9,
    cleanupPassed: true,
  };
}
