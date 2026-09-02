import { Query, type TablesDB } from "node-appwrite";

import type { FeedbackLifecycleState } from "@y7-feedback/domain";

import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface ConversationProjectionMessage {
  readonly id: string;
  readonly actorId: string;
  readonly actorKind: "workspace" | "reporter";
  readonly audience: "workspace" | "reporter";
  readonly occurredAt: string;
  readonly content: string;
  readonly provider?: "github" | "gitlab";
  readonly revisionKind?: "created" | "revised" | "tombstoned";
  readonly supersedesMessageId?: string;
}

export interface ConversationProjectionLifecycleFact {
  readonly id: string;
  readonly priorState: FeedbackLifecycleState;
  readonly state: FeedbackLifecycleState;
  readonly actorId: string;
  readonly actorKind: "workspace" | "reporter";
  readonly occurredAt: string;
  readonly reason: string;
  readonly sequence: number;
}

export interface ReporterConversationProjection {
  readonly feedbackId: string;
  readonly state: FeedbackLifecycleState;
  readonly messages: readonly ConversationProjectionMessage[];
  readonly lifecycle: readonly ConversationProjectionLifecycleFact[];
}

export interface WorkspaceConversationProjection extends ReporterConversationProjection {
  readonly internalNotes: readonly ConversationProjectionMessage[];
}

export class AppwriteConversationProjectionError extends Error {
  readonly code: "ERR-CONV-DENIED" | "ERR-CONV-RETRYABLE";

  constructor(code: AppwriteConversationProjectionError["code"]) {
    super(code);
    this.name = "AppwriteConversationProjectionError";
    this.code = code;
  }
}

export interface AppwriteConversationProjectionSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly messagesTableId: string;
  readonly internalNotesTableId: string;
  readonly lifecycleTableId: string;
}

export interface AppwriteConversationProjectionTablesPort {
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

export interface ConversationProjectionQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
  orderAsc(attribute: string): string;
}

export interface ConversationProjectionStore {
  readWorkspace(input: {
    readonly feedbackId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<WorkspaceConversationProjection>;
  readReporter(input: {
    readonly feedbackId: string;
  }): Promise<ReporterConversationProjection>;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const states = new Set<FeedbackLifecycleState>([
  "received",
  "under_review",
  "awaiting_reporter",
  "resolved",
  "closed",
]);
const defaultQueries: ConversationProjectionQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
  orderAsc: (attribute) => Query.orderAsc(attribute),
};

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaValid(schema: AppwriteConversationProjectionSchema): boolean {
  const ids = [
    schema.databaseId,
    schema.feedbackTableId,
    schema.messagesTableId,
    schema.internalNotesTableId,
    schema.lifecycleTableId,
  ];
  const tables = ids.slice(1);
  return (
    ids.every((id) => appwriteId.test(id)) && new Set(tables).size === tables.length
  );
}

function actor(value: unknown): value is "workspace" | "reporter" {
  return value === "workspace" || value === "reporter";
}

export function parseConversationProjectionMessage(
  value: unknown,
  expected: {
    readonly feedbackId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly tableId: string;
    readonly audience?: "reporter" | "workspace";
  },
  persistence: AppwriteSensitivePersistence,
): ConversationProjectionMessage {
  if (
    !object(value) ||
    typeof value.$id !== "string" ||
    !appwriteId.test(value.$id) ||
    value.feedbackId !== expected.feedbackId ||
    value.workspaceId !== expected.workspaceId ||
    value.projectId !== expected.projectId ||
    !actor(value.actorKind) ||
    typeof value.actorId !== "string" ||
    !appwriteId.test(value.actorId) ||
    (value.audience !== "workspace" && value.audience !== "reporter") ||
    (expected.audience !== undefined && value.audience !== expected.audience) ||
    typeof value.contentEnvelope !== "string" ||
    typeof value.occurredAt !== "string"
  ) {
    throw new AppwriteConversationProjectionError("ERR-CONV-RETRYABLE");
  }
  const providerRevision = value.origin === "provider";
  if (
    providerRevision &&
    ((value.provider !== "github" && value.provider !== "gitlab") ||
      (value.revisionKind !== "created" &&
        value.revisionKind !== "revised" &&
        value.revisionKind !== "tombstoned") ||
      (value.revisionKind === "created"
        ? value.supersedesMessageId !== undefined
        : typeof value.supersedesMessageId !== "string" ||
          !appwriteId.test(value.supersedesMessageId)))
  ) {
    throw new AppwriteConversationProjectionError("ERR-CONV-RETRYABLE");
  }
  return {
    id: value.$id,
    actorId: value.actorId,
    actorKind: value.actorKind,
    audience: value.audience,
    occurredAt: value.occurredAt,
    content: persistence.protector.open(
      {
        environment: persistence.environment,
        tableId: expected.tableId,
        rowId: value.$id,
        field: "contentEnvelope",
      },
      value.contentEnvelope,
    ),
    ...(providerRevision
      ? {
          provider: value.provider as "github" | "gitlab",
          revisionKind: value.revisionKind as "created" | "revised" | "tombstoned",
          ...(typeof value.supersedesMessageId === "string"
            ? { supersedesMessageId: value.supersedesMessageId }
            : {}),
        }
      : {}),
  };
}

function lifecycle(
  value: unknown,
  expected: {
    readonly feedbackId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly tableId: string;
  },
  persistence: AppwriteSensitivePersistence,
): ConversationProjectionLifecycleFact {
  if (
    !object(value) ||
    typeof value.$id !== "string" ||
    !appwriteId.test(value.$id) ||
    value.feedbackId !== expected.feedbackId ||
    value.workspaceId !== expected.workspaceId ||
    value.projectId !== expected.projectId ||
    !actor(value.actorKind) ||
    typeof value.actorId !== "string" ||
    !appwriteId.test(value.actorId) ||
    typeof value.priorState !== "string" ||
    !states.has(value.priorState as FeedbackLifecycleState) ||
    typeof value.state !== "string" ||
    !states.has(value.state as FeedbackLifecycleState) ||
    typeof value.reasonEnvelope !== "string" ||
    typeof value.occurredAt !== "string" ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 2
  ) {
    throw new AppwriteConversationProjectionError("ERR-CONV-RETRYABLE");
  }
  return {
    id: value.$id,
    actorId: value.actorId,
    actorKind: value.actorKind,
    priorState: value.priorState as FeedbackLifecycleState,
    state: value.state as FeedbackLifecycleState,
    occurredAt: value.occurredAt,
    sequence: value.sequence,
    reason: persistence.protector.open(
      {
        environment: persistence.environment,
        tableId: expected.tableId,
        rowId: value.$id,
        field: "reasonEnvelope",
      },
      value.reasonEnvelope,
    ),
  };
}

export function createAppwriteConversationProjectionStore(
  tables: AppwriteConversationProjectionTablesPort,
  schema: AppwriteConversationProjectionSchema,
  queries: ConversationProjectionQueryPort,
  persistence: AppwriteSensitivePersistence,
): ConversationProjectionStore {
  if (!schemaValid(schema)) {
    throw new Error("APPWRITE_CONVERSATION_PROJECTION_SCHEMA_INVALID");
  }

  async function read(
    input: {
      readonly feedbackId: string;
      readonly workspaceId?: string;
      readonly projectId?: string;
    },
    includeNotes: boolean,
  ): Promise<WorkspaceConversationProjection | ReporterConversationProjection> {
    try {
      const feedback = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.feedbackTableId,
        rowId: input.feedbackId,
      });
      if (
        !object(feedback) ||
        feedback.$id !== input.feedbackId ||
        typeof feedback.workspaceId !== "string" ||
        !appwriteId.test(feedback.workspaceId) ||
        typeof feedback.projectId !== "string" ||
        !appwriteId.test(feedback.projectId) ||
        typeof feedback.state !== "string" ||
        !states.has(feedback.state as FeedbackLifecycleState) ||
        (input.workspaceId !== undefined &&
          feedback.workspaceId !== input.workspaceId) ||
        (input.projectId !== undefined && feedback.projectId !== input.projectId)
      ) {
        throw new AppwriteConversationProjectionError("ERR-CONV-DENIED");
      }
      const scope = {
        feedbackId: input.feedbackId,
        workspaceId: feedback.workspaceId,
        projectId: feedback.projectId,
      };
      const commonQueries = [
        queries.equal("feedbackId", [input.feedbackId]),
        queries.orderAsc("occurredAt"),
        queries.limit(500),
      ];
      const messageRows = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.messagesTableId,
        queries: includeNotes
          ? commonQueries
          : [
              queries.equal("feedbackId", [input.feedbackId]),
              queries.equal("audience", ["reporter"]),
              queries.orderAsc("occurredAt"),
              queries.limit(500),
            ],
        total: false,
        ttl: 0,
      });
      const lifecycleRows = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.lifecycleTableId,
        queries: [
          queries.equal("feedbackId", [input.feedbackId]),
          queries.orderAsc("sequence"),
          queries.limit(500),
        ],
        total: false,
        ttl: 0,
      });
      const messages = messageRows.rows.map((row) =>
        parseConversationProjectionMessage(
          row,
          {
            ...scope,
            tableId: schema.messagesTableId,
            ...(includeNotes ? {} : { audience: "reporter" as const }),
          },
          persistence,
        ),
      );
      const history = lifecycleRows.rows.map((row) =>
        lifecycle(row, { ...scope, tableId: schema.lifecycleTableId }, persistence),
      );
      const base: ReporterConversationProjection = {
        feedbackId: input.feedbackId,
        state: feedback.state as FeedbackLifecycleState,
        messages,
        lifecycle: history,
      };
      if (!includeNotes) return base;
      const noteRows = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.internalNotesTableId,
        queries: commonQueries,
        total: false,
        ttl: 0,
      });
      return {
        ...base,
        internalNotes: noteRows.rows.map((row) =>
          parseConversationProjectionMessage(
            row,
            { ...scope, tableId: schema.internalNotesTableId, audience: "workspace" },
            persistence,
          ),
        ),
      };
    } catch (error: unknown) {
      if (error instanceof AppwriteConversationProjectionError) throw error;
      throw new AppwriteConversationProjectionError("ERR-CONV-RETRYABLE");
    }
  }

  return {
    readReporter: (input) => read(input, false),
    readWorkspace: (input) =>
      read(input, true) as Promise<WorkspaceConversationProjection>,
  };
}

export function createNodeAppwriteConversationProjectionStore(
  tables: TablesDB,
  schema: AppwriteConversationProjectionSchema,
  persistence: AppwriteSensitivePersistence,
): ConversationProjectionStore {
  return createAppwriteConversationProjectionStore(
    {
      getRow: (input) => tables.getRow(input),
      listRows: async (input) => {
        const result = await tables.listRows({ ...input, queries: [...input.queries] });
        return { rows: result.rows };
      },
    },
    schema,
    defaultQueries,
    persistence,
  );
}
