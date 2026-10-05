import { describe, expect, it, vi } from "vitest";

import {
  createAppwritePlatformContentReader,
  type AppwritePlatformContentTables,
} from "./appwrite-platform-content-reader";

const schema = {
  databaseId: "feedback",
  feedbackTableId: "feedback_items",
  messagesTableId: "conversation_messages",
  internalNotesTableId: "conversation_internal_notes",
  attachmentsTableId: "attachments",
  attachmentStagingTableId: "attachment_staging",
} as const;
const sensitive = {
  environment: "preview",
  protector: {
    seal: (_context: unknown, value: string) => `sealed:${value}`,
    open: (_context: unknown, value: string) => {
      if (!value.startsWith("sealed:")) throw new Error("invalid envelope");
      return value.slice(7);
    },
  },
};
const feedback = {
  $id: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  type: "bug",
  state: "received",
  acceptedAt: "2026-09-03T12:00:00.000Z",
  currentSourceJson: 'sealed:{"type":"bug","problem":"Upload fails"}',
  contextJson: "sealed:[]",
  attachmentNamesJson: 'sealed:["trace.txt"]',
  workspaceClassification: null,
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
  occurredAt: "2026-09-03T12:01:00.000Z",
};
const note = {
  ...message,
  $id: "note_1",
  audience: "workspace",
  contentEnvelope: "sealed:Private diagnosis",
};
const attachment = {
  $id: "attachment_1",
  objectId: "private/object_1",
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  audience: "reporter",
  sourceKind: "source_submission",
  sourceEntryId: "source_1",
  displayName: "sealed:trace.txt",
  mediaType: "text/plain; charset=utf-8",
  size: 12,
  sha256: "digest_value",
  createdAt: "2026-09-03T12:00:00.000Z",
  lifecycle: "available",
  operationId: "123e4567-e89b-42d3-a456-426614174000",
};

function setup() {
  const getRow = vi.fn(() => Promise.resolve(feedback));
  const listRows = vi.fn(
    (input: Parameters<AppwritePlatformContentTables["listRows"]>[0]) =>
      Promise.resolve({
        rows:
          input.tableId === schema.messagesTableId
            ? [message]
            : input.tableId === schema.internalNotesTableId
              ? [note]
              : [attachment],
      }),
  );
  const reader = createAppwritePlatformContentReader(
    { getRow, listRows },
    schema,
    {
      equal: (attribute, values) => `equal:${attribute}:${values.join(",")}`,
      orderAsc: (attribute) => `asc:${attribute}`,
      limit: (value) => `limit:${String(value)}`,
    },
    sensitive,
  );
  const command = {
    kind: "use" as const,
    operationId: "123e4567-e89b-42d3-a456-426614174000",
    grantId: "grant_1",
    expectedRevision: 1,
    workspaceId: "workspace_1",
    projectId: "project_1",
    feedbackId: "feedback_1",
    action: "feedback.read" as const,
  };
  return { reader, getRow, listRows, command };
}

describe("Appwrite Platform exceptional content reader", () => {
  it("BDD-PLAT-130 derives scope and returns only the selected projection", async () => {
    const target = setup();
    for (const [action, kind] of [
      ["feedback.read", "feedback"],
      ["message.read", "messages"],
      ["internal_note.read", "internal_notes"],
      ["attachment.read", "attachments"],
    ] as const) {
      const result = await target.reader.read({
        command: { ...target.command, action },
        transactionId: "transaction_1",
      });
      expect(result).toMatchObject({
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        content: { kind },
      });
      expect(JSON.stringify(result.content)).not.toContain("private/object_1");
    }
    expect(target.getRow).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: "transaction_1" }),
    );
    expect(target.listRows).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: "transaction_1" }),
    );
  });

  it("BDD-PLAT-131 fails closed on an incomplete or mismatched resource scope", async () => {
    const target = setup();
    const incomplete = {
      kind: target.command.kind,
      operationId: target.command.operationId,
      grantId: target.command.grantId,
      expectedRevision: target.command.expectedRevision,
      workspaceId: target.command.workspaceId,
      feedbackId: target.command.feedbackId,
      action: target.command.action,
    };
    await expect(
      target.reader.read({
        command: incomplete,
        transactionId: "transaction_1",
      }),
    ).rejects.toThrow("PLATFORM_CONTENT_SCOPE_INVALID");
    target.getRow.mockResolvedValueOnce({ ...feedback, workspaceId: "workspace_2" });
    await expect(
      target.reader.read({ command: target.command, transactionId: "transaction_1" }),
    ).rejects.toThrow();
    target.listRows.mockResolvedValueOnce({
      rows: [{ ...attachment, workspaceId: "workspace_2" }],
    });
    await expect(
      target.reader.read({
        command: { ...target.command, action: "attachment.read" },
        transactionId: "transaction_1",
      }),
    ).rejects.toThrow("PLATFORM_CONTENT_SCOPE_INVALID");
  });

  it("BDD-PLAT-132 rejects schemas that could alias protected tables", () => {
    const target = setup();
    expect(() =>
      createAppwritePlatformContentReader(
        { getRow: target.getRow, listRows: target.listRows },
        { ...schema, attachmentsTableId: schema.messagesTableId },
        {
          equal: () => "equal",
          orderAsc: () => "asc",
          limit: () => "limit",
        },
        sensitive,
      ),
    ).toThrow("PLATFORM_CONTENT_SCHEMA_INVALID");
  });
});
