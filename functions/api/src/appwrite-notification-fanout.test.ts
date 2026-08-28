import { describe, expect, it, vi } from "vitest";

import { createSensitiveDataProtector } from "./sensitive-data-protector";
import {
  appendAppwriteNotificationFanout,
  type AppwriteNotificationFanoutTablesPort,
} from "./appwrite-notification-fanout";

const schema = {
  databaseId: "feedback",
  accessGrantsTableId: "access_grants",
  reportersTableId: "reporters",
  workspaceMembershipsTableId: "workspace_memberships",
  projectAssignmentsTableId: "project_assignments",
  notificationsTableId: "notifications",
  notificationSignalsTableId: "notification_signals",
  outboxTableId: "notification_outbox",
};
const permissions = { readUser: (userId: string) => `read("user:${userId}")` };
const protector = createSensitiveDataProtector("active", [
  {
    id: "active",
    material: Buffer.alloc(32, 11),
  },
]);
const persistence = { environment: "preview" as const, protector };

function setup(options: { readonly assignmentActive?: boolean } = {}) {
  const createRow = vi.fn<AppwriteNotificationFanoutTablesPort["createRow"]>((input) =>
    Promise.resolve({ $id: input.rowId }),
  );
  const getRow = vi.fn<AppwriteNotificationFanoutTablesPort["getRow"]>((input) => {
    if (input.tableId === "access_grants") {
      return Promise.resolve({
        $id: "feedback_1",
        feedbackId: "feedback_1",
        reference: "Y7-NOTIFY-12345678",
        status: "active",
      });
    }
    return Promise.resolve({
      $id: "reporter_1",
      workspaceId: "workspace_1",
      attributionJson: protector.seal(
        {
          environment: "preview",
          tableId: "reporters",
          rowId: "reporter_1",
          field: "attributionJson",
        },
        JSON.stringify({
          kind: "contact",
          value: "private@example.test",
          purpose: "reply",
        }),
      ),
    });
  });
  const listRows = vi.fn<AppwriteNotificationFanoutTablesPort["listRows"]>((input) => {
    if (input.tableId === "workspace_memberships") {
      return Promise.resolve({
        rows: [
          {
            $id: "membership_1",
            workspaceId: "workspace_1",
            userId: "owner_1",
            role: "workspace_owner",
            status: "active",
          },
        ],
      });
    }
    return Promise.resolve({
      rows:
        options.assignmentActive === false
          ? []
          : [
              {
                $id: "assignment_1",
                workspaceId: "workspace_1",
                projectId: "project_1",
                userId: "maintainer_1",
                status: "active",
              },
            ],
    });
  });
  return { createRow, getRow, listRows };
}

const feedback = {
  $id: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  reporterId: "reporter_1",
  assignedMaintainerId: "maintainer_1",
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `${attribute}=${values.join(",")}`,
  limit: (value: number) => `limit=${String(value)}`,
};

function execute(
  target: ReturnType<typeof setup>,
  overrides: Readonly<Record<string, unknown>> = {},
  schemaOverride = schema,
) {
  return appendAppwriteNotificationFanout(
    target,
    schemaOverride,
    queries,
    permissions,
    persistence,
    {
      transactionId: "transaction_1",
      feedback,
      eventId: "event_default",
      kind: "feedback_resolved",
      occurredAt: "2026-08-28T20:00:00.000Z",
      locale: "fr",
      audience: "both",
      actor: { kind: "system", id: "system_1" },
      ...overrides,
    },
  );
}

describe("Appwrite notification fanout", () => {
  it.each([
    { ...schema, databaseId: "bad id" },
    { ...schema, notificationsTableId: "bad id" },
    { ...schema, outboxTableId: schema.notificationsTableId },
  ])("rejects an invalid fanout schema", async (invalid) => {
    await expect(execute(setup(), {}, invalid)).rejects.toThrow(
      "APPWRITE_NOTIFICATION_FANOUT_SCHEMA_INVALID",
    );
  });

  it("rejects a malformed transaction before reading authority", async () => {
    const target = setup();
    await expect(execute(target, { transactionId: "bad/id" })).rejects.toThrow(
      "APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE",
    );
    expect(target.getRow).not.toHaveBeenCalled();
  });

  it("BDD-NOT-FANOUT-001 writes recipient facts and email attempts in the source transaction", async () => {
    const target = setup();
    const result = await appendAppwriteNotificationFanout(
      target,
      schema,
      {
        equal: (attribute, values) => `${attribute}=${values.join(",")}`,
        limit: (value) => `limit=${String(value)}`,
      },
      permissions,
      persistence,
      {
        transactionId: "transaction_1",
        feedback,
        eventId: "event_1",
        kind: "feedback_resolved",
        occurredAt: "2026-08-28T20:00:00.000Z",
        locale: "fr",
        audience: "both",
        actor: { kind: "workspace", id: "maintainer_1" },
      },
    );

    expect(result).toEqual({ notifications: 2, emailAttempts: 2 });
    const notifications = target.createRow.mock.calls
      .map(([input]) => input)
      .filter((input) => input.tableId === "notifications");
    expect(notifications.map((row) => row.data.recipientId)).toEqual([
      "reporter_1",
      "owner_1",
    ]);
    expect(notifications.every((row) => row.transactionId === "transaction_1")).toBe(
      true,
    );
    const signals = target.createRow.mock.calls
      .map(([input]) => input)
      .filter((input) => input.tableId === "notification_signals");
    expect(signals).toEqual([
      expect.objectContaining({
        data: {
          recipientId: "owner_1",
          createdAt: "2026-08-28T20:00:00.000Z",
        },
        permissions: ['read("user:owner_1")'],
        transactionId: "transaction_1",
      }),
    ]);
    expect(JSON.stringify(signals)).not.toContain("workspace_1");
    expect(JSON.stringify(signals)).not.toContain("feedback_1");
    const outboxes = target.createRow.mock.calls
      .map(([input]) => input)
      .filter((input) => input.tableId === "notification_outbox");
    expect(outboxes).toHaveLength(2);
    for (const outbox of outboxes) {
      const plaintext = protector.open(
        {
          environment: "preview",
          tableId: "notification_outbox",
          rowId: outbox.rowId,
          field: "payloadJson",
        },
        String(outbox.data.payloadJson),
      );
      expect(plaintext).toContain("feedback_resolved");
      expect(plaintext).not.toContain("private@example.test");
    }
  });

  it("BDD-NOT-FANOUT-002 omits a removed Maintainer before writing", async () => {
    const target = setup({ assignmentActive: false });
    await appendAppwriteNotificationFanout(
      target,
      schema,
      {
        equal: (attribute, values) => `${attribute}=${values.join(",")}`,
        limit: (value) => `limit=${String(value)}`,
      },
      permissions,
      persistence,
      {
        transactionId: "transaction_1",
        feedback,
        eventId: "event_2",
        kind: "reporter_answered",
        occurredAt: "2026-08-28T20:00:00.000Z",
        locale: "en",
        audience: "workspace",
        actor: { kind: "reporter", id: "reporter_1" },
      },
    );
    expect(
      target.createRow.mock.calls
        .map(([input]) => input)
        .filter((input) => input.tableId === "notifications")
        .map((input) => input.data.recipientId)
        .filter(Boolean),
    ).toEqual(["owner_1"]);
  });

  it("BDD-NOT-FANOUT-003 produces no notification for an Internal Note", async () => {
    const target = setup();
    await expect(
      appendAppwriteNotificationFanout(
        target,
        schema,
        {
          equal: (attribute, values) => `${attribute}=${values.join(",")}`,
          limit: (value) => `limit=${String(value)}`,
        },
        permissions,
        persistence,
        {
          transactionId: "transaction_1",
          feedback,
          eventId: "event_3",
          kind: "internal_note",
          occurredAt: "2026-08-28T20:00:00.000Z",
          locale: "fr",
          audience: "workspace",
          actor: { kind: "workspace", id: "owner_1" },
        },
      ),
    ).resolves.toEqual({ notifications: 0, emailAttempts: 0 });
    expect(target.createRow).not.toHaveBeenCalled();
  });

  it("BDD-NOT-FANOUT-004 fails the source transaction when a row is not persisted", async () => {
    const target = setup();
    target.createRow.mockResolvedValueOnce({ $id: "wrong" });
    await expect(
      appendAppwriteNotificationFanout(
        target,
        schema,
        {
          equal: (attribute, values) => `${attribute}=${values.join(",")}`,
          limit: (value) => `limit=${String(value)}`,
        },
        permissions,
        persistence,
        {
          transactionId: "transaction_1",
          feedback,
          eventId: "event_4",
          kind: "feedback_closed",
          occurredAt: "2026-08-28T20:00:00.000Z",
          locale: "fr",
          audience: "both",
          actor: { kind: "system", id: "system_1" },
        },
      ),
    ).rejects.toThrow("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  });

  it.each([
    null,
    { ...feedback, $id: 1 },
    { ...feedback, $id: "bad/id" },
    { ...feedback, workspaceId: 1 },
    { ...feedback, workspaceId: "bad/id" },
    { ...feedback, projectId: 1 },
    { ...feedback, projectId: "bad/id" },
    { ...feedback, reporterId: 1 },
    { ...feedback, reporterId: "bad/id" },
    { ...feedback, assignedMaintainerId: 1 },
    { ...feedback, assignedMaintainerId: "bad/id" },
  ])("rejects malformed Feedback authority", async (invalid) => {
    await expect(execute(setup(), { feedback: invalid })).rejects.toThrow(
      "APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE",
    );
  });

  it.each([
    null,
    {
      $id: "feedback_2",
      feedbackId: "feedback_1",
      reference: "Y7-NOTIFY-12345678",
      status: "active",
    },
    {
      $id: "feedback_1",
      feedbackId: "feedback_2",
      reference: "Y7-NOTIFY-12345678",
      status: "active",
    },
    { $id: "feedback_1", feedbackId: "feedback_1", reference: 1, status: "active" },
    {
      $id: "feedback_1",
      feedbackId: "feedback_1",
      reference: "Y7-NOTIFY-12345678",
      status: "revoked",
    },
  ])("rejects malformed or revoked reference authority", async (grant) => {
    const target = setup();
    target.getRow.mockImplementation((input) =>
      input.tableId === "access_grants"
        ? Promise.resolve(grant)
        : setup().getRow(input),
    );
    await expect(execute(target)).rejects.toThrow(
      "APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE",
    );
  });

  it.each([
    null,
    {
      $id: 1,
      workspaceId: "workspace_1",
      userId: "owner_1",
      role: "workspace_owner",
      status: "active",
    },
    {
      $id: "bad/id",
      workspaceId: "workspace_1",
      userId: "owner_1",
      role: "workspace_owner",
      status: "active",
    },
    {
      $id: "membership_1",
      workspaceId: "workspace_2",
      userId: "owner_1",
      role: "workspace_owner",
      status: "active",
    },
    {
      $id: "membership_1",
      workspaceId: "workspace_1",
      userId: 1,
      role: "workspace_owner",
      status: "active",
    },
    {
      $id: "membership_1",
      workspaceId: "workspace_1",
      userId: "bad/id",
      role: "workspace_owner",
      status: "active",
    },
    {
      $id: "membership_1",
      workspaceId: "workspace_1",
      userId: "owner_1",
      role: "project_maintainer",
      status: "active",
    },
    {
      $id: "membership_1",
      workspaceId: "workspace_1",
      userId: "owner_1",
      role: "workspace_owner",
      status: "removed",
    },
  ])("rejects malformed Owner authority", async (membership) => {
    const target = setup();
    target.listRows.mockResolvedValueOnce({ rows: [membership] });
    await expect(execute(target)).rejects.toThrow(
      "APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE",
    );
  });

  it("rejects duplicate Owner authority", async () => {
    const target = setup();
    const row = {
      $id: "membership_1",
      workspaceId: "workspace_1",
      userId: "owner_1",
      role: "workspace_owner",
      status: "active",
    };
    target.listRows.mockResolvedValueOnce({
      rows: [row, { ...row, $id: "membership_2" }],
    });
    await expect(execute(target)).rejects.toThrow(
      "APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE",
    );
  });

  it("rejects a malformed Appwrite list response", async () => {
    const target = setup();
    target.listRows.mockResolvedValueOnce(null);
    await expect(execute(target)).rejects.toThrow(
      "APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE",
    );
  });

  it.each([
    { rows: [{}, {}] },
    { rows: [null] },
    {
      rows: [
        {
          $id: 1,
          workspaceId: "workspace_1",
          projectId: "project_1",
          userId: "maintainer_1",
          status: "active",
        },
      ],
    },
    {
      rows: [
        {
          $id: "bad/id",
          workspaceId: "workspace_1",
          projectId: "project_1",
          userId: "maintainer_1",
          status: "active",
        },
      ],
    },
    {
      rows: [
        {
          $id: "assignment_1",
          workspaceId: "workspace_2",
          projectId: "project_1",
          userId: "maintainer_1",
          status: "active",
        },
      ],
    },
    {
      rows: [
        {
          $id: "assignment_1",
          workspaceId: "workspace_1",
          projectId: "project_2",
          userId: "maintainer_1",
          status: "active",
        },
      ],
    },
    {
      rows: [
        {
          $id: "assignment_1",
          workspaceId: "workspace_1",
          projectId: "project_1",
          userId: "maintainer_2",
          status: "active",
        },
      ],
    },
    {
      rows: [
        {
          $id: "assignment_1",
          workspaceId: "workspace_1",
          projectId: "project_1",
          userId: "maintainer_1",
          status: 1,
        },
      ],
    },
  ])("rejects malformed Maintainer assignment authority", async ({ rows }) => {
    const target = setup();
    target.listRows.mockResolvedValueOnce({
      rows: [
        {
          $id: "membership_1",
          workspaceId: "workspace_1",
          userId: "owner_1",
          role: "workspace_owner",
          status: "active",
        },
      ],
    });
    target.listRows.mockResolvedValueOnce({ rows });
    await expect(execute(target)).rejects.toThrow(
      "APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE",
    );
  });

  it("accepts inactive assignment as removed and handles Feedback without assignment", async () => {
    const inactive = setup();
    inactive.listRows.mockResolvedValueOnce({
      rows: [
        {
          $id: "membership_1",
          workspaceId: "workspace_1",
          userId: "owner_1",
          role: "workspace_owner",
          status: "active",
        },
      ],
    });
    inactive.listRows.mockResolvedValueOnce({
      rows: [
        {
          $id: "assignment_1",
          workspaceId: "workspace_1",
          projectId: "project_1",
          userId: "maintainer_1",
          status: "removed",
        },
      ],
    });
    await expect(
      execute(inactive, {
        audience: "workspace",
        actor: { kind: "reporter", id: "reporter_1" },
      }),
    ).resolves.toMatchObject({ notifications: 1 });

    const unassigned = setup();
    await expect(
      execute(unassigned, { feedback: { ...feedback, assignedMaintainerId: null } }),
    ).resolves.toMatchObject({ notifications: 2 });
  });

  it.each([
    null,
    { $id: "reporter_2", workspaceId: "workspace_1", attributionJson: "x" },
    { $id: "reporter_1", workspaceId: "workspace_2", attributionJson: "x" },
    { $id: "reporter_1", workspaceId: "workspace_1", attributionJson: 1 },
  ])("rejects malformed Reporter authority", async (reporter) => {
    const target = setup();
    target.getRow.mockImplementation((input) =>
      input.tableId === "reporters" ? Promise.resolve(reporter) : setup().getRow(input),
    );
    await expect(execute(target)).rejects.toThrow(
      "APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE",
    );
  });

  it("rejects an unreadable Reporter envelope and supports non-contact Reporter", async () => {
    const unreadable = setup();
    unreadable.getRow.mockImplementation((input) =>
      input.tableId === "reporters"
        ? Promise.resolve({
            $id: "reporter_1",
            workspaceId: "workspace_1",
            attributionJson: "invalid-envelope",
          })
        : setup().getRow(input),
    );
    await expect(execute(unreadable)).rejects.toThrow(
      "APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE",
    );

    const unidentified = setup();
    unidentified.getRow.mockImplementation((input) =>
      input.tableId === "reporters"
        ? Promise.resolve({
            $id: "reporter_1",
            workspaceId: "workspace_1",
            attributionJson: protector.seal(
              {
                environment: "preview",
                tableId: "reporters",
                rowId: "reporter_1",
                field: "attributionJson",
              },
              JSON.stringify({ kind: "unidentified" }),
            ),
          })
        : setup().getRow(input),
    );
    await expect(execute(unidentified, { audience: "reporter" })).resolves.toEqual({
      notifications: 1,
      emailAttempts: 0,
    });
  });

  it("fails when an email outbox row is not persisted", async () => {
    const target = setup();
    target.createRow
      .mockImplementationOnce((input) => Promise.resolve({ $id: input.rowId }))
      .mockResolvedValueOnce({ $id: "wrong" });
    await expect(
      execute(target, { audience: "reporter", eventId: "event_outbox" }),
    ).rejects.toThrow("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  });

  it("fails when a workspace invalidation signal is not persisted", async () => {
    const target = setup();
    target.createRow
      .mockImplementationOnce((input) => Promise.resolve({ $id: input.rowId }))
      .mockResolvedValueOnce({ $id: "wrong" });
    await expect(
      execute(target, {
        audience: "workspace",
        actor: { kind: "workspace", id: "owner_1" },
        eventId: "event_signal",
      }),
    ).rejects.toThrow("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  });
});
