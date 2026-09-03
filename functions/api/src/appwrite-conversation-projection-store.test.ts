import type { TablesDB } from "node-appwrite";
import { describe, expect, it, vi } from "vitest";

import {
  AppwriteConversationProjectionError,
  createAppwriteConversationProjectionStore,
  createNodeAppwriteConversationProjectionStore,
  type AppwriteConversationProjectionTablesPort,
} from "./appwrite-conversation-projection-store";

const schema = {
  databaseId: "feedback",
  feedbackTableId: "feedback_items",
  messagesTableId: "conversation_messages",
  internalNotesTableId: "conversation_internal_notes",
  lifecycleTableId: "conversation_lifecycle",
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  limit: (value: number) => `limit:${String(value)}`,
  orderAsc: (attribute: string) => `asc:${attribute}`,
};
const feedback = {
  $id: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  state: "under_review",
};
const message = {
  $id: "message_1",
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  actorId: "maintainer_1",
  actorKind: "workspace",
  audience: "reporter",
  contentEnvelope: "sealed:Which version?",
  occurredAt: "2026-08-28T12:00:00.000Z",
};
const providerRevision = {
  ...message,
  $id: "message_2",
  origin: "provider",
  provider: "github",
  revisionKind: "revised",
  supersedesMessageId: "message_1",
};
const note = {
  $id: "note_1",
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  actorId: "maintainer_1",
  actorKind: "workspace",
  audience: "workspace",
  contentEnvelope: "sealed:Private reproduction",
  occurredAt: "2026-08-28T12:01:00.000Z",
};
const fact = {
  $id: "event_1",
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  actorId: "maintainer_1",
  actorKind: "workspace",
  priorState: "received",
  state: "under_review",
  reasonEnvelope: "sealed:Triage started",
  occurredAt: "2026-08-28T12:02:00.000Z",
  sequence: 2,
};

class FakeTables implements AppwriteConversationProjectionTablesPort {
  readonly calls: Array<Record<string, unknown>> = [];
  feedback: unknown = feedback;
  messages: readonly unknown[] = [message];
  notes: readonly unknown[] = [note];
  lifecycle: readonly unknown[] = [fact];

  getRow(input: Parameters<AppwriteConversationProjectionTablesPort["getRow"]>[0]) {
    this.calls.push({ operation: "get", ...input });
    return Promise.resolve(this.feedback);
  }

  listRows(input: Parameters<AppwriteConversationProjectionTablesPort["listRows"]>[0]) {
    this.calls.push({ operation: "list", ...input });
    const rows =
      input.tableId === schema.messagesTableId
        ? this.messages
        : input.tableId === schema.internalNotesTableId
          ? this.notes
          : this.lifecycle;
    return Promise.resolve({ rows });
  }
}

const persistence = {
  environment: "preview",
  protector: {
    seal: () => "unused",
    open: (
      context: { readonly tableId: string; readonly rowId: string },
      envelope: string,
    ) => `${context.tableId}:${context.rowId}:${envelope.slice("sealed:".length)}`,
  },
};

function store(tables: FakeTables) {
  return createAppwriteConversationProjectionStore(
    tables,
    schema,
    queries,
    persistence,
  );
}

describe("Appwrite Conversation projections", () => {
  it("BDD-CONV-PROJ-001 reads Workspace messages, notes and lifecycle in scope", async () => {
    const tables = new FakeTables();
    await expect(
      store(tables).readWorkspace({
        feedbackId: "feedback_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toEqual({
      feedbackId: "feedback_1",
      state: "under_review",
      messages: [
        expect.objectContaining({
          id: "message_1",
          content: "conversation_messages:message_1:Which version?",
        }),
      ],
      internalNotes: [
        expect.objectContaining({
          id: "note_1",
          audience: "workspace",
          content: "conversation_internal_notes:note_1:Private reproduction",
        }),
      ],
      lifecycle: [
        expect.objectContaining({
          id: "event_1",
          state: "under_review",
          reason: "conversation_lifecycle:event_1:Triage started",
        }),
      ],
    });
  });

  it("BDD-CONV-PROJ-002 never queries or exposes Internal Notes to Reporter", async () => {
    const tables = new FakeTables();
    const projection = await store(tables).readReporter({ feedbackId: "feedback_1" });
    expect(projection.messages).toHaveLength(1);
    expect("internalNotes" in projection).toBe(false);
    expect(JSON.stringify(projection)).not.toContain("Private reproduction");
    expect(
      tables.calls.some((call) => call.tableId === schema.internalNotesTableId),
    ).toBe(false);
    const messageCall = tables.calls.find(
      (call) => call.tableId === schema.messagesTableId,
    );
    expect(messageCall?.queries).toContain("equal:audience:reporter");
  });

  it("FR-SYNC-010 exposes append-only provider revision provenance", async () => {
    const tables = new FakeTables();
    tables.messages = [providerRevision];
    await expect(
      store(tables).readReporter({ feedbackId: "feedback_1" }),
    ).resolves.toMatchObject({
      messages: [
        {
          id: "message_2",
          provider: "github",
          revisionKind: "revised",
          supersedesMessageId: "message_1",
        },
      ],
    });
  });

  it("FR-SYNC-010 exposes created and tombstoned provider facts distinctly", async () => {
    const tables = new FakeTables();
    tables.messages = [
      {
        ...providerRevision,
        $id: "message_3",
        revisionKind: "created",
        supersedesMessageId: undefined,
      },
      { ...providerRevision, $id: "message_4", revisionKind: "tombstoned" },
    ];
    await expect(
      store(tables).readReporter({ feedbackId: "feedback_1" }),
    ).resolves.toMatchObject({
      messages: [
        { revisionKind: "created", provider: "github" },
        { revisionKind: "tombstoned", supersedesMessageId: "message_1" },
      ],
    });
  });

  it("fails closed on scope mismatch and malformed authoritative rows", async () => {
    const denied = new FakeTables();
    await expect(
      store(denied).readWorkspace({
        feedbackId: "feedback_1",
        workspaceId: "workspace_2",
        projectId: "project_1",
      }),
    ).rejects.toEqual(new AppwriteConversationProjectionError("ERR-CONV-DENIED"));

    for (const malformed of [null, [], { ...feedback, state: "unknown" }]) {
      const tables = new FakeTables();
      tables.feedback = malformed;
      await expect(
        store(tables).readReporter({ feedbackId: "feedback_1" }),
      ).rejects.toEqual(new AppwriteConversationProjectionError("ERR-CONV-DENIED"));
    }
    for (const malformed of [
      null,
      { ...message, audience: "workspace" },
      { ...message, contentEnvelope: 4 },
      { ...providerRevision, provider: "unknown" },
      { ...providerRevision, supersedesMessageId: undefined },
    ]) {
      const tables = new FakeTables();
      tables.messages = [malformed];
      await expect(
        store(tables).readReporter({ feedbackId: "feedback_1" }),
      ).rejects.toEqual(new AppwriteConversationProjectionError("ERR-CONV-RETRYABLE"));
    }
    const badFact = new FakeTables();
    badFact.lifecycle = [{ ...fact, sequence: 1 }];
    await expect(
      store(badFact).readReporter({ feedbackId: "feedback_1" }),
    ).rejects.toEqual(new AppwriteConversationProjectionError("ERR-CONV-RETRYABLE"));
  });

  it("validates schema and hides decryption or adapter detail", async () => {
    expect(() =>
      createAppwriteConversationProjectionStore(
        new FakeTables(),
        { ...schema, messagesTableId: schema.lifecycleTableId },
        queries,
        persistence,
      ),
    ).toThrow("APPWRITE_CONVERSATION_PROJECTION_SCHEMA_INVALID");
    expect(() =>
      createAppwriteConversationProjectionStore(
        new FakeTables(),
        { ...schema, databaseId: "bad/id" },
        queries,
        persistence,
      ),
    ).toThrow("APPWRITE_CONVERSATION_PROJECTION_SCHEMA_INVALID");
    const tables = new FakeTables();
    const broken = store(tables);
    tables.messages = [{ ...message, contentEnvelope: "broken" }];
    const rejectingPersistence = {
      ...persistence,
      protector: {
        ...persistence.protector,
        open: () => {
          throw new Error("crypto");
        },
      },
    };
    await expect(
      createAppwriteConversationProjectionStore(
        tables,
        schema,
        queries,
        rejectingPersistence,
      ).readReporter({ feedbackId: "feedback_1" }),
    ).rejects.toEqual(new AppwriteConversationProjectionError("ERR-CONV-RETRYABLE"));
    expect(broken).toBeDefined();
  });

  it("adapts the Node Appwrite client and official query encoder", async () => {
    const tables = {
      getRow: vi.fn().mockResolvedValue(feedback),
      listRows: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ ...message, actorId: "reporter_1", actorKind: "reporter" }],
        })
        .mockResolvedValueOnce({ rows: [fact] }),
    };
    const nodeStore = createNodeAppwriteConversationProjectionStore(
      tables as unknown as TablesDB,
      schema,
      persistence,
    );
    await expect(
      nodeStore.readReporter({ feedbackId: "feedback_1" }),
    ).resolves.toMatchObject({ feedbackId: "feedback_1" });
    expect(tables.listRows).toHaveBeenCalledTimes(2);
    const firstCall = tables.listRows.mock.calls[0]?.[0] as unknown as
      { readonly queries: readonly string[] } | undefined;
    expect(firstCall?.queries).toHaveLength(4);
  });
});
