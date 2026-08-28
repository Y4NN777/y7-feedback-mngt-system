import { describe, expect, it, vi } from "vitest";

import type { ActorAccess } from "@y7-feedback/domain";

import {
  createAppwriteWorkbenchMutationStore,
  type WorkbenchMutationTablesPort,
} from "./appwrite-workbench-mutation-store";
import { AppwriteWorkbenchError } from "./appwrite-workbench-store";

const schema = {
  databaseId: "feedback",
  feedbackTableId: "feedback_items",
  idempotencyTableId: "conversation_idempotency",
  projectAssignmentsTableId: "project_assignments",
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `${attribute}:${values.join(",")}`,
  limit: (value: number) => `limit:${String(value)}`,
};
const owner: ActorAccess = {
  principalId: "owner_1",
  responsibility: "workspace_owner",
  workspaceIds: ["workspace_1"],
  projectIds: [],
};

class Tables implements WorkbenchMutationTablesPort {
  rows: readonly unknown[] = [];
  assignmentRows: readonly unknown[] = [];
  feedback: unknown = {
    $id: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    assignedMaintainerId: "maintainer_1",
  };
  updates: Readonly<Record<string, unknown>>[] = [];
  transactions: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }[] = [];
  createTransaction() {
    return Promise.resolve({ $id: "transaction_1" });
  }
  getRow() {
    return Promise.resolve(this.feedback);
  }
  listRows(input: Parameters<WorkbenchMutationTablesPort["listRows"]>[0]) {
    return Promise.resolve({
      rows: input.tableId === "project_assignments" ? this.assignmentRows : this.rows,
    });
  }
  updateRow(input: Parameters<WorkbenchMutationTablesPort["updateRow"]>[0]) {
    this.updates.push(input.data);
    return Promise.resolve({ $id: input.rowId });
  }
  createRow(input: Parameters<WorkbenchMutationTablesPort["createRow"]>[0]) {
    return Promise.resolve({ $id: input.rowId });
  }
  updateTransaction(
    input: Parameters<WorkbenchMutationTablesPort["updateTransaction"]>[0],
  ) {
    this.transactions.push(input);
    return Promise.resolve({});
  }
}

function input(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    actor: owner,
    workspaceId: "workspace_1",
    projectId: "project_1",
    feedbackId: "feedback_1",
    command: {
      kind: "classify_feedback" as const,
      operationId: "operation_1",
      classification: "Performance",
    },
    payloadDigest: "digest_1234567890",
    occurredAt: "2026-08-28T10:00:00.000Z",
    ...overrides,
  };
}

describe("Appwrite Workbench mutation store", () => {
  it("BDD-WORK-011 commits a classification and its idempotency fact atomically", async () => {
    const tables = new Tables();
    await expect(
      createAppwriteWorkbenchMutationStore(tables, schema, queries).execute(input()),
    ).resolves.toEqual({
      status: "applied",
      feedbackId: "feedback_1",
      action: "classify_feedback",
    });
    expect(tables.updates).toEqual([{ workspaceClassification: "Performance" }]);
    expect(tables.transactions).toContainEqual({
      transactionId: "transaction_1",
      commit: true,
    });
  });

  it("BDD-WORK-012 replays the same operation and rejects payload reuse", async () => {
    const tables = new Tables();
    tables.rows = [
      {
        feedbackId: "feedback_1",
        operationId: "operation_1",
        payloadDigest: "digest_1234567890",
        action: "classify_feedback",
        resultJson: JSON.stringify({
          feedbackId: "feedback_1",
          action: "classify_feedback",
        }),
      },
    ];
    const store = createAppwriteWorkbenchMutationStore(tables, schema, queries);
    await expect(store.execute(input())).resolves.toMatchObject({ status: "replayed" });
    await expect(
      store.execute(input({ payloadDigest: "different_123456" })),
    ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-CONFLICT"));
  });

  it("BDD-WORK-013 denies privileged commands from a Maintainer and rolls back", async () => {
    const tables = new Tables();
    const maintainer: ActorAccess = {
      principalId: "maintainer_1",
      responsibility: "project_maintainer",
      workspaceIds: ["workspace_1"],
      projectIds: ["project_1"],
    };
    await expect(
      createAppwriteWorkbenchMutationStore(tables, schema, queries).execute(
        input({
          actor: maintainer,
          command: { kind: "delete_feedback", operationId: "operation_2" },
        }),
      ),
    ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-DENIED"));
    expect(tables.transactions).toContainEqual({
      transactionId: "transaction_1",
      rollback: true,
    });
  });

  it("BDD-WORK-014 records assignment removal and soft deletion", async () => {
    for (const [command, expected] of [
      [
        { kind: "unassign_feedback", operationId: "operation_3" },
        { assignedMaintainerId: null },
      ],
      [
        { kind: "delete_feedback", operationId: "operation_4" },
        { deletedAt: "2026-08-28T10:00:00.000Z" },
      ],
    ] as const) {
      const tables = new Tables();
      await createAppwriteWorkbenchMutationStore(tables, schema, queries).execute(
        input({ command }),
      );
      expect(tables.updates).toEqual([expected]);
    }
  });

  it("BDD-WORK-017 assigns only an active Maintainer of the scoped Project", async () => {
    const tables = new Tables();
    tables.assignmentRows = [
      {
        userId: "maintainer_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        status: "active",
      },
    ];
    await expect(
      createAppwriteWorkbenchMutationStore(tables, schema, queries).execute(
        input({
          command: {
            kind: "assign_feedback",
            operationId: "operation_5",
            maintainerId: "maintainer_1",
          },
        }),
      ),
    ).resolves.toMatchObject({ status: "applied" });
    expect(tables.updates).toEqual([{ assignedMaintainerId: "maintainer_1" }]);

    const denied = new Tables();
    await expect(
      createAppwriteWorkbenchMutationStore(denied, schema, queries).execute(
        input({
          command: {
            kind: "assign_feedback",
            operationId: "operation_6",
            maintainerId: "maintainer_1",
          },
        }),
      ),
    ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-DENIED"));
  });

  it("fails closed for invalid schema, inputs, duplicates and malformed replay facts", async () => {
    expect(() =>
      createAppwriteWorkbenchMutationStore(
        new Tables(),
        { ...schema, feedbackTableId: "bad id" },
        queries,
      ),
    ).toThrow("APPWRITE_WORKBENCH_MUTATION_SCHEMA_INVALID");
    expect(() =>
      createAppwriteWorkbenchMutationStore(
        new Tables(),
        { ...schema, idempotencyTableId: schema.feedbackTableId },
        queries,
      ),
    ).toThrow("APPWRITE_WORKBENCH_MUTATION_SCHEMA_INVALID");
    for (const override of [
      { feedbackId: "bad id" },
      { occurredAt: "invalid" },
      { payloadDigest: "short" },
      {
        command: {
          kind: "assign_feedback",
          operationId: "operation_7",
          maintainerId: "bad id",
        },
      },
    ])
      await expect(
        createAppwriteWorkbenchMutationStore(new Tables(), schema, queries).execute(
          input(override),
        ),
      ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-RETRYABLE"));

    const invalidTransaction = new Tables();
    vi.spyOn(invalidTransaction, "createTransaction").mockResolvedValueOnce({
      $id: "bad id",
    });
    await expect(
      createAppwriteWorkbenchMutationStore(invalidTransaction, schema, queries).execute(
        input(),
      ),
    ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-RETRYABLE"));
    for (const rows of [
      [{}, {}],
      [{}],
      [
        {
          feedbackId: "feedback_1",
          operationId: "operation_1",
          payloadDigest: "digest_1234567890",
          action: "classify_feedback",
          resultJson: "invalid",
        },
      ],
      [
        {
          feedbackId: "feedback_1",
          operationId: "operation_1",
          payloadDigest: "digest_1234567890",
          action: "classify_feedback",
          resultJson: "{}",
        },
      ],
    ]) {
      const tables = new Tables();
      tables.rows = rows;
      await expect(
        createAppwriteWorkbenchMutationStore(tables, schema, queries).execute(input()),
      ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-RETRYABLE"));
    }
  });

  it("rolls back failed writes and preserves a stable retryable outcome", async () => {
    for (const method of ["updateRow", "createRow"] as const) {
      const tables = new Tables();
      vi.spyOn(tables, method).mockResolvedValueOnce({ $id: "wrong" });
      await expect(
        createAppwriteWorkbenchMutationStore(tables, schema, queries).execute(input()),
      ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-RETRYABLE"));
      expect(tables.transactions).toContainEqual({
        transactionId: "transaction_1",
        rollback: true,
      });
    }
    const transport = new Tables();
    vi.spyOn(transport, "getRow").mockRejectedValueOnce(new Error("transport"));
    vi.spyOn(transport, "updateTransaction").mockRejectedValueOnce(
      new Error("rollback failed"),
    );
    await expect(
      createAppwriteWorkbenchMutationStore(transport, schema, queries).execute(input()),
    ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-RETRYABLE"));
  });

  it("denies malformed, deleted and cross-scope feedback records", async () => {
    for (const feedback of [
      null,
      { $id: "other", workspaceId: "workspace_1", projectId: "project_1" },
      { $id: "feedback_1", workspaceId: "workspace_2", projectId: "project_1" },
      { $id: "feedback_1", workspaceId: "workspace_1", projectId: "project_2" },
      {
        $id: "feedback_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        deletedAt: "2026-08-28T10:00:00+00:00",
      },
    ]) {
      const tables = new Tables();
      tables.feedback = feedback;
      await expect(
        createAppwriteWorkbenchMutationStore(tables, schema, queries).execute(input()),
      ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-DENIED"));
    }
  });
});
