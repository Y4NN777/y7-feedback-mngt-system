/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects explicit port mocks. */
import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteNotificationMaterializationStore,
  type AppwriteNotificationMaterializationTables,
} from "./appwrite-notification-materialization-store";
import type { NotificationMaterializationCommit } from "./notification-materializer";
import { createSensitiveDataProtector } from "./sensitive-data-protector";

const schema = {
  databaseId: "feedback",
  notificationsTableId: "notifications",
  outboxTableId: "notification_outbox",
};
const sensitive = {
  environment: "preview",
  protector: createSensitiveDataProtector(
    "test_key",
    [{ id: "test_key", material: Buffer.alloc(32, 9) }],
    () => Buffer.alloc(12, 4),
  ),
};
const commit: NotificationMaterializationCommit = {
  notification: {
    id: "notification_1",
    eventId: "event_1",
    feedbackId: "feedback_1",
    reporterId: "reporter_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    recipientId: "owner_1",
    recipientKind: "workspace_owner",
    kind: "lifecycle_changed",
    reference: "Y7-REF-12345678",
    createdAt: "2026-08-28T12:00:00.000Z",
    readAt: null,
  },
  deliveries: [
    {
      id: "delivery_1",
      notificationId: "notification_1",
      channel: "in_product",
      status: "pending",
      createdAt: "2026-08-28T12:00:00.000Z",
      payload: { kind: "in_product_invalidation" },
    },
  ],
};

function setup(rows: readonly unknown[] = []) {
  type CreateRowInput = Parameters<
    AppwriteNotificationMaterializationTables["createRow"]
  >[0];
  const writes: CreateRowInput[] = [];
  const tables: AppwriteNotificationMaterializationTables = {
    listRows: vi.fn(() => Promise.resolve({ rows })),
    createTransaction: vi.fn(() => Promise.resolve({ $id: "transaction_1" })),
    createRow: vi.fn((input: CreateRowInput) => {
      writes.push(input);
      return Promise.resolve({ $id: input.rowId });
    }),
    updateTransaction: vi.fn(() => Promise.resolve({})),
  };
  return {
    store: createAppwriteNotificationMaterializationStore(tables, schema, sensitive, {
      equal: (attribute, values) => `equal:${attribute}:${values.join(",")}`,
      limit: (value) => `limit:${String(value)}`,
    }),
    tables,
    writes,
  };
}

describe("Appwrite notification materialization", () => {
  it("BDD-NOT-APPWRITE-001 writes notification and encrypted outbox atomically", async () => {
    const target = setup();
    await target.store.commit(commit);
    expect(target.writes).toHaveLength(2);
    expect(target.writes[0]?.tableId).toBe("notifications");
    expect(target.writes[1]?.tableId).toBe("notification_outbox");
    const data = target.writes[1]?.data;
    expect(data?.payloadJson).not.toContain("in_product_invalidation");
    expect(target.tables.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction_1",
      commit: true,
    });
  });

  it("BDD-NOT-APPWRITE-002 finds a prior event-recipient pair exactly", async () => {
    const target = setup([{ $id: "notification_1" }]);
    await expect(target.store.hasEventRecipient("event_1", "owner_1")).resolves.toBe(
      true,
    );
    expect(target.tables.listRows).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "notifications",
      queries: ["equal:eventId:event_1", "equal:recipientId:owner_1", "limit:2"],
      total: false,
      ttl: 0,
    });
  });

  it("BDD-NOT-APPWRITE-003 rolls back partial writes and rejects duplicates", async () => {
    const failed = setup();
    vi.mocked(failed.tables.createRow).mockRejectedValueOnce(new Error("failed"));
    await expect(failed.store.commit(commit)).rejects.toThrow(
      "APPWRITE_NOTIFICATION_WRITE_UNAVAILABLE",
    );
    expect(failed.tables.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction_1",
      rollback: true,
    });

    await expect(
      setup([{ $id: "one" }, { $id: "two" }]).store.hasEventRecipient(
        "event_1",
        "owner_1",
      ),
    ).rejects.toThrow("APPWRITE_NOTIFICATION_DUPLICATE");
  });

  it("BDD-NOT-APPWRITE-004 rejects invalid schema and acknowledgements", async () => {
    expect(() =>
      createAppwriteNotificationMaterializationStore(
        setup().tables,
        { ...schema, notificationsTableId: "bad id" },
        sensitive,
      ),
    ).toThrow("APPWRITE_NOTIFICATION_SCHEMA_INVALID");

    const invalid = setup();
    vi.mocked(invalid.tables.createRow).mockResolvedValueOnce({ $id: "wrong" });
    await expect(invalid.store.commit(commit)).rejects.toThrow(
      "APPWRITE_NOTIFICATION_WRITE_UNAVAILABLE",
    );
  });
});
