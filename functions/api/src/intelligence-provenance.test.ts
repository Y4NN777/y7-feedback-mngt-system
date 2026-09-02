import { describe, expect, it, vi } from "vitest";

import {
  createIntelligenceProvenanceCoordinator,
  type IntelligenceProvenanceStore,
} from "./intelligence-provenance";

const actor = {
  principalId: "principal_1",
  responsibility: "workspace_owner" as const,
  workspaceIds: ["workspace_1"],
  projectIds: [],
};

const base = {
  jwt: "jwt_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  command: {
    kind: "record_theme",
    operationId: "operation_1",
    feedbackId: "feedback_1",
    label: "Checkout friction",
  },
} as const;

function setup(
  options: {
    verified?: boolean;
    authorized?: boolean;
    execute?: IntelligenceProvenanceStore["execute"];
  } = {},
) {
  const execute = vi.fn<IntelligenceProvenanceStore["execute"]>(
    options.execute ??
      (() =>
        Promise.resolve({
          status: "applied",
          associationId: "association_1",
          eventId: "event_1",
          revision: 1,
        })),
  );
  const verify = vi.fn(() =>
    Promise.resolve(
      options.verified === false
        ? { status: "denied" as const }
        : { status: "verified" as const, principalId: "principal_1" },
    ),
  );
  const resolve = vi.fn(() =>
    Promise.resolve(
      options.authorized === false
        ? { status: "denied" as const }
        : {
            status: "authorized" as const,
            actor,
            project: { id: "project_1", workspaceId: "workspace_1", active: true },
          },
    ),
  );
  return {
    coordinator: createIntelligenceProvenanceCoordinator(
      { verify },
      { resolve },
      { execute },
    ),
    execute,
    resolve,
    verify,
  };
}

describe("trusted Intelligence provenance coordinator", () => {
  it("BDD-INT-310 verifies identity and Project capability before applying a Theme", async () => {
    const { coordinator, execute, resolve } = setup();
    await expect(coordinator.execute(base)).resolves.toEqual({
      status: "ok",
      result: {
        disposition: "applied",
        associationId: "association_1",
        eventId: "event_1",
        revision: 1,
      },
    });
    expect(resolve).toHaveBeenCalledWith({
      principalId: "principal_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      capability: "feedback.write",
    });
    expect(execute).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      projectId: "project_1",
      actorId: "principal_1",
      command: base.command,
    });
  });

  it("BDD-INT-311 parses every supported mutation and preserves replay disposition", async () => {
    const commands = [
      {
        kind: "record_relationship",
        operationId: "operation_1",
        feedbackId: "feedback_1",
        relatedFeedbackId: "feedback_2",
        relationType: "duplicate",
      },
      {
        kind: "correct_theme",
        operationId: "operation_2",
        associationId: "association_1",
        expectedRevision: 1,
        label: "Payment friction",
      },
      {
        kind: "correct_relationship",
        operationId: "operation_3",
        associationId: "association_1",
        expectedRevision: 2,
        relatedFeedbackId: "feedback_3",
        relationType: "depends_on",
      },
      {
        kind: "remove_association",
        operationId: "operation_4",
        associationId: "association_1",
        expectedRevision: 3,
      },
    ];
    for (const candidate of commands) {
      const { coordinator, execute } = setup({
        execute: () =>
          Promise.resolve({
            status: "replayed",
            associationId: "association_1",
            eventId: "event_1",
            revision: 1,
          }),
      });
      await expect(
        coordinator.execute({ ...base, command: candidate }),
      ).resolves.toEqual({
        status: "ok",
        result: {
          disposition: "replayed",
          associationId: "association_1",
          eventId: "event_1",
          revision: 1,
        },
      });
      expect(execute).toHaveBeenCalledOnce();
    }
  });

  it("BDD-INT-312 rejects malformed commands before authentication", async () => {
    const invalid: unknown[] = [
      null,
      {},
      { kind: 1 },
      { kind: "unknown", operationId: "operation_1" },
      { ...base.command, operationId: "bad id" },
      { ...base.command, feedbackId: "bad id" },
      { ...base.command, label: 1 },
      {
        kind: "record_relationship",
        operationId: "operation_1",
        feedbackId: "feedback_1",
        relatedFeedbackId: "bad id",
        relationType: "invented",
      },
      {
        kind: "correct_theme",
        operationId: "operation_1",
        associationId: "bad id",
        expectedRevision: 0,
        label: 1,
      },
      {
        kind: "correct_theme",
        operationId: "operation_1",
        associationId: "association_1",
        expectedRevision: 1,
        label: 1,
      },
      {
        kind: "correct_relationship",
        operationId: "operation_1",
        associationId: "association_1",
        expectedRevision: 1,
        relatedFeedbackId: "feedback_2",
        relationType: "invented",
      },
    ];
    for (const candidate of invalid) {
      const { coordinator, verify } = setup();
      await expect(
        coordinator.execute({ ...base, command: candidate }),
      ).resolves.toEqual({ status: "invalid" });
      expect(verify).not.toHaveBeenCalled();
    }
    for (const scope of [
      { workspaceId: "bad id", projectId: "project_1" },
      { workspaceId: "workspace_1", projectId: "bad id" },
    ]) {
      const { coordinator } = setup();
      await expect(coordinator.execute({ ...base, ...scope })).resolves.toEqual({
        status: "invalid",
      });
    }
  });

  it("BDD-INT-313 denies unverifiable and unauthorized principals without store access", async () => {
    for (const options of [{ verified: false }, { authorized: false }]) {
      const { coordinator, execute } = setup(options);
      await expect(coordinator.execute(base)).resolves.toEqual({ status: "denied" });
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it("BDD-INT-314 preserves stable store outcomes and contains transport failure", async () => {
    for (const status of ["denied", "invalid", "conflict", "retryable"] as const) {
      const { coordinator } = setup({ execute: () => Promise.resolve({ status }) });
      await expect(coordinator.execute(base)).resolves.toEqual({ status });
    }
    const { coordinator } = setup({
      execute: () => Promise.reject(new Error("transport")),
    });
    await expect(coordinator.execute(base)).resolves.toEqual({ status: "retryable" });
  });
});
