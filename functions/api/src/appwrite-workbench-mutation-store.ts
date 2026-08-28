import { createHash } from "node:crypto";

import { Permission, Query, Role, type TablesDB } from "node-appwrite";

import { validateWorkspaceClassification, type ActorAccess } from "@y7-feedback/domain";

import { AppwriteWorkbenchError } from "./appwrite-workbench-store.js";
import {
  appendAppwriteNotificationFanout,
  type NotificationFanoutInput,
} from "./appwrite-notification-fanout.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export type WorkbenchCommand =
  | {
      readonly kind: "classify_feedback";
      readonly operationId: string;
      readonly classification: string;
    }
  | {
      readonly kind: "assign_feedback";
      readonly operationId: string;
      readonly maintainerId: string;
    }
  | { readonly kind: "unassign_feedback"; readonly operationId: string }
  | { readonly kind: "delete_feedback"; readonly operationId: string };

export interface WorkbenchMutationResult {
  readonly status: "applied" | "replayed";
  readonly feedbackId: string;
  readonly action: WorkbenchCommand["kind"];
}

export interface WorkbenchMutationStore {
  execute(input: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
    readonly command: WorkbenchCommand;
    readonly payloadDigest: string;
    readonly occurredAt: string;
  }): Promise<WorkbenchMutationResult>;
}

export interface WorkbenchMutationTablesPort {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
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
  }): Promise<{ readonly rows: readonly unknown[] }>;
  updateRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly transactionId: string;
  }): Promise<unknown>;
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly [];
    readonly transactionId: string;
  }): Promise<unknown>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export interface WorkbenchMutationQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
}

export interface WorkbenchMutationSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly idempotencyTableId: string;
  readonly projectAssignmentsTableId: string;
  readonly accessGrantsTableId: string;
  readonly reportersTableId: string;
  readonly workspaceMembershipsTableId: string;
  readonly notificationsTableId: string;
  readonly notificationSignalsTableId: string;
  readonly outboxTableId: string;
}

export interface WorkbenchNotificationFanout {
  append(input: NotificationFanoutInput): Promise<unknown>;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
/* v8 ignore start -- Query serialization is exercised by the deployed matrix */
const defaultQueries: WorkbenchMutationQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
  );
}

function stableId(feedbackId: string, operationId: string): string {
  return `work_${createHash("sha256").update(`${feedbackId}\0${operationId}`).digest("hex").slice(0, 31)}`;
}

function authorize(
  value: unknown,
  input: Parameters<WorkbenchMutationStore["execute"]>[0],
): asserts value is Readonly<Record<string, unknown>> {
  if (
    !object(value) ||
    value.$id !== input.feedbackId ||
    value.workspaceId !== input.workspaceId ||
    value.projectId !== input.projectId ||
    (value.deletedAt !== undefined && value.deletedAt !== null) ||
    !input.actor.workspaceIds.includes(input.workspaceId) ||
    (input.actor.responsibility === "project_maintainer" &&
      (!input.actor.projectIds.includes(input.projectId) ||
        value.assignedMaintainerId !== input.actor.principalId)) ||
    (input.actor.responsibility !== "workspace_owner" &&
      input.command.kind !== "classify_feedback")
  ) {
    throw new AppwriteWorkbenchError("ERR-WORK-DENIED");
  }
}

function replay(
  value: unknown,
  input: Parameters<WorkbenchMutationStore["execute"]>[0],
): WorkbenchMutationResult | "conflict" | undefined {
  if (
    !object(value) ||
    value.feedbackId !== input.feedbackId ||
    value.operationId !== input.command.operationId ||
    typeof value.payloadDigest !== "string" ||
    typeof value.action !== "string" ||
    typeof value.resultJson !== "string"
  )
    return undefined;
  if (
    value.payloadDigest !== input.payloadDigest ||
    value.action !== input.command.kind
  )
    return "conflict";
  try {
    const result: unknown = JSON.parse(value.resultJson);
    return object(result) &&
      result.feedbackId === input.feedbackId &&
      result.action === input.command.kind
      ? { status: "replayed", feedbackId: input.feedbackId, action: input.command.kind }
      : undefined;
  } catch {
    return undefined;
  }
}

export function createAppwriteWorkbenchMutationStore(
  tables: WorkbenchMutationTablesPort,
  schema: WorkbenchMutationSchema,
  queries: WorkbenchMutationQueryPort,
  fanout?: WorkbenchNotificationFanout,
): WorkbenchMutationStore {
  if (
    [
      schema.databaseId,
      schema.feedbackTableId,
      schema.idempotencyTableId,
      schema.projectAssignmentsTableId,
      schema.accessGrantsTableId,
      schema.reportersTableId,
      schema.workspaceMembershipsTableId,
      schema.notificationsTableId,
      schema.notificationSignalsTableId,
      schema.outboxTableId,
    ].some((id) => !appwriteId.test(id)) ||
    new Set([
      schema.feedbackTableId,
      schema.idempotencyTableId,
      schema.projectAssignmentsTableId,
      schema.accessGrantsTableId,
      schema.reportersTableId,
      schema.workspaceMembershipsTableId,
      schema.notificationsTableId,
      schema.notificationSignalsTableId,
      schema.outboxTableId,
    ]).size !== 9
  )
    throw new Error("APPWRITE_WORKBENCH_MUTATION_SCHEMA_INVALID");
  return {
    async execute(input) {
      let transactionId: string | undefined;
      let closed = false;
      try {
        if (
          !appwriteId.test(input.feedbackId) ||
          !appwriteId.test(input.command.operationId) ||
          !timestamp(input.occurredAt) ||
          input.payloadDigest.length < 16 ||
          (input.command.kind === "assign_feedback" &&
            !appwriteId.test(input.command.maintainerId))
        )
          throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
        const transaction = await tables.createTransaction({ ttl: 60 });
        if (!appwriteId.test(transaction.$id))
          throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
        transactionId = transaction.$id;
        const priorRows = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.idempotencyTableId,
          queries: [
            queries.equal("feedbackId", [input.feedbackId]),
            queries.equal("operationId", [input.command.operationId]),
            queries.limit(2),
          ],
          total: false,
          ttl: 0,
          transactionId,
        });
        if (priorRows.rows.length > 1)
          throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
        if (priorRows.rows.length === 1) {
          const prior = replay(priorRows.rows[0], input);
          if (prior === "conflict")
            throw new AppwriteWorkbenchError("ERR-WORK-CONFLICT");
          if (prior === undefined)
            throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return prior;
        }
        const feedback = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.feedbackTableId,
          rowId: input.feedbackId,
          transactionId,
        });
        authorize(feedback, input);
        if (input.command.kind === "assign_feedback") {
          const assignments = await tables.listRows({
            databaseId: schema.databaseId,
            tableId: schema.projectAssignmentsTableId,
            queries: [
              queries.equal("userId", [input.command.maintainerId]),
              queries.equal("workspaceId", [input.workspaceId]),
              queries.equal("projectId", [input.projectId]),
              queries.limit(2),
            ],
            total: false,
            ttl: 0,
            transactionId,
          });
          const assignment = assignments.rows[0];
          if (
            assignments.rows.length !== 1 ||
            !object(assignment) ||
            assignment.userId !== input.command.maintainerId ||
            assignment.workspaceId !== input.workspaceId ||
            assignment.projectId !== input.projectId ||
            assignment.status !== "active"
          ) {
            throw new AppwriteWorkbenchError("ERR-WORK-DENIED");
          }
        }
        const data =
          input.command.kind === "classify_feedback"
            ? {
                workspaceClassification: validateWorkspaceClassification(
                  input.command.classification,
                ),
              }
            : input.command.kind === "assign_feedback"
              ? { assignedMaintainerId: input.command.maintainerId }
              : input.command.kind === "unassign_feedback"
                ? { assignedMaintainerId: null }
                : { deletedAt: input.occurredAt };
        const updated = await tables.updateRow({
          databaseId: schema.databaseId,
          tableId: schema.feedbackTableId,
          rowId: input.feedbackId,
          data,
          transactionId,
        });
        if (!object(updated) || updated.$id !== input.feedbackId)
          throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
        if (
          fanout !== undefined &&
          (input.command.kind === "assign_feedback" ||
            input.command.kind === "unassign_feedback")
        ) {
          await fanout.append({
            transactionId,
            feedback: { ...feedback, ...data },
            eventId: input.command.operationId,
            kind: "assignment_changed",
            occurredAt: input.occurredAt,
            locale: "fr",
            audience: "workspace",
            actor: { kind: "workspace", id: input.actor.principalId },
          });
        }
        const result = { feedbackId: input.feedbackId, action: input.command.kind };
        const rowId = stableId(input.feedbackId, input.command.operationId);
        const created = await tables.createRow({
          databaseId: schema.databaseId,
          tableId: schema.idempotencyTableId,
          rowId,
          data: {
            feedbackId: input.feedbackId,
            operationId: input.command.operationId,
            payloadDigest: input.payloadDigest,
            action: input.command.kind,
            resultJson: JSON.stringify(result),
            createdAt: input.occurredAt,
          },
          permissions: [],
          transactionId,
        });
        if (!object(created) || created.$id !== rowId)
          throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
        await tables.updateTransaction({ transactionId, commit: true });
        closed = true;
        return { status: "applied", ...result };
      } catch (error: unknown) {
        if (transactionId !== undefined && !closed) {
          try {
            await tables.updateTransaction({ transactionId, rollback: true });
          } catch {
            /* preserve stable outcome */
          }
        }
        if (error instanceof AppwriteWorkbenchError) throw error;
        throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
      }
    },
  };
}

/* v8 ignore start -- Node SDK wiring is exercised by the deployed Workbench matrix */
export function createNodeAppwriteWorkbenchMutationStore(
  tables: TablesDB,
  schema: WorkbenchMutationSchema,
  persistence: AppwriteSensitivePersistence,
  fanoutOverride?: WorkbenchNotificationFanout,
): WorkbenchMutationStore {
  const port: WorkbenchMutationTablesPort = {
    createTransaction: (input) => tables.createTransaction(input),
    getRow: (input) => tables.getRow(input),
    listRows: async (input) => ({
      rows: (await tables.listRows({ ...input, queries: [...input.queries] })).rows,
    }),
    updateRow: (input) => tables.updateRow(input),
    createRow: (input) =>
      tables.createRow({ ...input, permissions: [...input.permissions] }),
    updateTransaction: (input) => tables.updateTransaction(input),
  };
  return createAppwriteWorkbenchMutationStore(
    port,
    schema,
    defaultQueries,
    fanoutOverride ?? {
      append: (input) =>
        appendAppwriteNotificationFanout(
          port,
          schema,
          defaultQueries,
          {
            /* v8 ignore next -- official Node SDK permission serialization is deployed evidence */
            readUser: (userId) => Permission.read(Role.user(userId)),
          },
          persistence,
          input,
        ),
    },
  );
}
/* v8 ignore stop */
