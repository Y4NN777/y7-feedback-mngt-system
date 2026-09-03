import type { TablesDB } from "node-appwrite";
import { describe, expect, it, vi } from "vitest";

import {
  AppwriteConversationLifecycleError,
  createAppwriteConversationLifecycleStore,
  createNodeAppwriteConversationLifecycleStore,
  type AppwriteConversationLifecycleTablesPort,
} from "./appwrite-conversation-lifecycle-store";

const schema = {
  databaseId: "feedback",
  feedbackTableId: "feedback_items",
  messagesTableId: "conversation_messages",
  internalNotesTableId: "conversation_internal_notes",
  lifecycleTableId: "conversation_lifecycle",
  idempotencyTableId: "conversation_idempotency",
  accessGrantsTableId: "access_grants",
  reportersTableId: "reporters",
  workspaceMembershipsTableId: "workspace_memberships",
  projectAssignmentsTableId: "project_assignments",
  notificationsTableId: "notifications",
  notificationSignalsTableId: "notification_signals",
  outboxTableId: "notification_outbox",
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  limit: (value: number) => `limit:${String(value)}`,
  orderDesc: (attribute: string) => `desc:${attribute}`,
};
const project = {
  $id: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  state: "received",
};

class FakeTables implements AppwriteConversationLifecycleTablesPort {
  readonly created: Array<Record<string, unknown>> = [];
  readonly updated: Array<Record<string, unknown>> = [];
  readonly transactions: Array<Record<string, unknown>> = [];
  feedback: unknown = project;
  idempotencyRows: readonly unknown[] = [];
  lifecycleRows: readonly unknown[] = [];
  transactionId = "transaction_1";
  failCreateAt: number | undefined;
  failRollback = false;
  createResult: Readonly<Record<string, unknown>> | undefined;
  createResults: Array<Readonly<Record<string, unknown>>> = [];
  updateResult: Readonly<Record<string, unknown>> | undefined;

  createTransaction(): Promise<{ readonly $id: string }> {
    return Promise.resolve({ $id: this.transactionId });
  }

  getRow(): Promise<unknown> {
    return Promise.resolve(this.feedback);
  }

  listRows(
    input: Parameters<AppwriteConversationLifecycleTablesPort["listRows"]>[0],
  ): Promise<{ readonly rows: readonly unknown[] }> {
    return Promise.resolve({
      rows:
        input.tableId === "conversation_idempotency"
          ? this.idempotencyRows
          : this.lifecycleRows,
    });
  }

  createRow(
    input: Parameters<AppwriteConversationLifecycleTablesPort["createRow"]>[0],
  ): Promise<unknown> {
    this.created.push(input);
    return this.created.length === this.failCreateAt
      ? Promise.reject(new Error("forced write failure"))
      : Promise.resolve(
          this.createResults.shift() ?? this.createResult ?? { $id: input.rowId },
        );
  }

  updateRow(
    input: Parameters<AppwriteConversationLifecycleTablesPort["updateRow"]>[0],
  ): Promise<unknown> {
    this.updated.push(input);
    return Promise.resolve(this.updateResult ?? { $id: input.rowId });
  }

  updateTransaction(
    input: Parameters<AppwriteConversationLifecycleTablesPort["updateTransaction"]>[0],
  ): Promise<unknown> {
    this.transactions.push(input);
    if (input.rollback === true && this.failRollback) {
      return Promise.reject(new Error("forced rollback failure"));
    }
    return Promise.resolve({ $id: this.transactionId });
  }
}

const persistence = {
  environment: "preview",
  protector: {
    seal: (
      context: { readonly tableId: string; readonly rowId: string },
      plaintext: string,
    ) => `sealed:${context.tableId}:${context.rowId}:${plaintext}`,
    open: () => "unused",
  },
};

function store(
  tables: FakeTables,
  append = vi.fn().mockResolvedValue({
    notifications: 0,
    emailAttempts: 0,
  }),
  providerAppend = vi.fn().mockResolvedValue({ queued: 0 }),
) {
  return createAppwriteConversationLifecycleStore(
    tables,
    schema,
    queries,
    persistence,
    { append },
    { append: providerAppend },
  );
}

const common = {
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  payloadDigest: "digest_1",
  locale: "fr" as const,
};

const messageCommand = {
  kind: "append_message" as const,
  eventId: "message_1",
  actorId: "maintainer_1",
  actorKind: "workspace" as const,
  audience: "reporter" as const,
  occurredAt: "2026-08-28T12:00:00.000Z",
  content: "Which version is affected?",
};

describe("Appwrite conversation and lifecycle transaction", () => {
  it("BDD-CONV-001 appends one encrypted Reporter-visible Message and idempotency fact", async () => {
    const tables = new FakeTables();
    await expect(
      store(tables).execute({
        ...common,
        command: {
          kind: "append_message",
          eventId: "message_1",
          actorId: "maintainer_1",
          actorKind: "workspace",
          audience: "reporter",
          occurredAt: "2026-08-28T12:00:00.000Z",
          content: "Which version is affected?",
        },
      }),
    ).resolves.toMatchObject({ status: "applied", action: "append_message" });
    expect(tables.created[0]).toMatchObject({
      tableId: "conversation_messages",
      rowId: "message_1",
      permissions: [],
      data: {
        feedbackId: "feedback_1",
        audience: "reporter",
        contentEnvelope:
          "sealed:conversation_messages:message_1:Which version is affected?",
      },
    });
    expect(tables.created[1]?.tableId).toBe("conversation_idempotency");
    expect(tables.transactions.at(-1)).toEqual({
      transactionId: "transaction_1",
      commit: true,
    });
  });

  it("BDD-SYNC-FANOUT-007 commits the visible Message and provider outbox in one transaction", async () => {
    const tables = new FakeTables();
    const providerAppend = vi.fn().mockResolvedValue({ queued: 1 });
    await store(tables, undefined, providerAppend).execute({
      ...common,
      command: messageCommand,
    });
    expect(providerAppend).toHaveBeenCalledWith({
      transactionId: "transaction_1",
      feedbackId: "feedback_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      messageId: "message_1",
      actorKind: "workspace",
      audience: "reporter",
      content: "Which version is affected?",
      occurredAt: "2026-08-28T12:00:00.000Z",
    });
    expect(tables.transactions.at(-1)).toEqual({
      transactionId: "transaction_1",
      commit: true,
    });
  });

  it("BDD-SYNC-FANOUT-008 rolls back both facts if durable provider enqueue fails", async () => {
    const tables = new FakeTables();
    const providerAppend = vi.fn().mockRejectedValue(new Error("outbox unavailable"));
    await expect(
      store(tables, undefined, providerAppend).execute({
        ...common,
        command: messageCommand,
      }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));
    expect(tables.transactions.at(-1)).toEqual({
      transactionId: "transaction_1",
      rollback: true,
    });
  });

  it.each([
    {
      state: "under_review" as const,
      kind: "request_clarification" as const,
      expectedKind: "clarification_requested",
      audience: "both",
      actorKind: "workspace" as const,
    },
    {
      state: "awaiting_reporter" as const,
      kind: "reporter_answer" as const,
      expectedKind: "reporter_answered",
      audience: "workspace",
      actorKind: "reporter" as const,
    },
    {
      state: "under_review" as const,
      kind: "resolve" as const,
      expectedKind: "feedback_resolved",
      audience: "both",
      actorKind: "workspace" as const,
    },
    {
      state: "resolved" as const,
      kind: "close" as const,
      expectedKind: "feedback_closed",
      audience: "both",
      actorKind: "workspace" as const,
    },
    {
      state: "closed" as const,
      kind: "reopen" as const,
      expectedKind: "feedback_reopened",
      audience: "workspace",
      actorKind: "reporter" as const,
    },
  ])(
    "fans out $kind in the same transaction",
    async ({ state, kind, expectedKind, audience, actorKind }) => {
      const tables = new FakeTables();
      tables.feedback = { ...project, state };
      const append = vi.fn().mockResolvedValue({ notifications: 1, emailAttempts: 1 });
      await store(tables, append).execute({
        ...common,
        locale: "en",
        command: {
          kind,
          eventId: `event_${kind}`,
          expectedVersion: 1,
          actorId: actorKind === "reporter" ? "reporter_1" : "maintainer_1",
          actorKind,
          occurredAt: messageCommand.occurredAt,
          reason: "Observable transition",
        },
      });
      expect(append).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: "transaction_1",
          eventId: `event_${kind}`,
          kind: expectedKind,
          audience,
          locale: "en",
          actor: {
            kind: actorKind,
            id: actorKind === "reporter" ? "reporter_1" : "maintainer_1",
          },
        }),
      );
    },
  );

  it.each([
    {
      actorKind: "reporter" as const,
      actorId: "reporter_1",
      audience: "reporter" as const,
      expectedKind: "reporter_answered",
      expectedAudience: "workspace",
    },
    {
      actorKind: "workspace" as const,
      actorId: "maintainer_1",
      audience: "workspace" as const,
      expectedKind: "message_added",
      expectedAudience: "workspace",
    },
  ])(
    "maps $actorKind conversation messages to their notification audience",
    async ({ actorKind, actorId, audience, expectedKind, expectedAudience }) => {
      const tables = new FakeTables();
      const append = vi.fn().mockResolvedValue({ notifications: 1, emailAttempts: 1 });
      await store(tables, append).execute({
        ...common,
        command: {
          kind: "append_message",
          eventId: `message_${actorKind}`,
          actorId,
          actorKind,
          audience,
          occurredAt: messageCommand.occurredAt,
          content: "Visible conversation content",
        },
      });
      expect(append).toHaveBeenCalledWith(
        expect.objectContaining({ kind: expectedKind, audience: expectedAudience }),
      );
    },
  );

  it("BDD-CONV-002 stores Internal Notes in a distinct encrypted table", async () => {
    const tables = new FakeTables();
    await store(tables).execute({
      ...common,
      command: {
        kind: "append_internal_note",
        eventId: "note_1",
        actorId: "maintainer_1",
        actorKind: "workspace",
        occurredAt: "2026-08-28T12:00:00.000Z",
        content: "Private reproduction detail",
      },
    });
    const note = tables.created[0];
    expect(note?.tableId).toBe("conversation_internal_notes");
    expect((note?.data as Record<string, unknown> | undefined)?.audience).toBe(
      "workspace",
    );
    expect(JSON.stringify(tables.created)).not.toContain(
      '"content":"Private reproduction detail"',
    );
  });

  it("BDD-LIFE-001 compare-and-sets state and appends an immutable encrypted fact", async () => {
    const tables = new FakeTables();
    await expect(
      store(tables).execute({
        ...common,
        command: {
          kind: "start_review",
          eventId: "event_1",
          expectedVersion: 1,
          actorId: "maintainer_1",
          actorKind: "workspace",
          occurredAt: "2026-08-28T12:00:00.000Z",
          reason: "Triage started",
        },
      }),
    ).resolves.toMatchObject({ state: "under_review", version: 2 });
    expect(tables.updated).toEqual([
      expect.objectContaining({
        tableId: "feedback_items",
        rowId: "feedback_1",
        data: { state: "under_review" },
      }),
    ]);
    const lifecycle = tables.created[0];
    const lifecycleData = lifecycle?.data as Record<string, unknown> | undefined;
    expect(lifecycle?.tableId).toBe("conversation_lifecycle");
    expect(lifecycleData?.priorState).toBe("received");
    expect(lifecycleData?.state).toBe("under_review");
    expect(lifecycleData?.sequence).toBe(2);
    expect(lifecycleData?.reasonEnvelope).toBe(
      "sealed:conversation_lifecycle:event_1:Triage started",
    );
  });

  it("BDD-LIFE-003 rejects stale and cross-scope state without facts", async () => {
    const stale = new FakeTables();
    stale.feedback = { ...project, state: "under_review" };
    stale.lifecycleRows = [
      {
        $id: "event_2",
        feedbackId: "feedback_1",
        state: "under_review",
        sequence: 3,
      },
      {
        $id: "event_1",
        feedbackId: "feedback_1",
        state: "under_review",
        sequence: 2,
      },
    ];
    await expect(
      store(stale).execute({
        ...common,
        command: {
          kind: "start_review",
          eventId: "event_2",
          expectedVersion: 1,
          actorId: "maintainer_1",
          actorKind: "workspace",
          occurredAt: "2026-08-28T12:01:00.000Z",
          reason: "Stale",
        },
      }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-STALE"));
    const cross = new FakeTables();
    cross.feedback = { ...project, workspaceId: "workspace_2" };
    await expect(
      store(cross).execute({
        ...common,
        command: {
          kind: "append_message",
          eventId: "message_1",
          actorId: "maintainer_1",
          actorKind: "workspace",
          audience: "reporter",
          occurredAt: "2026-08-28T12:00:00.000Z",
          content: "Denied",
        },
      }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-DENIED"));
    expect(cross.created).toHaveLength(0);
  });

  it("BDD-CONV-004 replays identical operations and conflicts on digest reuse", async () => {
    const result = {
      feedbackId: "feedback_1",
      action: "append_message",
    };
    const row = {
      $id: "idem_1",
      feedbackId: "feedback_1",
      operationId: "message_1",
      payloadDigest: "digest_1",
      action: "append_message",
      resultJson: JSON.stringify(result),
    };
    const replay = new FakeTables();
    replay.idempotencyRows = [row];
    await expect(
      store(replay).execute({
        ...common,
        command: {
          kind: "append_message",
          eventId: "message_1",
          actorId: "reporter_1",
          actorKind: "reporter",
          audience: "reporter",
          occurredAt: "2026-08-28T12:00:00.000Z",
          content: "Version 2.1",
        },
      }),
    ).resolves.toEqual({ status: "replayed", ...result });
    const conflict = new FakeTables();
    conflict.idempotencyRows = [{ ...row, payloadDigest: "other" }];
    await expect(
      store(conflict).execute({
        ...common,
        command: {
          kind: "append_message",
          eventId: "message_1",
          actorId: "reporter_1",
          actorKind: "reporter",
          audience: "reporter",
          occurredAt: "2026-08-28T12:00:00.000Z",
          content: "Changed",
        },
      }),
    ).rejects.toEqual(
      new AppwriteConversationLifecycleError("ERR-CONV-IDEMPOTENCY-CONFLICT"),
    );
  });

  it("BDD-CONV-FAIL-001 rolls back partial writes and hides adapter detail", async () => {
    const tables = new FakeTables();
    tables.failCreateAt = 2;
    tables.failRollback = true;
    await expect(
      store(tables).execute({
        ...common,
        command: {
          kind: "append_message",
          eventId: "message_1",
          actorId: "maintainer_1",
          actorKind: "workspace",
          audience: "reporter",
          occurredAt: "2026-08-28T12:00:00.000Z",
          content: "Will roll back",
        },
      }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));
    expect(tables.transactions.at(-1)).toEqual({
      transactionId: "transaction_1",
      rollback: true,
    });
  });

  it("rolls back the source transaction when durable notification fanout cannot be staged", async () => {
    const tables = new FakeTables();
    const append = vi.fn().mockRejectedValue(new Error("forced fanout failure"));
    await expect(
      store(tables, append).execute({ ...common, command: messageCommand }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));
    expect(tables.created).toHaveLength(1);
    expect(tables.created[0]?.tableId).toBe("conversation_messages");
    expect(tables.transactions.at(-1)).toEqual({
      transactionId: "transaction_1",
      rollback: true,
    });
  });

  it("rejects invalid schema and malformed transaction or duplicate idempotency state", async () => {
    expect(() =>
      createAppwriteConversationLifecycleStore(
        new FakeTables(),
        { ...schema, messagesTableId: schema.feedbackTableId },
        queries,
        persistence,
        { append: vi.fn() },
      ),
    ).toThrow("APPWRITE_CONVERSATION_SCHEMA_INVALID");
    expect(() =>
      createAppwriteConversationLifecycleStore(
        new FakeTables(),
        { ...schema, databaseId: "bad/id" },
        queries,
        persistence,
        { append: vi.fn() },
      ),
    ).toThrow("APPWRITE_CONVERSATION_SCHEMA_INVALID");

    const invalidTransaction = new FakeTables();
    invalidTransaction.transactionId = "bad/id";
    await expect(
      store(invalidTransaction).execute({ ...common, command: messageCommand }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));

    const duplicate = new FakeTables();
    duplicate.idempotencyRows = [{}, {}];
    await expect(
      store(duplicate).execute({ ...common, command: messageCommand }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));
  });

  it("fails closed for malformed idempotency and authoritative Feedback rows", async () => {
    const malformedIdempotency: readonly unknown[] = [
      null,
      {},
      {
        feedbackId: "feedback_1",
        operationId: "message_1",
        action: "append_message",
        payloadDigest: "digest_1",
        resultJson: "not-json",
      },
      {
        feedbackId: "feedback_1",
        operationId: "message_1",
        action: "append_message",
        payloadDigest: "digest_1",
        resultJson: JSON.stringify({ feedbackId: "other", action: "append_message" }),
      },
    ];
    for (const row of malformedIdempotency) {
      const tables = new FakeTables();
      tables.idempotencyRows = [row];
      await expect(
        store(tables).execute({ ...common, command: messageCommand }),
      ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));
    }

    const malformedFeedback: readonly unknown[] = [
      null,
      [],
      { ...project, $id: "other" },
      { ...project, projectId: "other" },
      { ...project, state: 4 },
      { ...project, state: "unknown" },
    ];
    for (const feedback of malformedFeedback) {
      const tables = new FakeTables();
      tables.feedback = feedback;
      await expect(
        store(tables).execute({ ...common, command: messageCommand }),
      ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-DENIED"));
    }
  });

  it("maps invalid and denied domain commands to stable non-disclosing errors", async () => {
    await expect(
      store(new FakeTables()).execute({
        ...common,
        command: { ...messageCommand, content: " " },
      }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-INVALID"));
    await expect(
      store(new FakeTables()).execute({
        ...common,
        command: {
          kind: "append_internal_note",
          eventId: "note_1",
          actorId: "reporter_1",
          actorKind: "reporter",
          occurredAt: messageCommand.occurredAt,
          content: "Not authorized",
        } as never,
      }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-DENIED"));
    await expect(
      store(new FakeTables()).execute({
        ...common,
        command: {
          kind: "start_review",
          eventId: "event_1",
          expectedVersion: 1,
          actorId: "reporter_1",
          actorKind: "reporter",
          occurredAt: messageCommand.occurredAt,
          reason: "Denied",
        },
      }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-DENIED"));
    await expect(
      store(new FakeTables()).execute({
        ...common,
        command: {
          kind: "start_review",
          eventId: "event_1",
          expectedVersion: 1,
          actorId: "maintainer_1",
          actorKind: "workspace",
          occurredAt: messageCommand.occurredAt,
          reason: " ",
        },
      }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-INVALID"));
  });

  it("rejects malformed lifecycle history and invalid adapter write acknowledgements", async () => {
    for (const lifecycleRows of [
      [
        { feedbackId: "feedback_1", state: "under_review", sequence: 2 },
        { feedbackId: "feedback_1", state: "received", sequence: 3 },
      ],
      [null, { sequence: 1 }],
      [{ sequence: 2 }, null],
      [{ sequence: "2" }, { sequence: 1 }],
      [{ sequence: 2 }, { sequence: "1" }],
    ] as const) {
      const unordered = new FakeTables();
      unordered.feedback = { ...project, state: "under_review" };
      unordered.lifecycleRows = lifecycleRows;
      await expect(
        store(unordered).execute({
          ...common,
          command: {
            kind: "resolve",
            eventId: "event_2",
            expectedVersion: 2,
            actorId: "maintainer_1",
            actorKind: "workspace",
            occurredAt: messageCommand.occurredAt,
            reason: "Resolved",
          },
        }),
      ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));
    }

    for (const lifecycleRows of [
      [null],
      [{ feedbackId: "other", state: "under_review", sequence: 2 }],
      [{ feedbackId: "feedback_1", state: "under_review", sequence: 1.5 }],
      [{ feedbackId: "feedback_1", state: "unknown", sequence: 2 }],
    ] as const) {
      const tables = new FakeTables();
      tables.feedback = { ...project, state: "under_review" };
      tables.lifecycleRows = lifecycleRows;
      await expect(
        store(tables).execute({
          ...common,
          command: {
            kind: "resolve",
            eventId: "event_2",
            expectedVersion: 2,
            actorId: "maintainer_1",
            actorKind: "workspace",
            occurredAt: messageCommand.occurredAt,
            reason: "Resolved",
          },
        }),
      ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));
    }

    const invalidMessageWrite = new FakeTables();
    invalidMessageWrite.createResult = { $id: "other" };
    await expect(
      store(invalidMessageWrite).execute({ ...common, command: messageCommand }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));

    const invalidLifecycleUpdate = new FakeTables();
    invalidLifecycleUpdate.updateResult = { $id: "other" };
    await expect(
      store(invalidLifecycleUpdate).execute({
        ...common,
        command: {
          kind: "start_review",
          eventId: "event_1",
          expectedVersion: 1,
          actorId: "maintainer_1",
          actorKind: "workspace",
          occurredAt: messageCommand.occurredAt,
          reason: "Review",
        },
      }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));

    const invalidLifecycleFact = new FakeTables();
    invalidLifecycleFact.createResult = { $id: "other" };
    await expect(
      store(invalidLifecycleFact).execute({
        ...common,
        command: {
          kind: "start_review",
          eventId: "event_1",
          expectedVersion: 1,
          actorId: "maintainer_1",
          actorKind: "workspace",
          occurredAt: messageCommand.occurredAt,
          reason: "Review",
        },
      }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));

    const invalidIdempotencyWrite = new FakeTables();
    invalidIdempotencyWrite.createResults = [{ $id: "message_1" }, { $id: "other" }];
    await expect(
      store(invalidIdempotencyWrite).execute({ ...common, command: messageCommand }),
    ).rejects.toEqual(new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE"));
  });

  it("adapts every Node Appwrite operation and the official query encoder", async () => {
    const tables = {
      createTransaction: vi.fn().mockResolvedValue({ $id: "transaction_1" }),
      getRow: vi.fn().mockResolvedValue(project),
      listRows: vi.fn().mockResolvedValue({ rows: [] }),
      createRow: vi.fn((input: { readonly rowId: string }) =>
        Promise.resolve({ $id: input.rowId }),
      ),
      updateRow: vi.fn((input: { readonly rowId: string }) =>
        Promise.resolve({ $id: input.rowId }),
      ),
      updateTransaction: vi.fn().mockResolvedValue({ $id: "transaction_1" }),
    };
    const nodeStore = createNodeAppwriteConversationLifecycleStore(
      tables as unknown as TablesDB,
      schema,
      persistence,
      { append: vi.fn().mockResolvedValue({ notifications: 0, emailAttempts: 0 }) },
    );
    await expect(
      nodeStore.execute({ ...common, command: messageCommand }),
    ).resolves.toMatchObject({ status: "applied" });
    expect(tables.createTransaction).toHaveBeenCalledWith({ ttl: 60 });
    expect(tables.getRow).toHaveBeenCalledTimes(1);
    expect(tables.listRows).toHaveBeenCalledTimes(1);
    expect(tables.createRow).toHaveBeenCalledTimes(2);
    expect(tables.updateTransaction).toHaveBeenCalledWith({
      transactionId: "transaction_1",
      commit: true,
    });

    tables.listRows.mockResolvedValue({ rows: [] });
    await expect(
      nodeStore.execute({
        ...common,
        payloadDigest: "digest_2",
        command: {
          kind: "start_review",
          eventId: "event_2",
          expectedVersion: 1,
          actorId: "maintainer_1",
          actorKind: "workspace",
          occurredAt: messageCommand.occurredAt,
          reason: "Review",
        },
      }),
    ).resolves.toMatchObject({ state: "under_review", version: 2 });
    expect(tables.updateRow).toHaveBeenCalledTimes(1);
    expect(tables.listRows).toHaveBeenCalledTimes(3);
  });
});
