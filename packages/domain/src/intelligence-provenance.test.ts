import { describe, expect, it } from "vitest";

import {
  decideIntelligenceProvenance,
  projectIntelligenceAssociations,
  type IntelligenceProvenanceCommand,
  type IntelligenceProvenanceDependencies,
  type IntelligenceProvenanceEvent,
} from "./intelligence-provenance";

function dependencies(
  overrides: Partial<IntelligenceProvenanceDependencies> = {},
): IntelligenceProvenanceDependencies {
  return {
    createEventId: () => "event_1",
    createAssociationId: () => "association_1",
    actorId: "principal_1",
    now: () => "2026-09-02T05:00:00.000Z",
    ...overrides,
  };
}

function record(
  overrides: Partial<
    Extract<IntelligenceProvenanceCommand, { type: "record_association" }>
  > = {},
): Extract<IntelligenceProvenanceCommand, { type: "record_association" }> {
  return {
    type: "record_association",
    operationId: "operation_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    feedbackId: "feedback_1",
    sourceVersion: 3,
    target: { kind: "theme", label: "Checkout friction" },
    ...overrides,
  };
}

function recorded(
  overrides: Partial<
    Extract<IntelligenceProvenanceEvent, { type: "association_recorded" }>
  > = {},
): Extract<IntelligenceProvenanceEvent, { type: "association_recorded" }> {
  return {
    type: "association_recorded",
    eventId: "event_1",
    operationId: "operation_1",
    associationId: "association_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    feedbackId: "feedback_1",
    sourceVersion: 3,
    revision: 1,
    target: { kind: "theme", label: "Checkout friction" },
    actorId: "principal_1",
    occurredAt: "2026-09-02T05:00:00.000Z",
    ...overrides,
  };
}

describe("Intelligence provenance", () => {
  it("BDD-INT-301 records an attributable Theme without carrying source Feedback", () => {
    const decision = decideIntelligenceProvenance([], record(), dependencies());

    expect(decision).toEqual({ status: "accepted", event: recorded() });
    expect(JSON.stringify(decision)).not.toContain("problem");
    expect(projectIntelligenceAssociations([recorded()])).toEqual([
      {
        associationId: "association_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        sourceVersion: 3,
        revision: 1,
        target: { kind: "theme", label: "Checkout friction" },
        createdBy: "principal_1",
        createdAt: "2026-09-02T05:00:00.000Z",
        updatedBy: "principal_1",
        updatedAt: "2026-09-02T05:00:00.000Z",
        provenance: [recorded()],
      },
    ]);
  });

  it("BDD-INT-302 records only a non-self Feedback relationship", () => {
    const command = record({
      target: {
        kind: "relationship",
        relatedFeedbackId: "feedback_2",
        relationType: "depends_on",
      },
    });
    const accepted = decideIntelligenceProvenance([], command, dependencies());
    expect(accepted.status).toBe("accepted");
    expect(
      decideIntelligenceProvenance(
        [],
        record({
          target: {
            kind: "relationship",
            relatedFeedbackId: "feedback_1",
            relationType: "related",
          },
        }),
        dependencies(),
      ),
    ).toEqual({ status: "invalid" });
  });

  it("BDD-INT-303 appends correction attribution and retains original provenance", () => {
    const correction = decideIntelligenceProvenance(
      [recorded()],
      {
        type: "correct_association",
        operationId: "operation_2",
        associationId: "association_1",
        expectedRevision: 1,
        target: { kind: "theme", label: "Payment friction" },
      },
      dependencies({
        createEventId: () => "event_2",
        actorId: "principal_2",
        now: () => "2026-09-02T06:00:00.000+00:00",
      }),
    );
    expect(correction.status).toBe("accepted");
    if (correction.status !== "accepted") throw new Error("expected acceptance");
    expect(projectIntelligenceAssociations([recorded(), correction.event])).toEqual([
      expect.objectContaining({
        revision: 2,
        target: { kind: "theme", label: "Payment friction" },
        createdBy: "principal_1",
        updatedBy: "principal_2",
        updatedAt: "2026-09-02T06:00:00.000+00:00",
        provenance: [recorded(), correction.event],
      }),
    ]);
  });

  it("BDD-INT-304 removes a derived association without rewriting its source or history", () => {
    const removal = decideIntelligenceProvenance(
      [recorded()],
      {
        type: "remove_association",
        operationId: "operation_2",
        associationId: "association_1",
        expectedRevision: 1,
      },
      dependencies({
        createEventId: () => "event_2",
        actorId: "principal_2",
        now: () => "2026-09-02T07:00:00.000Z",
      }),
    );
    expect(removal.status).toBe("accepted");
    if (removal.status !== "accepted") throw new Error("expected acceptance");
    expect(projectIntelligenceAssociations([recorded(), removal.event])).toEqual([
      expect.objectContaining({
        revision: 2,
        removedAt: "2026-09-02T07:00:00.000Z",
        target: { kind: "theme", label: "Checkout friction" },
        provenance: [recorded(), removal.event],
      }),
    ]);
    expect(
      decideIntelligenceProvenance(
        [recorded(), removal.event],
        {
          type: "remove_association",
          operationId: "operation_3",
          associationId: "association_1",
          expectedRevision: 2,
        },
        dependencies(),
      ),
    ).toEqual({ status: "conflict" });
  });

  it("BDD-INT-305 replays identical operations and conflicts on key reuse", () => {
    expect(
      decideIntelligenceProvenance([recorded()], record(), dependencies()),
    ).toEqual({
      status: "replayed",
      event: recorded(),
    });
    expect(
      decideIntelligenceProvenance(
        [recorded()],
        record({ target: { kind: "theme", label: "Different" } }),
        dependencies(),
      ),
    ).toEqual({ status: "conflict" });
    const corrected: IntelligenceProvenanceEvent = {
      ...recorded(),
      type: "association_corrected",
      eventId: "event_2",
      operationId: "operation_2",
      revision: 2,
      priorEventId: "event_1",
      target: { kind: "theme", label: "Corrected" },
    };
    expect(
      decideIntelligenceProvenance(
        [recorded(), corrected],
        {
          type: "correct_association",
          operationId: "operation_2",
          associationId: "association_1",
          expectedRevision: 1,
          target: { kind: "theme", label: "Corrected" },
        },
        dependencies(),
      ).status,
    ).toBe("replayed");
    const removed: IntelligenceProvenanceEvent = {
      ...recorded(),
      type: "association_removed",
      eventId: "event_2",
      operationId: "operation_2",
      revision: 2,
      priorEventId: "event_1",
    };
    expect(
      decideIntelligenceProvenance(
        [recorded(), removed],
        {
          type: "remove_association",
          operationId: "operation_2",
          associationId: "association_1",
          expectedRevision: 1,
        },
        dependencies(),
      ).status,
    ).toBe("replayed");
  });

  it("BDD-INT-306 fails closed for invalid commands, dependencies and histories", () => {
    for (const command of [
      record({ operationId: "bad id" }),
      record({ workspaceId: "" }),
      record({ projectId: "" }),
      record({ feedbackId: "" }),
      record({ sourceVersion: 0 }),
      record({ target: { kind: "theme", label: " spaced " } }),
    ])
      expect(decideIntelligenceProvenance([], command, dependencies()).status).toBe(
        "invalid",
      );
    for (const deps of [
      dependencies({ actorId: "bad id" }),
      dependencies({ createEventId: () => "bad id" }),
      dependencies({ createAssociationId: () => "bad id" }),
      dependencies({ now: () => "invalid" }),
    ])
      expect(decideIntelligenceProvenance([], record(), deps).status).toBe("invalid");
    expect(
      decideIntelligenceProvenance(
        [recorded({ revision: 2 })],
        {
          type: "remove_association",
          operationId: "operation_2",
          associationId: "missing",
          expectedRevision: 1,
        },
        dependencies(),
      ),
    ).toEqual({ status: "conflict" });
  });

  it("BDD-INT-307 rejects broken append-only chains and cross-scope corrections", () => {
    const correction: IntelligenceProvenanceEvent = {
      ...recorded(),
      type: "association_corrected",
      eventId: "event_2",
      operationId: "operation_2",
      revision: 2,
      priorEventId: "event_1",
      target: { kind: "theme", label: "Corrected" },
    };
    const corruptions: IntelligenceProvenanceEvent[][] = [
      [recorded(), { ...correction, workspaceId: "workspace_2" }],
      [recorded(), { ...correction, projectId: "project_2" }],
      [recorded(), { ...correction, feedbackId: "feedback_2" }],
      [recorded(), { ...correction, sourceVersion: 4 }],
      [recorded(), { ...correction, revision: 3 }],
      [recorded(), { ...correction, priorEventId: "wrong" }],
      [recorded(), { ...correction, operationId: "operation_1" }],
      [recorded(), recorded({ eventId: "event_2", operationId: "operation_2" })],
    ];
    for (const events of corruptions)
      expect(() => projectIntelligenceAssociations(events)).toThrow(
        "INTELLIGENCE_PROVENANCE_INVALID",
      );
  });

  it("BDD-INT-308 sorts multiple associations and rejects generated ID collisions", () => {
    const second = recorded({
      eventId: "event_2",
      operationId: "operation_2",
      associationId: "association_2",
      feedbackId: "feedback_2",
    });
    expect(
      projectIntelligenceAssociations([second, recorded()]).map(
        ({ associationId }) => associationId,
      ),
    ).toEqual(["association_1", "association_2"]);
    expect(
      decideIntelligenceProvenance(
        [recorded()],
        record({ operationId: "operation_3" }),
        dependencies(),
      ),
    ).toEqual({ status: "invalid" });
  });
});
