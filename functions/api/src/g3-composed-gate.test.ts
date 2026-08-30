import { describe, expect, it } from "vitest";

import {
  evaluateG3ComposedEvidence,
  g3ComposedSteps,
  g3ResidueKinds,
  type G3ComposedEvidence,
} from "./g3-composed-gate";

const fixtureId = "g3c_0123456789abcd";

function complete(): G3ComposedEvidence {
  return {
    fixtureId,
    steps: g3ComposedSteps.map((step) => ({ step, fixtureId })),
    residue: g3ResidueKinds.map((kind) => ({ kind, count: 0 })),
  };
}

describe("composed Day 3 gate", () => {
  it("BDD-G3-000 rejects an unscoped fixture identity", () => {
    expect(() =>
      evaluateG3ComposedEvidence({ ...complete(), fixtureId: "another-fixture" }),
    ).toThrow("G3_COMPOSED_FIXTURE_ID_INVALID");
  });

  it("BDD-G3-001 accepts all nine outcomes from one cleaned fixture", () => {
    expect(evaluateG3ComposedEvidence(complete())).toEqual({
      result: "APPWRITE_G3_COMPOSED_PASSED",
      fixtureId,
      scenarioCount: 9,
      cleanupPassed: true,
    });
  });

  it("BDD-G3-002 rejects evidence aggregated from independent fixtures", () => {
    const evidence = complete();
    expect(() =>
      evaluateG3ComposedEvidence({
        ...evidence,
        steps: evidence.steps.map((step, index) =>
          index === 7 ? { ...step, fixtureId: "g3c_fedcba98765432" } : step,
        ),
      }),
    ).toThrow("G3_COMPOSED_FIXTURE_COHESION_INVALID");
  });

  it("BDD-G3-003 rejects a missing or duplicated scenario outcome", () => {
    const evidence = complete();
    const firstStep = evidence.steps[0];
    if (!firstStep) throw new Error("TEST_FIXTURE_INVALID");
    expect(() =>
      evaluateG3ComposedEvidence({ ...evidence, steps: evidence.steps.slice(1) }),
    ).toThrow("G3_COMPOSED_STEP_MISSING");
    expect(() =>
      evaluateG3ComposedEvidence({
        ...evidence,
        steps: [...evidence.steps.slice(0, -1), firstStep],
      }),
    ).toThrow("G3_COMPOSED_FIXTURE_COHESION_INVALID");
  });

  it("BDD-G3-004 rejects missing, duplicated, invalid or non-zero residue", () => {
    const evidence = complete();
    const firstResidue = evidence.residue[0];
    if (!firstResidue) throw new Error("TEST_FIXTURE_INVALID");
    expect(() =>
      evaluateG3ComposedEvidence({
        ...evidence,
        residue: evidence.residue.slice(1),
      }),
    ).toThrow("G3_COMPOSED_RESIDUE_PRESENT");
    expect(() =>
      evaluateG3ComposedEvidence({
        ...evidence,
        residue: [...evidence.residue, firstResidue],
      }),
    ).toThrow("G3_COMPOSED_RESIDUE_DUPLICATE");
    expect(() =>
      evaluateG3ComposedEvidence({
        ...evidence,
        residue: evidence.residue.map((entry) =>
          entry.kind === "provider_grants" ? { ...entry, count: 1 } : entry,
        ),
      }),
    ).toThrow("G3_COMPOSED_RESIDUE_PRESENT");
    expect(() =>
      evaluateG3ComposedEvidence({
        ...evidence,
        residue: evidence.residue.map((entry) =>
          entry.kind === "provider_grants" ? { ...entry, count: -1 } : entry,
        ),
      }),
    ).toThrow("G3_COMPOSED_RESIDUE_PRESENT");
  });
});
