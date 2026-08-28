import { createHash } from "node:crypto";
import { Query, type TablesDB } from "node-appwrite";

import {
  ConversationLifecycleError,
  appendConversationEntry,
  planLifecycleTransition,
  type AppendConversationCommand,
  type FeedbackLifecycleState,
  type LifecycleTransitionCommand,
} from "@y7-feedback/domain";

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
    readonly permissions: readonly [];
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
  readonly workspaceId: string;
  readonly projectId: string;
  readonly payloadDigest: string;
  readonly command: Command;
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
  ];
  if (ids.some((id) => !appwriteId.test(id)) || new Set(ids).size !== ids.length) {
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

export function createAppwriteConversationLifecycleStore(
  tables: AppwriteConversationLifecycleTablesPort,
  schema: AppwriteConversationLifecycleSchema,
  queries: ConversationLifecycleQueryPort,
  persistence: AppwriteSensitivePersistence,
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
          feedback.workspaceId !== input.workspaceId ||
          feedback.projectId !== input.projectId ||
          typeof feedback.state !== "string" ||
          !states.has(feedback.state as FeedbackLifecycleState)
        ) {
          throw new AppwriteConversationLifecycleError("ERR-CONV-DENIED");
        }

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
              workspaceId: input.workspaceId,
              projectId: input.projectId,
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
              workspaceId: input.workspaceId,
              projectId: input.projectId,
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
): ConversationLifecycleStore {
  return createAppwriteConversationLifecycleStore(
    {
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
    },
    schema,
    defaultQueries,
    persistence,
  );
}
