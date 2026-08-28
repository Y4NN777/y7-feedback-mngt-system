import { Query, type TablesDB } from "node-appwrite";

import type {
  AppendConversationCommand,
  LifecycleTransitionCommand,
  NotificationSourceFact,
} from "@y7-feedback/domain";

import type {
  NotificationMaterializationResult,
  NotificationMaterializerDependencies,
  NotificationMaterializationStore,
} from "./notification-materializer.js";
import { createNotificationMaterializer } from "./notification-materializer.js";

type ConversationCommand =
  | AppendConversationCommand
  | LifecycleTransitionCommand
  | {
      readonly kind: "assignment_changed";
      readonly eventId: string;
      readonly actorId: string;
      readonly actorKind: "workspace";
      readonly occurredAt: string;
    };

export interface ConversationNotificationInput {
  readonly feedbackId: string;
  readonly actorId: string;
  readonly actorKind: "workspace" | "reporter";
  readonly command: ConversationCommand;
}

export interface AppwriteConversationNotificationSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly workspaceMembershipsTableId: string;
  readonly accessGrantsTableId: string;
}

export interface ConversationNotificationTablesPort {
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface ConversationNotificationQueries {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
}

/* v8 ignore start -- Node Query serialization is exercised by the deployed verifier. */
const defaultQueries: ConversationNotificationQueries = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */
const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new Error("APPWRITE_NOTIFICATION_CONTEXT_INVALID");
}

export function createAppwriteConversationNotificationReconciler(
  tables: ConversationNotificationTablesPort,
  schema: AppwriteConversationNotificationSchema,
  store: NotificationMaterializationStore,
  dependencies: NotificationMaterializerDependencies,
  queries: ConversationNotificationQueries = defaultQueries,
): {
  readonly reconcile: (
    input: ConversationNotificationInput,
  ) => Promise<NotificationMaterializationResult>;
} {
  if (
    [
      schema.databaseId,
      schema.feedbackTableId,
      schema.workspaceMembershipsTableId,
      schema.accessGrantsTableId,
    ].some((value) => !id.test(value))
  ) {
    throw new Error("APPWRITE_NOTIFICATION_CONTEXT_SCHEMA_INVALID");
  }
  const materializer = createNotificationMaterializer(store, dependencies);
  return {
    async reconcile(input) {
      const feedback = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.feedbackTableId,
        rowId: input.feedbackId,
      });
      if (
        !object(feedback) ||
        feedback.$id !== input.feedbackId ||
        typeof feedback.workspaceId !== "string" ||
        typeof feedback.projectId !== "string" ||
        typeof feedback.reporterId !== "string" ||
        !id.test(feedback.workspaceId) ||
        !id.test(feedback.projectId) ||
        !id.test(feedback.reporterId) ||
        (feedback.assignedMaintainerId !== undefined &&
          (typeof feedback.assignedMaintainerId !== "string" ||
            !id.test(feedback.assignedMaintainerId)))
      ) {
        return invalid();
      }
      const [owners, grants] = await Promise.all([
        tables.listRows({
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
        }),
        tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.accessGrantsTableId,
          queries: [queries.equal("feedbackId", [input.feedbackId]), queries.limit(2)],
          total: false,
          ttl: 0,
        }),
      ]);
      const ownerIds = owners.rows.map((row) =>
        object(row) &&
        row.workspaceId === feedback.workspaceId &&
        row.role === "workspace_owner" &&
        row.status === "active" &&
        typeof row.userId === "string" &&
        id.test(row.userId)
          ? row.userId
          : invalid(),
      );
      const grant = grants.rows.length === 1 ? grants.rows[0] : undefined;
      if (
        ownerIds.length === 0 ||
        !object(grant) ||
        grant.feedbackId !== input.feedbackId ||
        typeof grant.reference !== "string"
      ) {
        return invalid();
      }
      const command = input.command;
      const kind: NotificationSourceFact["kind"] =
        command.kind === "assignment_changed"
          ? "assignment_changed"
          : command.kind === "append_internal_note"
            ? "internal_note"
            : command.kind === "append_message"
              ? "conversation_message"
              : "lifecycle_changed";
      const visibility =
        command.kind === "append_internal_note" ||
        (command.kind === "append_message" && command.audience === "workspace")
          ? "workspace"
          : "public";
      return materializer.reconcile({
        fact: {
          eventId: command.eventId,
          kind,
          actorId: input.actorId,
          actorKind: input.actorKind,
          feedbackId: input.feedbackId,
          workspaceId: feedback.workspaceId,
          projectId: feedback.projectId,
          occurredAt: command.occurredAt,
          visibility,
        },
        participants: {
          reporterId: feedback.reporterId,
          ownerIds,
          ...(typeof feedback.assignedMaintainerId === "string"
            ? { assignedMaintainerId: feedback.assignedMaintainerId }
            : {}),
        },
        reference: grant.reference,
      });
    },
  };
}

/* v8 ignore start -- mechanical Node facade is exercised by the deployed verifier. */
export function createNodeAppwriteConversationNotificationReconciler(
  tables: TablesDB,
  schema: AppwriteConversationNotificationSchema,
  store: NotificationMaterializationStore,
  dependencies: NotificationMaterializerDependencies,
) {
  return createAppwriteConversationNotificationReconciler(
    {
      getRow: (input) => tables.getRow(input),
      listRows: async (input) => {
        const result = await tables.listRows({
          ...input,
          queries: [...input.queries],
        });
        return { rows: result.rows };
      },
    },
    schema,
    store,
    dependencies,
  );
}
/* v8 ignore stop */
