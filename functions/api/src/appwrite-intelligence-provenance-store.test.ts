import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteIntelligenceProvenanceStore,
  type AppwriteIntelligenceProvenanceTables,
} from "./appwrite-intelligence-provenance-store";

const schema = {
  databaseId: "feedback",
  feedbackTableId: "feedback_rows",
  provenanceTableId: "intelligence_provenance",
} as const;
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  limit: (value: number) => `limit:${String(value)}`,
};
const sensitive = {
  environment: "preview" as const,
  protector: {
    activeKeyId: "key",
    seal: (_context: unknown, value: string) => value,
    open: (_context: unknown, value: string) => value,
  },
};

function feedback(id: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    $id: id,
    workspaceId: "workspace_1",
    projectId: "project_1",
    sourceRevisionsJson: "[]",
    deletedAt: null,
    ...overrides,
  };
}

class FakeTables implements AppwriteIntelligenceProvenanceTables {
  readonly feedback = new Map<string, unknown>();
  readonly provenance = new Map<string, Readonly<Record<string, unknown>>>();
  readonly transactions: Array<Readonly<Record<string, unknown>>> = [];
  readonly writes: Array<Readonly<Record<string, unknown>>> = [];
  transactionId = "transaction_1";
  fail: "list" | "get" | "create" | "update" | "commit" | "rollback" | undefined;

  createTransaction = vi.fn(() => Promise.resolve({ $id: this.transactionId }));
  listRows = vi.fn(() => {
    if (this.fail === "list") return Promise.reject(new Error("transport"));
    return Promise.resolve({ rows: [...this.provenance.values()] });
  });
  getRow = vi.fn(
    (input: Parameters<AppwriteIntelligenceProvenanceTables["getRow"]>[0]) => {
      if (this.fail === "get") return Promise.reject(new Error("transport"));
      const value = this.feedback.get(input.rowId);
      return value === undefined
        ? Promise.reject(Object.assign(new Error("absent"), { code: 404 }))
        : Promise.resolve(value);
    },
  );
  createRow = vi.fn(
    (input: Parameters<AppwriteIntelligenceProvenanceTables["createRow"]>[0]) => {
      if (this.fail === "create") return Promise.reject(new Error("transport"));
      const row = { $id: input.rowId, ...input.data };
      this.provenance.set(input.rowId, row);
      this.writes.push({ kind: "create", ...input });
      return Promise.resolve(row);
    },
  );
  updateRow = vi.fn(
    (input: Parameters<AppwriteIntelligenceProvenanceTables["updateRow"]>[0]) => {
      if (this.fail === "update") return Promise.reject(new Error("transport"));
      const row = {
        ...this.provenance.get(input.rowId),
        $id: input.rowId,
        ...input.data,
      };
      this.provenance.set(input.rowId, row);
      this.writes.push({ kind: "update", ...input });
      return Promise.resolve(row);
    },
  );
  updateTransaction = vi.fn(
    (
      input: Parameters<AppwriteIntelligenceProvenanceTables["updateTransaction"]>[0],
    ) => {
      this.transactions.push(input);
      if (
        (input.commit && this.fail === "commit") ||
        (input.rollback && this.fail === "rollback")
      )
        return Promise.reject(new Error("transaction"));
      return Promise.resolve({});
    },
  );
}

function setup() {
  const tables = new FakeTables();
  tables.feedback.set("feedback_1", feedback("feedback_1"));
  tables.feedback.set("feedback_2", feedback("feedback_2"));
  let event = 0;
  const store = createAppwriteIntelligenceProvenanceStore(
    tables,
    schema,
    queries,
    sensitive,
    {
      createAssociationId: () => "association_1",
      createEventId: () => `event_${String(++event)}`,
      now: () => `2026-09-02T0${String(event)}:00:00.000Z`,
    },
  );
  return { store, tables };
}

const scope = {
  workspaceId: "workspace_1",
  projectId: "project_1",
  actorId: "principal_1",
} as const;

describe("Appwrite Intelligence provenance store", () => {
  it("BDD-INT-315 commits create, correction, replay and removal as one-row append-only provenance", async () => {
    const { store, tables } = setup();
    await expect(
      store.execute({
        ...scope,
        command: {
          kind: "record_theme",
          operationId: "operation_1",
          feedbackId: "feedback_1",
          label: "Checkout friction",
        },
      }),
    ).resolves.toEqual({
      status: "applied",
      associationId: "association_1",
      eventId: "event_1",
      revision: 1,
    });
    await expect(
      store.execute({
        ...scope,
        actorId: "principal_2",
        command: {
          kind: "correct_theme",
          operationId: "operation_2",
          associationId: "association_1",
          expectedRevision: 1,
          label: "Payment friction",
        },
      }),
    ).resolves.toEqual({
      status: "applied",
      associationId: "association_1",
      eventId: "event_2",
      revision: 2,
    });
    await expect(
      store.execute({
        ...scope,
        actorId: "principal_2",
        command: {
          kind: "correct_theme",
          operationId: "operation_2",
          associationId: "association_1",
          expectedRevision: 1,
          label: "Payment friction",
        },
      }),
    ).resolves.toMatchObject({ status: "replayed", eventId: "event_2", revision: 2 });
    await expect(
      store.execute({
        ...scope,
        actorId: "principal_3",
        command: {
          kind: "remove_association",
          operationId: "operation_3",
          associationId: "association_1",
          expectedRevision: 2,
        },
      }),
    ).resolves.toEqual({
      status: "applied",
      associationId: "association_1",
      eventId: "event_3",
      revision: 3,
    });
    const row = tables.provenance.get("association_1");
    expect(row).toMatchObject({
      associationKind: "theme",
      relationType: "theme",
      revision: 3,
      actorId: "principal_1",
      updatedByActorId: "principal_3",
      removedAt: "2026-09-02T02:00:00.000Z",
      operationIdsJson: '["operation_1","operation_2","operation_3"]',
    });
    expect(JSON.parse(String(row?.provenanceEnvelope))).toHaveLength(3);
    expect(tables.transactions.filter(({ commit }) => commit)).toHaveLength(3);
  });

  it("BDD-INT-316 verifies both ends of a relationship in the exact scope", async () => {
    const { store, tables } = setup();
    await expect(
      store.execute({
        ...scope,
        command: {
          kind: "record_relationship",
          operationId: "operation_1",
          feedbackId: "feedback_1",
          relatedFeedbackId: "feedback_2",
          relationType: "duplicate",
        },
      }),
    ).resolves.toMatchObject({ status: "applied" });
    expect(tables.getRow).toHaveBeenCalledTimes(2);
    expect(tables.provenance.get("association_1")).toMatchObject({
      associationKind: "relationship",
      relationType: "duplicate",
      relatedFeedbackId: "feedback_2",
    });
    await expect(
      store.execute({
        ...scope,
        command: {
          kind: "correct_relationship",
          operationId: "operation_2",
          associationId: "association_1",
          expectedRevision: 1,
          relatedFeedbackId: "feedback_2",
          relationType: "depends_on",
        },
      }),
    ).resolves.toMatchObject({ status: "applied", revision: 2 });

    for (const related of [
      undefined,
      feedback("feedback_2", { projectId: "project_2" }),
      feedback("feedback_2", { deletedAt: "2026-09-02T00:00:00.000Z" }),
    ]) {
      const candidate = setup();
      if (related === undefined) candidate.tables.feedback.delete("feedback_2");
      else candidate.tables.feedback.set("feedback_2", related);
      await expect(
        candidate.store.execute({
          ...scope,
          command: {
            kind: "record_relationship",
            operationId: "operation_1",
            feedbackId: "feedback_1",
            relatedFeedbackId: "feedback_2",
            relationType: "related",
          },
        }),
      ).resolves.toEqual({ status: "denied" });
      expect(candidate.tables.writes).toHaveLength(0);
    }
  });

  it("BDD-INT-317 denies unknown associations and out-of-scope source Feedback", async () => {
    const missing = setup();
    await expect(
      missing.store.execute({
        ...scope,
        command: {
          kind: "remove_association",
          operationId: "operation_1",
          associationId: "missing",
          expectedRevision: 1,
        },
      }),
    ).resolves.toEqual({ status: "denied" });
    for (const source of [
      undefined,
      feedback("feedback_1", { workspaceId: "workspace_2" }),
      feedback("feedback_1", { deletedAt: "2026-09-02T00:00:00.000Z" }),
    ]) {
      const candidate = setup();
      if (source === undefined) candidate.tables.feedback.delete("feedback_1");
      else candidate.tables.feedback.set("feedback_1", source);
      await expect(
        candidate.store.execute({
          ...scope,
          command: {
            kind: "record_theme",
            operationId: "operation_1",
            feedbackId: "feedback_1",
            label: "Theme",
          },
        }),
      ).resolves.toEqual({ status: "denied" });
    }
  });

  it("BDD-INT-318 rolls back validation, conflict and transport failures", async () => {
    const invalid = setup();
    await expect(
      invalid.store.execute({
        ...scope,
        command: {
          kind: "record_theme",
          operationId: "operation_1",
          feedbackId: "feedback_1",
          label: " spaced ",
        },
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      invalid.store.execute({
        ...scope,
        command: {
          kind: "record_theme",
          operationId: "operation_2",
          feedbackId: "feedback_1",
          label: "Theme",
        },
      }),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      invalid.store.execute({
        ...scope,
        command: {
          kind: "correct_theme",
          operationId: "operation_3",
          associationId: "association_1",
          expectedRevision: 99,
          label: "Other",
        },
      }),
    ).resolves.toEqual({ status: "conflict" });

    for (const failure of ["list", "get", "create", "commit"] as const) {
      const candidate = setup();
      candidate.tables.fail = failure;
      await expect(
        candidate.store.execute({
          ...scope,
          command: {
            kind: "record_theme",
            operationId: "operation_1",
            feedbackId: "feedback_1",
            label: "Theme",
          },
        }),
      ).resolves.toEqual({ status: "retryable" });
    }
    const updateFailure = setup();
    await updateFailure.store.execute({
      ...scope,
      command: {
        kind: "record_theme",
        operationId: "operation_1",
        feedbackId: "feedback_1",
        label: "Theme",
      },
    });
    updateFailure.tables.fail = "update";
    await expect(
      updateFailure.store.execute({
        ...scope,
        command: {
          kind: "correct_theme",
          operationId: "operation_2",
          associationId: "association_1",
          expectedRevision: 1,
          label: "Other",
        },
      }),
    ).resolves.toEqual({ status: "retryable" });
    const relatedTransport = setup();
    relatedTransport.tables.getRow
      .mockResolvedValueOnce(feedback("feedback_1"))
      .mockRejectedValueOnce(new Error("transport"));
    await expect(
      relatedTransport.store.execute({
        ...scope,
        command: {
          kind: "record_relationship",
          operationId: "operation_1",
          feedbackId: "feedback_1",
          relatedFeedbackId: "feedback_2",
          relationType: "related",
        },
      }),
    ).resolves.toEqual({ status: "retryable" });
    const rollback = setup();
    rollback.tables.fail = "rollback";
    rollback.tables.transactionId = "bad id";
    await expect(
      rollback.store.execute({
        ...scope,
        command: {
          kind: "record_theme",
          operationId: "operation_1",
          feedbackId: "feedback_1",
          label: "Theme",
        },
      }),
    ).resolves.toEqual({ status: "retryable" });
  });

  it("BDD-INT-319 fails closed for malformed schema, input, source version and persisted provenance", async () => {
    const baseSetup = setup();
    for (const invalidSchema of [
      { ...schema, databaseId: "bad id" },
      { ...schema, provenanceTableId: schema.feedbackTableId },
    ])
      expect(() =>
        createAppwriteIntelligenceProvenanceStore(
          baseSetup.tables,
          invalidSchema,
          queries,
          sensitive,
          {
            createAssociationId: () => "association_1",
            createEventId: () => "event_1",
            now: () => "2026-09-02T00:00:00.000Z",
          },
        ),
      ).toThrow("APPWRITE_INTELLIGENCE_PROVENANCE_SCHEMA_INVALID");
    for (const invalidScope of [
      { ...scope, workspaceId: "bad id" },
      { ...scope, projectId: "bad id" },
      { ...scope, actorId: "bad id" },
    ])
      await expect(
        setup().store.execute({
          ...invalidScope,
          command: {
            kind: "record_theme",
            operationId: "operation_1",
            feedbackId: "feedback_1",
            label: "Theme",
          },
        }),
      ).resolves.toEqual({ status: "invalid" });
    const revisions = setup();
    revisions.tables.feedback.set(
      "feedback_1",
      feedback("feedback_1", { sourceRevisionsJson: "{}" }),
    );
    await expect(
      revisions.store.execute({
        ...scope,
        command: {
          kind: "record_theme",
          operationId: "operation_1",
          feedbackId: "feedback_1",
          label: "Theme",
        },
      }),
    ).resolves.toEqual({ status: "retryable" });
    const unreadable = setup();
    unreadable.tables.feedback.set(
      "feedback_1",
      feedback("feedback_1", { sourceRevisionsJson: "{" }),
    );
    await expect(
      unreadable.store.execute({
        ...scope,
        command: {
          kind: "record_theme",
          operationId: "operation_1",
          feedbackId: "feedback_1",
          label: "Theme",
        },
      }),
    ).resolves.toEqual({ status: "retryable" });
    const malformed = setup();
    malformed.tables.provenance.set("association_1", {
      $id: "association_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      associationKind: "theme",
      revision: 1,
      operationIdsJson: "[]",
      provenanceEnvelope: "{}",
    });
    await expect(
      malformed.store.execute({
        ...scope,
        command: {
          kind: "record_theme",
          operationId: "operation_2",
          feedbackId: "feedback_1",
          label: "Theme",
        },
      }),
    ).resolves.toEqual({ status: "retryable" });

    const malformedRows: readonly unknown[] = [
      null,
      { $id: 1 },
      { $id: "bad id" },
      { $id: "association_1", workspaceId: "workspace_2" },
      {
        $id: "association_1",
        workspaceId: "workspace_1",
        projectId: "project_2",
      },
      {
        $id: "association_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        associationKind: "unknown",
      },
      {
        $id: "association_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        associationKind: "theme",
        revision: "1",
      },
      {
        $id: "association_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        associationKind: "theme",
        revision: 0,
      },
      {
        $id: "association_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        associationKind: "relationship",
        revision: 1,
        operationIdsJson: 1,
      },
    ];
    for (const row of malformedRows) {
      const candidate = setup();
      candidate.tables.provenance.set(
        "candidate",
        row as Readonly<Record<string, unknown>>,
      );
      await expect(
        candidate.store.execute({
          ...scope,
          command: {
            kind: "record_theme",
            operationId: "operation_1",
            feedbackId: "feedback_1",
            label: "Theme",
          },
        }),
      ).resolves.toEqual({ status: "retryable" });
    }

    const nonStringEnvelope = setup();
    nonStringEnvelope.tables.provenance.set("association_1", {
      $id: "association_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      associationKind: "theme",
      revision: 1,
      operationIdsJson: "[]",
      provenanceEnvelope: 1,
    });
    await expect(
      nonStringEnvelope.store.execute({
        ...scope,
        command: {
          kind: "record_theme",
          operationId: "operation_1",
          feedbackId: "feedback_1",
          label: "Theme",
        },
      }),
    ).resolves.toEqual({ status: "retryable" });

    const badPersisted = setup();
    badPersisted.tables.createRow.mockResolvedValueOnce({ $id: "wrong" });
    await expect(
      badPersisted.store.execute({
        ...scope,
        command: {
          kind: "record_theme",
          operationId: "operation_1",
          feedbackId: "feedback_1",
          label: "Theme",
        },
      }),
    ).resolves.toEqual({ status: "retryable" });
  });
});
