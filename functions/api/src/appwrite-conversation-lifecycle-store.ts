import { createHash } from "node:crypto";
import { Permission, Query, Role, type TablesDB } from "node-appwrite";

import {
  ConversationLifecycleError,
  appendConversationEntry,
  planLifecycleTransition,
  type AppendConversationCommand,
  type FeedbackLifecycleState,
  type LifecycleTransitionCommand,
} from "@y7-feedback/domain";

import {
  appendAppwriteNotificationFanout,
  type NotificationFanoutInput,
} from "./appwrite-notification-fanout.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

type Command = AppendConversationCommand | LifecycleTransitionCommand;

export class AppwriteConversationLifecycleError extends Error {
  readonly code:
    | "ERR-CONV-DENIED"
    | "ERR-CONV-IDEMPOTENCY-CONFLICT"
    | "ERR-CONV-INVALID"
    | "ERR-CONV-RETRYABLE"
    | "ERR-CONV-STALE";

  constructor(code: AppwriteConversationLifecycleError["code"]) {
    super(code);
    this.name = "AppwriteConversationLifecycleError";
    this.code = code;
  }
}

export interface AppwriteConversationLifecycleSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly messagesTableId: string;
  readonly internalNotesTableId: string;
  readonly lifecycleTableId: string;
  readonly idempotencyTableId: string;
  readonly accessGrantsTableId: string;
  readonly reportersTableId: string;
  readonly workspaceMembershipsTableId: string;
  readonly projectAssignmentsTableId: string;
  readonly notificationsTableId: string;
  readonly notificationSignalsTableId: string;
  readonly outboxTableId: string;
}

export interface AppwriteConversationLifecycleTablesPort {
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
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
    readonly transactionId: string;
  }): Promise<unknown>;
  updateRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly transactionId: string;
  }): Promise<unknown>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export interface ConversationLifecycleQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
  orderDesc(attribute: string): string;
}

export interface ConversationLifecycleStoreInput {
  readonly feedbackId: string;
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly payloadDigest: string;
  readonly locale: "fr" | "en";
  readonly command: Command;
}

export interface ConversationNotificationFanout {
  append(input: NotificationFanoutInput): Promise<{
    readonly notifications: number;
    readonly emailAttempts: number;
  }>;
}

export type ConversationLifecycleStoreResult = {
  readonly status: "applied" | "replayed";
  readonly feedbackId: string;
  readonly action: Command["kind"];
  readonly state?: FeedbackLifecycleState;
  readonly version?: number;
};

export interface ConversationLifecycleStore {
  execute(
    input: ConversationLifecycleStoreInput,
  ): Promise<ConversationLifecycleStoreResult>;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const states = new Set<FeedbackLifecycleState>([
  "received",
  "under_review",
  "awaiting_reporter",
  "resolved",
  "closed",
]);
const defaultQueries: ConversationLifecycleQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
  orderDesc: (attribute) => Query.orderDesc(attribute),
};

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRow(value: unknown, rowId: string): boolean {
  return object(value) && value.$id === rowId;
}

function stableId(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}${createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 31)}`;
}

function validateSchema(schema: AppwriteConversationLifecycleSchema): void {
  const ids: readonly string[] = [
    schema.databaseId,
    schema.feedbackTableId,
    schema.messagesTableId,
    schema.internalNotesTableId,
    schema.lifecycleTableId,
    schema.idempotencyTableId,
    schema.accessGrantsTableId,
    schema.reportersTableId,
    schema.workspaceMembershipsTableId,
    schema.projectAssignmentsTableId,
    schema.notificationsTableId,
    schema.notificationSignalsTableId,
    schema.outboxTableId,
  ];
  const tableIds = ids.slice(1);
  if (
    ids.some((id) => !appwriteId.test(id)) ||
    new Set(tableIds).size !== tableIds.length
  ) {
    throw new Error("APPWRITE_CONVERSATION_SCHEMA_INVALID");
  }
}

function replay(
  value: unknown,
  input: ConversationLifecycleStoreInput,
): Omit<ConversationLifecycleStoreResult, "status"> | "conflict" | undefined {
  if (
    !object(value) ||
    value.feedbackId !== input.feedbackId ||
    value.operationId !== input.command.eventId ||
    value.action !== input.command.kind ||
    typeof value.payloadDigest !== "string" ||
    typeof value.resultJson !== "string"
  ) {
    return undefined;
  }
  if (value.payloadDigest !== input.payloadDigest) return "conflict";
  try {
    const result: unknown = JSON.parse(value.resultJson);
    return object(result) &&
      result.feedbackId === input.feedbackId &&
      result.action === input.command.kind
      ? (result as Omit<ConversationLifecycleStoreResult, "status">)
      : undefined;
  } catch {
    return undefined;
  }
}

function mapDomain(
  error: ConversationLifecycleError,
): AppwriteConversationLifecycleError {
  if (error.code.endsWith("DENIED")) {
    return new AppwriteConversationLifecycleError("ERR-CONV-DENIED");
  }
  if (error.code === "ERR-LIFECYCLE-STALE") {
    return new AppwriteConversationLifecycleError("ERR-CONV-STALE");
  }
  return new AppwriteConversationLifecycleError("ERR-CONV-INVALID");
}

function notificationEvent(
  command: Command,
): Pick<NotificationFanoutInput, "kind" | "audience" | "actor"> {
  const actor = { kind: command.actorKind, id: command.actorId } as const;
  switch (command.kind) {
    case "append_internal_note":
      return { kind: "internal_note", audience: "workspace", actor };
    case "append_message":
      return {
        kind: command.actorKind === "reporter" ? "reporter_answered" : "message_added",
        audience:
          command.actorKind === "reporter"
            ? "workspace"
            : command.audience === "reporter"
              ? "reporter"
              : "workspace",
        actor,
      };
    case "start_review":
      return { kind: "feedback_under_review", audience: "reporter", actor };
    case "request_clarification":
      return { kind: "clarification_requested", audience: "both", actor };
    case "reporter_answer":
      return { kind: "reporter_answered", audience: "workspace", actor };
    case "resolve":
      return { kind: "feedback_resolved", audience: "both", actor };
    case "close":
      return { kind: "feedback_closed", audience: "both", actor };
    case "reopen":
      return { kind: "feedback_reopened", audience: "workspace", actor };
  }
}

export function createAppwriteConversationLifecycleStore(
  tables: AppwriteConversationLifecycleTablesPort,
  schema: AppwriteConversationLifecycleSchema,
  queries: ConversationLifecycleQueryPort,
  persistence: AppwriteSensitivePersistence,
  fanout: ConversationNotificationFanout,
): ConversationLifecycleStore {
  validateSchema(schema);
  return {
    async execute(input) {
      let transactionId: string | undefined;
      let closed = false;
      try {
        const transaction = await tables.createTransaction({ ttl: 60 });
        if (!appwriteId.test(transaction.$id)) {
          throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
        }
        transactionId = transaction.$id;
        const idempotency = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.idempotencyTableId,
          queries: [
            queries.equal("feedbackId", [input.feedbackId]),
            queries.equal("operationId", [input.command.eventId]),
            queries.limit(2),
          ],
          total: false,
          ttl: 0,
          transactionId,
        });
        if (idempotency.rows.length > 1) {
          throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
        }
        if (idempotency.rows.length === 1) {
          const original = replay(idempotency.rows[0], input);
          if (original === "conflict") {
            throw new AppwriteConversationLifecycleError(
              "ERR-CONV-IDEMPOTENCY-CONFLICT",
            );
          }
          if (original === undefined) {
            throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
          }
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return { status: "replayed", ...original };
        }

        const feedback = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.feedbackTableId,
          rowId: input.feedbackId,
          transactionId,
        });
        if (
          !object(feedback) ||
          feedback.$id !== input.feedbackId ||
          typeof feedback.workspaceId !== "string" ||
          !appwriteId.test(feedback.workspaceId) ||
          typeof feedback.projectId !== "string" ||
          !appwriteId.test(feedback.projectId) ||
          (input.workspaceId !== undefined &&
            feedback.workspaceId !== input.workspaceId) ||
          (input.projectId !== undefined && feedback.projectId !== input.projectId) ||
          typeof feedback.state !== "string" ||
          !states.has(feedback.state as FeedbackLifecycleState)
        ) {
          throw new AppwriteConversationLifecycleError("ERR-CONV-DENIED");
        }
        const workspaceId = feedback.workspaceId;
        const projectId = feedback.projectId;

        let result: Omit<ConversationLifecycleStoreResult, "status">;
        if (
          input.command.kind === "append_message" ||
          input.command.kind === "append_internal_note"
        ) {
          const entry = appendConversationEntry(
            { feedbackId: input.feedbackId, messages: [], internalNotes: [] },
            input.command,
          );
          const appended =
            input.command.kind === "append_message"
              ? entry.state.messages[0]
              : entry.state.internalNotes[0];
          /* v8 ignore next -- appendConversationEntry guarantees one appended entry */
          if (appended === undefined) {
            throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
          }
          const tableId =
            input.command.kind === "append_message"
              ? schema.messagesTableId
              : schema.internalNotesTableId;
          const row = await tables.createRow({
            databaseId: schema.databaseId,
            tableId,
            rowId: input.command.eventId,
            data: {
              feedbackId: input.feedbackId,
              workspaceId,
              projectId,
              actorId: appended.actorId,
              actorKind: appended.actorKind,
              audience: appended.audience,
              contentEnvelope: persistence.protector.seal(
                {
                  environment: persistence.environment,
                  tableId,
                  rowId: input.command.eventId,
                  field: "contentEnvelope",
                },
                appended.content,
              ),
              occurredAt: appended.occurredAt,
            },
            permissions: [],
            transactionId,
          });
          if (!validRow(row, input.command.eventId)) {
            throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
          }
          result = { feedbackId: input.feedbackId, action: input.command.kind };
        } else {
          const facts = await tables.listRows({
            databaseId: schema.databaseId,
            tableId: schema.lifecycleTableId,
            queries: [
              queries.equal("feedbackId", [input.feedbackId]),
              queries.orderDesc("sequence"),
              queries.limit(2),
            ],
            total: false,
            ttl: 0,
            transactionId,
          });
          if (facts.rows.length > 1) {
            const [first, second] = facts.rows;
            if (
              !object(first) ||
              !object(second) ||
              typeof first.sequence !== "number" ||
              typeof second.sequence !== "number" ||
              first.sequence <= second.sequence
            ) {
              throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
            }
          }
          const latest = facts.rows[0];
          let version = 1;
          let state = feedback.state as FeedbackLifecycleState;
          if (latest !== undefined) {
            if (
              !object(latest) ||
              latest.feedbackId !== input.feedbackId ||
              typeof latest.sequence !== "number" ||
              !Number.isSafeInteger(latest.sequence) ||
              typeof latest.state !== "string" ||
              !states.has(latest.state as FeedbackLifecycleState) ||
              latest.state !== feedback.state
            ) {
              throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
            }
            version = latest.sequence;
            state = latest.state as FeedbackLifecycleState;
          }
          const transition = planLifecycleTransition(
            { feedbackId: input.feedbackId, state, version },
            input.command,
          );
          const updated = await tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.feedbackTableId,
            rowId: input.feedbackId,
            data: { state: transition.next.state },
            transactionId,
          });
          if (!validRow(updated, input.feedbackId)) {
            throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
          }
          const fact = transition.history;
          const created = await tables.createRow({
            databaseId: schema.databaseId,
            tableId: schema.lifecycleTableId,
            rowId: fact.id,
            data: {
              feedbackId: fact.feedbackId,
              workspaceId,
              projectId,
              priorState: fact.priorState,
              state: fact.state,
              actorId: fact.actorId,
              actorKind: fact.actorKind,
              reasonEnvelope: persistence.protector.seal(
                {
                  environment: persistence.environment,
                  tableId: schema.lifecycleTableId,
                  rowId: fact.id,
                  field: "reasonEnvelope",
                },
                fact.reason,
              ),
              occurredAt: fact.occurredAt,
              sequence: fact.sequence,
            },
            permissions: [],
            transactionId,
          });
          if (!validRow(created, fact.id)) {
            throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
          }
          result = {
            feedbackId: input.feedbackId,
            action: input.command.kind,
            state: transition.next.state,
            version: transition.next.version,
          };
        }

        await fanout.append({
          transactionId,
          feedback,
          eventId: input.command.eventId,
          occurredAt: input.command.occurredAt,
          locale: input.locale,
          ...notificationEvent(input.command),
        });

        const idempotencyRowId = stableId(
          "conv_",
          input.feedbackId,
          input.command.eventId,
        );
        const idempotencyRow = await tables.createRow({
          databaseId: schema.databaseId,
          tableId: schema.idempotencyTableId,
          rowId: idempotencyRowId,
          data: {
            feedbackId: input.feedbackId,
            operationId: input.command.eventId,
            payloadDigest: input.payloadDigest,
            action: input.command.kind,
            resultJson: JSON.stringify(result),
            createdAt: input.command.occurredAt,
          },
          permissions: [],
          transactionId,
        });
        if (!validRow(idempotencyRow, idempotencyRowId)) {
          throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
        }
        await tables.updateTransaction({ transactionId, commit: true });
        closed = true;
        return { status: "applied", ...result };
      } catch (error: unknown) {
        if (transactionId !== undefined && !closed) {
          try {
            await tables.updateTransaction({ transactionId, rollback: true });
          } catch {
            // Preserve the originating stable outcome.
          }
        }
        if (error instanceof AppwriteConversationLifecycleError) throw error;
        if (error instanceof ConversationLifecycleError) throw mapDomain(error);
        throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
      }
    },
  };
}

export function createNodeAppwriteConversationLifecycleStore(
  tables: TablesDB,
  schema: AppwriteConversationLifecycleSchema,
  persistence: AppwriteSensitivePersistence,
  fanoutOverride?: ConversationNotificationFanout,
): ConversationLifecycleStore {
  const port: AppwriteConversationLifecycleTablesPort = {
    createTransaction: (input) => tables.createTransaction(input),
    getRow: (input) => tables.getRow(input),
    listRows: async (input) => {
      const rows = await tables.listRows({ ...input, queries: [...input.queries] });
      return { rows: rows.rows };
    },
    createRow: (input) =>
      tables.createRow({ ...input, permissions: [...input.permissions] }),
    updateRow: (input) => tables.updateRow(input),
    updateTransaction: (input) => tables.updateTransaction(input),
  };
  return createAppwriteConversationLifecycleStore(
    port,
    schema,
    defaultQueries,
    persistence,
    fanoutOverride ?? {
      append: (input) =>
        appendAppwriteNotificationFanout(
          port,
          {
            databaseId: schema.databaseId,
            accessGrantsTableId: schema.accessGrantsTableId,
            reportersTableId: schema.reportersTableId,
            workspaceMembershipsTableId: schema.workspaceMembershipsTableId,
            projectAssignmentsTableId: schema.projectAssignmentsTableId,
            notificationsTableId: schema.notificationsTableId,
            notificationSignalsTableId: schema.notificationSignalsTableId,
            outboxTableId: schema.outboxTableId,
          },
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
