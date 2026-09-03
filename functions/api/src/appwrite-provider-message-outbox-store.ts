/* v8 ignore file */
// Appwrite adapter behavior is covered by its contract suite and deployed Preview verification.
import { Query, type TablesDB } from "node-appwrite";

import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";
import type {
  ClaimedProviderMessage,
  ProviderMessageOutboxStore,
} from "./provider-message-outbox.js";

export interface AppwriteProviderMessageOutboxSchema {
  readonly databaseId: string;
  readonly providerSyncOutboxTableId: string;
  readonly externalIssueLinksTableId: string;
  readonly sourceConnectionsTableId: string;
}

export interface AppwriteProviderMessageOutboxTablesPort {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
    readonly transactionId: string;
  }): Promise<{ readonly rows: readonly unknown[] }>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly transactionId: string;
  }): Promise<unknown>;
  updateRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly transactionId: string;
  }): Promise<unknown>;
}

export interface AppwriteProviderMessageOutboxQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  orderAsc(attribute: string): string;
  limit(value: number): string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
/* v8 ignore start -- Node SDK query adaptation is exercised by deployed verification. */
const defaultQueries: AppwriteProviderMessageOutboxQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  orderAsc: (attribute) => Query.orderAsc(attribute),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function candidate(
  value: unknown,
  now: string,
  staleBefore: string,
): Readonly<Record<string, unknown>> | undefined {
  if (
    !object(value) ||
    typeof value.$id !== "string" ||
    !identifier.test(value.$id) ||
    typeof value.operationId !== "string" ||
    !identifier.test(value.operationId) ||
    typeof value.linkId !== "string" ||
    !identifier.test(value.linkId) ||
    typeof value.connectionId !== "string" ||
    !identifier.test(value.connectionId) ||
    typeof value.repositoryId !== "string" ||
    !identifier.test(value.repositoryId) ||
    (value.provider !== "github" && value.provider !== "gitlab") ||
    (value.kind !== "publish_message" && value.kind !== "remove_message") ||
    (value.status !== "pending" && value.status !== "processing") ||
    typeof value.attempts !== "number" ||
    !Number.isSafeInteger(value.attempts) ||
    value.attempts < 0 ||
    !instant(value.updatedAt)
  )
    return undefined;
  const due =
    value.status === "processing"
      ? value.updatedAt <= staleBefore
      : value.nextAttemptAt === undefined ||
        value.nextAttemptAt === null ||
        (instant(value.nextAttemptAt) && value.nextAttemptAt <= now);
  return due ? value : undefined;
}

function payload(value: unknown):
  | {
      readonly kind: "publish_message";
      readonly issueId: string;
      readonly content: string;
    }
  | {
      readonly kind: "remove_message";
      readonly issueId: string;
      readonly commentId: string;
    } {
  if (typeof value !== "string") throw new Error("PROVIDER_MESSAGE_OUTBOX_ROW_INVALID");
  try {
    const parsed: unknown = JSON.parse(value);
    if (!object(parsed) || !identifier.test(String(parsed.issueId))) throw new Error();
    if (
      parsed.kind === "publish_message" &&
      Object.keys(parsed).sort().join(",") === "content,issueId,kind,messageId" &&
      typeof parsed.content === "string" &&
      parsed.content.length > 0 &&
      parsed.content.length <= 10_000 &&
      typeof parsed.messageId === "string"
    )
      return {
        kind: "publish_message",
        issueId: String(parsed.issueId),
        content: parsed.content,
      };
    if (
      parsed.kind === "remove_message" &&
      Object.keys(parsed).sort().join(",") === "commentId,issueId,kind" &&
      identifier.test(String(parsed.commentId))
    )
      return {
        kind: "remove_message",
        issueId: String(parsed.issueId),
        commentId: String(parsed.commentId),
      };
    throw new Error();
  } catch {
    throw new Error("PROVIDER_MESSAGE_OUTBOX_ROW_INVALID");
  }
}

function repository(connection: unknown, row: Readonly<Record<string, unknown>>) {
  if (
    !object(connection) ||
    connection.$id !== row.connectionId ||
    connection.workspaceId !== row.workspaceId ||
    connection.projectId !== row.projectId ||
    connection.provider !== row.provider ||
    connection.status !== "active" ||
    typeof connection.encryptedGrantRef !== "string" ||
    !identifier.test(connection.encryptedGrantRef) ||
    typeof connection.selectedRepositoriesJson !== "string"
  )
    throw new Error("PROVIDER_MESSAGE_OUTBOX_ROW_INVALID");
  try {
    const selected: unknown = JSON.parse(connection.selectedRepositoriesJson);
    if (!object(selected) || !Array.isArray(selected.imports)) throw new Error();
    const matches = (selected.imports as readonly unknown[]).filter(
      (entry) =>
        object(entry) &&
        entry.connectionId === row.connectionId &&
        entry.provider === row.provider &&
        entry.repositoryId === row.repositoryId,
    );
    const match = matches[0];
    if (
      matches.length !== 1 ||
      !object(match) ||
      typeof match.owner !== "string" ||
      typeof match.name !== "string"
    )
      throw new Error();
    return {
      encryptedGrantRef: connection.encryptedGrantRef,
      repository: {
        id: String(row.repositoryId),
        owner: match.owner,
        name: match.name,
      },
    };
  } catch {
    throw new Error("PROVIDER_MESSAGE_OUTBOX_ROW_INVALID");
  }
}

export function createAppwriteProviderMessageOutboxStore(
  tables: AppwriteProviderMessageOutboxTablesPort,
  schema: AppwriteProviderMessageOutboxSchema,
  queries: AppwriteProviderMessageOutboxQueryPort,
  persistence: AppwriteSensitivePersistence,
): ProviderMessageOutboxStore {
  const ids = Object.values(schema) as readonly string[];
  if (
    ids.some((id) => !identifier.test(id) || id.length > 36) ||
    new Set(ids.slice(1)).size !== ids.length - 1
  )
    throw new Error("PROVIDER_MESSAGE_OUTBOX_SCHEMA_INVALID");
  async function transaction<T>(
    work: (transactionId: string) => Promise<T>,
  ): Promise<T> {
    const created = await tables.createTransaction({ ttl: 60 });
    if (!identifier.test(created.$id))
      throw new Error("PROVIDER_MESSAGE_OUTBOX_TX_INVALID");
    try {
      const result = await work(created.$id);
      await tables.updateTransaction({ transactionId: created.$id, commit: true });
      return result;
    } catch (error) {
      try {
        await tables.updateTransaction({ transactionId: created.$id, rollback: true });
      } catch {
        /* preserve original */
      }
      throw error;
    }
  }
  async function transition(
    input: {
      readonly outboxId: string;
      readonly linkId: string;
      readonly attempt: number;
    },
    data: Readonly<Record<string, unknown>>,
  ) {
    await transaction(async (transactionId) => {
      const row = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.providerSyncOutboxTableId,
        rowId: input.outboxId,
        transactionId,
      });
      if (
        !object(row) ||
        row.$id !== input.outboxId ||
        row.linkId !== input.linkId ||
        row.status !== "processing" ||
        row.attempts !== input.attempt
      )
        throw new Error("PROVIDER_MESSAGE_OUTBOX_STATE_CONFLICT");
      const updated = await tables.updateRow({
        databaseId: schema.databaseId,
        tableId: schema.providerSyncOutboxTableId,
        rowId: input.outboxId,
        data,
        transactionId,
      });
      if (!object(updated) || updated.$id !== input.outboxId)
        throw new Error("PROVIDER_MESSAGE_OUTBOX_WRITE_INVALID");
    });
  }
  return {
    claim(input) {
      if (
        !identifier.test(input.workerId) ||
        !instant(input.now) ||
        !instant(input.staleBefore)
      )
        throw new Error("PROVIDER_MESSAGE_OUTBOX_CLAIM_INVALID");
      return transaction(async (transactionId) => {
        const listed = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.providerSyncOutboxTableId,
          queries: [
            queries.equal("status", ["pending", "processing"]),
            queries.orderAsc("createdAt"),
            queries.limit(25),
          ],
          total: false,
          ttl: 60,
          transactionId,
        });
        const row = listed.rows
          .map((item) => candidate(item, input.now, input.staleBefore))
          .find((item) => item !== undefined);
        if (!row) return null;
        const link = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.externalIssueLinksTableId,
          rowId: String(row.linkId),
          transactionId,
        });
        if (
          !object(link) ||
          link.$id !== row.linkId ||
          link.state !== "active" ||
          link.feedbackId !== row.feedbackId ||
          link.connectionId !== row.connectionId ||
          link.provider !== row.provider ||
          link.repositoryId !== row.repositoryId ||
          typeof link.providerIssueId !== "string"
        )
          throw new Error("PROVIDER_MESSAGE_OUTBOX_ROW_INVALID");
        const imported = repository(
          await tables.getRow({
            databaseId: schema.databaseId,
            tableId: schema.sourceConnectionsTableId,
            rowId: String(row.connectionId),
            transactionId,
          }),
          row,
        );
        const opened = persistence.protector.open(
          {
            environment: persistence.environment,
            tableId: schema.providerSyncOutboxTableId,
            rowId: String(row.$id),
            field: "payloadEnvelope",
          },
          String(row.payloadEnvelope),
        );
        const parsed = payload(opened);
        if (parsed.issueId !== link.providerIssueId || parsed.kind !== row.kind)
          throw new Error("PROVIDER_MESSAGE_OUTBOX_ROW_INVALID");
        const attempt = Number(row.attempts) + 1;
        const updated = await tables.updateRow({
          databaseId: schema.databaseId,
          tableId: schema.providerSyncOutboxTableId,
          rowId: String(row.$id),
          data: {
            status: "processing",
            attempts: attempt,
            claimedBy: input.workerId,
            updatedAt: input.now,
          },
          transactionId,
        });
        if (!object(updated) || updated.$id !== row.$id)
          throw new Error("PROVIDER_MESSAGE_OUTBOX_WRITE_INVALID");
        return {
          outboxId: String(row.$id),
          linkId: String(row.linkId),
          operationId: String(row.operationId),
          provider: row.provider as "github" | "gitlab",
          ...imported,
          issueId: parsed.issueId,
          attempt,
          ...(parsed.kind === "publish_message"
            ? { kind: parsed.kind, content: parsed.content }
            : { kind: parsed.kind, commentId: parsed.commentId }),
        } satisfies ClaimedProviderMessage;
      });
    },
    delivered(input) {
      return transition(input, {
        status: "succeeded",
        updatedAt: input.deliveredAt,
        ...(input.providerObjectId === undefined
          ? {}
          : { providerObjectId: input.providerObjectId }),
        ...(input.missing === undefined ? {} : { cleanupMissing: input.missing }),
      });
    },
    retry(input) {
      return transition(input, {
        status: "pending",
        updatedAt: input.failedAt,
        nextAttemptAt: input.nextAttemptAt,
        lastErrorCode: input.errorCode,
      });
    },
    failed(input) {
      return transition(input, {
        status: "failed",
        updatedAt: input.failedAt,
        lastErrorCode: input.errorCode,
      });
    },
  };
}

/* v8 ignore start -- Node SDK adaptation is covered by deployed Preview verification. */
export function createNodeAppwriteProviderMessageOutboxStore(
  tables: TablesDB,
  schema: AppwriteProviderMessageOutboxSchema,
  persistence: AppwriteSensitivePersistence,
): ProviderMessageOutboxStore {
  return createAppwriteProviderMessageOutboxStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      updateTransaction: (input) => tables.updateTransaction(input),
      listRows: async (input) => {
        const rows = await tables.listRows({ ...input, queries: [...input.queries] });
        return { rows: rows.rows };
      },
      getRow: (input) => tables.getRow(input),
      updateRow: (input) => tables.updateRow({ ...input, data: { ...input.data } }),
    },
    schema,
    defaultQueries,
    persistence,
  );
}
/* v8 ignore stop */
