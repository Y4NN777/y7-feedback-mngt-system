import { createHash } from "node:crypto";

import {
  planNotifications,
  type NotificationActor,
  type NotificationEventKind,
} from "@y7-feedback/domain";

import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwriteNotificationFanoutSchema {
  readonly databaseId: string;
  readonly accessGrantsTableId: string;
  readonly reportersTableId: string;
  readonly workspaceMembershipsTableId: string;
  readonly projectAssignmentsTableId: string;
  readonly notificationsTableId: string;
  readonly notificationSignalsTableId: string;
  readonly outboxTableId: string;
}

export interface AppwriteNotificationFanoutTablesPort {
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly transactionId: string;
  }): Promise<unknown>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
    readonly transactionId: string;
  }): Promise<unknown>;
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
    readonly transactionId: string;
  }): Promise<unknown>;
}

export interface AppwriteNotificationFanoutQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
}

export interface AppwriteNotificationFanoutPermissionPort {
  readUser(userId: string): string;
}

export type NotificationFanoutInput = {
  readonly transactionId: string;
  readonly feedback: unknown;
  readonly eventId: string;
  readonly kind: NotificationEventKind | "internal_note";
  readonly occurredAt: string;
  readonly locale: "fr" | "en";
  readonly audience: "reporter" | "workspace" | "both";
  readonly actor: NotificationActor;
};

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableId(prefix: "not_" | "nout_" | "nsig_", value: string): string {
  return `${prefix}${createHash("sha256").update(value).digest("hex").slice(0, 31)}`;
}

function validCreated(value: unknown, rowId: string): boolean {
  return object(value) && value.$id === rowId;
}

function listedRows(value: unknown): readonly unknown[] {
  if (!object(value) || !Array.isArray(value.rows)) {
    throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  }
  return value.rows;
}

function validateSchema(schema: AppwriteNotificationFanoutSchema): void {
  const tables = [
    schema.accessGrantsTableId,
    schema.reportersTableId,
    schema.workspaceMembershipsTableId,
    schema.projectAssignmentsTableId,
    schema.notificationsTableId,
    schema.notificationSignalsTableId,
    schema.outboxTableId,
  ];
  if (
    !appwriteId.test(schema.databaseId) ||
    tables.some((id) => !appwriteId.test(id)) ||
    new Set(tables).size !== tables.length
  ) {
    throw new Error("APPWRITE_NOTIFICATION_FANOUT_SCHEMA_INVALID");
  }
}

function feedbackAuthority(value: unknown): {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly reporterId: string;
  readonly assignedMaintainerId?: string;
} {
  if (
    !object(value) ||
    typeof value.$id !== "string" ||
    !appwriteId.test(value.$id) ||
    typeof value.workspaceId !== "string" ||
    !appwriteId.test(value.workspaceId) ||
    typeof value.projectId !== "string" ||
    !appwriteId.test(value.projectId) ||
    typeof value.reporterId !== "string" ||
    !appwriteId.test(value.reporterId) ||
    (value.assignedMaintainerId !== undefined &&
      value.assignedMaintainerId !== null &&
      (typeof value.assignedMaintainerId !== "string" ||
        !appwriteId.test(value.assignedMaintainerId)))
  ) {
    throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  }
  return {
    id: value.$id,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    reporterId: value.reporterId,
    ...(typeof value.assignedMaintainerId === "string"
      ? { assignedMaintainerId: value.assignedMaintainerId }
      : {}),
  };
}

function reference(value: unknown, feedbackId: string): string {
  if (
    !object(value) ||
    value.$id !== feedbackId ||
    value.feedbackId !== feedbackId ||
    typeof value.reference !== "string" ||
    value.status !== "active"
  ) {
    throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  }
  return value.reference;
}

function owners(rows: readonly unknown[], workspaceId: string): readonly string[] {
  const ids = rows.map((row) => {
    if (
      !object(row) ||
      typeof row.$id !== "string" ||
      !appwriteId.test(row.$id) ||
      row.workspaceId !== workspaceId ||
      typeof row.userId !== "string" ||
      !appwriteId.test(row.userId) ||
      row.role !== "workspace_owner" ||
      row.status !== "active"
    ) {
      throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
    }
    return row.userId;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  }
  return ids;
}

function activeAssignment(
  rows: readonly unknown[],
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly maintainerId: string;
  },
): boolean {
  if (rows.length === 0) return false;
  if (rows.length !== 1) {
    throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  }
  const row = rows[0];
  if (
    !object(row) ||
    typeof row.$id !== "string" ||
    !appwriteId.test(row.$id) ||
    row.workspaceId !== input.workspaceId ||
    row.projectId !== input.projectId ||
    row.userId !== input.maintainerId ||
    typeof row.status !== "string"
  ) {
    throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  }
  return row.status === "active";
}

function reporterHasEmail(
  value: unknown,
  reporterId: string,
  workspaceId: string,
  schema: AppwriteNotificationFanoutSchema,
  persistence: AppwriteSensitivePersistence,
): boolean {
  if (
    !object(value) ||
    value.$id !== reporterId ||
    value.workspaceId !== workspaceId ||
    typeof value.attributionJson !== "string"
  ) {
    throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  }
  try {
    const attribution = JSON.parse(
      persistence.protector.open(
        {
          environment: persistence.environment,
          tableId: schema.reportersTableId,
          rowId: reporterId,
          field: "attributionJson",
        },
        value.attributionJson,
      ),
    ) as unknown;
    return object(attribution) && attribution.kind === "contact";
  } catch {
    throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  }
}

export async function appendAppwriteNotificationFanout(
  tables: AppwriteNotificationFanoutTablesPort,
  schema: AppwriteNotificationFanoutSchema,
  queries: AppwriteNotificationFanoutQueryPort,
  permissions: AppwriteNotificationFanoutPermissionPort,
  persistence: AppwriteSensitivePersistence,
  input: NotificationFanoutInput,
): Promise<{ readonly notifications: number; readonly emailAttempts: number }> {
  validateSchema(schema);
  if (input.kind === "internal_note") {
    return { notifications: 0, emailAttempts: 0 };
  }
  if (!appwriteId.test(input.transactionId)) {
    throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
  }
  const feedback = feedbackAuthority(input.feedback);
  const accessGrant = await tables.getRow({
    databaseId: schema.databaseId,
    tableId: schema.accessGrantsTableId,
    rowId: feedback.id,
    transactionId: input.transactionId,
  });
  const reporter = await tables.getRow({
    databaseId: schema.databaseId,
    tableId: schema.reportersTableId,
    rowId: feedback.reporterId,
    transactionId: input.transactionId,
  });
  const membershipRows = await tables.listRows({
    databaseId: schema.databaseId,
    tableId: schema.workspaceMembershipsTableId,
    queries: [
      queries.equal("workspaceId", [feedback.workspaceId]),
      queries.equal("role", ["workspace_owner"]),
      queries.equal("status", ["active"]),
      queries.limit(100),
    ],
    total: false,
    ttl: 0,
    transactionId: input.transactionId,
  });
  const ownerIds = owners(listedRows(membershipRows), feedback.workspaceId);
  let assigned: readonly string[] = [];
  let removed: readonly string[] = [];
  if (feedback.assignedMaintainerId !== undefined) {
    const assignments = await tables.listRows({
      databaseId: schema.databaseId,
      tableId: schema.projectAssignmentsTableId,
      queries: [
        queries.equal("workspaceId", [feedback.workspaceId]),
        queries.equal("projectId", [feedback.projectId]),
        queries.equal("userId", [feedback.assignedMaintainerId]),
        queries.limit(2),
      ],
      total: false,
      ttl: 0,
      transactionId: input.transactionId,
    });
    if (
      activeAssignment(listedRows(assignments), {
        workspaceId: feedback.workspaceId,
        projectId: feedback.projectId,
        maintainerId: feedback.assignedMaintainerId,
      })
    ) {
      assigned = [feedback.assignedMaintainerId];
    } else {
      removed = [feedback.assignedMaintainerId];
    }
  }
  const emailRecipientIds = [
    ...ownerIds,
    ...assigned,
    ...(reporterHasEmail(
      reporter,
      feedback.reporterId,
      feedback.workspaceId,
      schema,
      persistence,
    )
      ? [feedback.reporterId]
      : []),
  ];
  const planned = planNotifications({
    fact: {
      eventId: input.eventId,
      feedbackId: feedback.id,
      reference: reference(accessGrant, feedback.id),
      kind: input.kind,
      occurredAt: input.occurredAt,
      locale: input.locale,
      audience: input.audience,
    },
    actor: input.actor,
    recipients: {
      reporterId: feedback.reporterId,
      workspaceOwnerIds: ownerIds,
      assignedMaintainerIds: assigned,
      removedMaintainerIds: removed,
      emailRecipientIds,
    },
  });

  let emailAttempts = 0;
  for (const item of planned) {
    const notificationId = stableId("not_", item.notificationKey);
    const notification = await tables.createRow({
      databaseId: schema.databaseId,
      tableId: schema.notificationsTableId,
      rowId: notificationId,
      data: {
        eventId: item.fact.eventId,
        feedbackId: item.fact.feedbackId,
        workspaceId: feedback.workspaceId,
        projectId: feedback.projectId,
        reporterId: feedback.reporterId,
        recipientKind: item.recipient.kind,
        recipientId: item.recipient.id,
        kind: item.fact.kind,
        reference: item.fact.reference,
        locale: item.fact.locale,
        createdAt: item.fact.occurredAt,
        readAt: null,
      },
      permissions: [],
      transactionId: input.transactionId,
    });
    if (!validCreated(notification, notificationId)) {
      throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
    }
    if (item.recipient.kind === "workspace") {
      const signalId = stableId("nsig_", item.notificationKey);
      const signal = await tables.createRow({
        databaseId: schema.databaseId,
        tableId: schema.notificationSignalsTableId,
        rowId: signalId,
        data: {
          recipientId: item.recipient.id,
          createdAt: item.fact.occurredAt,
        },
        permissions: [permissions.readUser(item.recipient.id)],
        transactionId: input.transactionId,
      });
      if (!validCreated(signal, signalId)) {
        throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
      }
    }
    if (item.channels.includes("email")) {
      const outboxId = stableId("nout_", `${item.notificationKey}:email`);
      const payloadJson = persistence.protector.seal(
        {
          environment: persistence.environment,
          tableId: schema.outboxTableId,
          rowId: outboxId,
          field: "payloadJson",
        },
        JSON.stringify({
          kind: item.fact.kind,
          reference: item.fact.reference,
          locale: item.fact.locale,
          recipient: item.recipient,
        }),
      );
      const outbox = await tables.createRow({
        databaseId: schema.databaseId,
        tableId: schema.outboxTableId,
        rowId: outboxId,
        data: {
          notificationId,
          channel: "email",
          status: "pending",
          createdAt: item.fact.occurredAt,
          payloadJson,
        },
        permissions: [],
        transactionId: input.transactionId,
      });
      if (!validCreated(outbox, outboxId)) {
        throw new Error("APPWRITE_NOTIFICATION_FANOUT_UNAVAILABLE");
      }
      emailAttempts += 1;
    }
  }
  return { notifications: planned.length, emailAttempts };
}
