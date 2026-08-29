import { Query, type TablesDB } from "node-appwrite";

import type { ExternalIssuePayload, SourceProvider } from "@y7-feedback/domain";

import { issueDocument } from "./provider-issue.js";
import type {
  ClaimedProviderIssue,
  ProviderIssueOutboxStore,
} from "./provider-issue-outbox.js";

export interface AppwriteProviderIssueOutboxSchema {
  readonly databaseId: string;
  readonly providerOutboxTableId: string;
  readonly externalIssueLinksTableId: string;
  readonly sourceConnectionsTableId: string;
}

export interface AppwriteProviderIssueOutboxTablesPort {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: string[];
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

export interface AppwriteProviderIssueOutboxQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  orderAsc(attribute: string): string;
  limit(value: number): string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const instant = (value: unknown): value is string =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(Date.parse(value)).toISOString() === value;

const storedInstant = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined;
};

/* v8 ignore start -- Node Query serialization is covered by deployed verification. */
const defaultQueries: AppwriteProviderIssueOutboxQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  orderAsc: (attribute) => Query.orderAsc(attribute),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function provider(value: unknown): SourceProvider | undefined {
  return value === "github" || value === "gitlab" ? value : undefined;
}

function schemaValid(schema: AppwriteProviderIssueOutboxSchema): boolean {
  const values = Object.values(schema) as readonly string[];
  return (
    values.every((value) => identifier.test(value) && value.length <= 36) &&
    new Set(values.slice(1)).size === values.length - 1
  );
}

function payload(value: unknown): ExternalIssuePayload {
  if (typeof value !== "string") throw new Error("PROVIDER_OUTBOX_ROW_INVALID");
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !object(parsed) ||
      Object.keys(parsed).sort().join(",") !==
        (parsed.reporterContent === undefined
          ? "feedbackType,origin,protectedWorkspaceUrl,reference"
          : "feedbackType,origin,protectedWorkspaceUrl,reference,reporterContent") ||
      typeof parsed.reference !== "string" ||
      typeof parsed.protectedWorkspaceUrl !== "string" ||
      (parsed.feedbackType !== "bug" &&
        parsed.feedbackType !== "suggestion" &&
        parsed.feedbackType !== "review") ||
      parsed.origin !== "y7-feedback" ||
      (parsed.reporterContent !== undefined &&
        typeof parsed.reporterContent !== "string")
    ) {
      throw new Error("invalid");
    }
    return parsed as unknown as ExternalIssuePayload;
  } catch {
    throw new Error("PROVIDER_OUTBOX_ROW_INVALID");
  }
}

function importedRepository(
  connection: unknown,
  row: Readonly<Record<string, unknown>>,
): {
  readonly encryptedGrantRef: string;
  readonly repository: {
    readonly id: string;
    readonly owner: string;
    readonly name: string;
  };
} {
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
  ) {
    throw new Error("PROVIDER_OUTBOX_ROW_INVALID");
  }
  try {
    const selected: unknown = JSON.parse(connection.selectedRepositoriesJson);
    if (
      !object(selected) ||
      selected.kind !== "selected" ||
      !Array.isArray(selected.imports)
    ) {
      throw new Error("invalid");
    }
    const imports = selected.imports as readonly unknown[];
    const matches = imports.filter(
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
    ) {
      throw new Error("invalid");
    }
    return {
      encryptedGrantRef: connection.encryptedGrantRef,
      repository: {
        id: String(row.repositoryId),
        owner: match.owner,
        name: match.name,
      },
    };
  } catch {
    throw new Error("PROVIDER_OUTBOX_ROW_INVALID");
  }
}

function candidate(value: unknown, now: string, staleBefore: string) {
  const updatedAt = object(value) ? storedInstant(value.updatedAt) : undefined;
  const nextAttemptAt = object(value) ? storedInstant(value.nextAttemptAt) : undefined;
  if (
    !object(value) ||
    typeof value.$id !== "string" ||
    !identifier.test(value.$id) ||
    typeof value.linkId !== "string" ||
    !identifier.test(value.linkId) ||
    typeof value.operationId !== "string" ||
    !identifier.test(value.operationId) ||
    typeof value.connectionId !== "string" ||
    !identifier.test(value.connectionId) ||
    typeof value.repositoryId !== "string" ||
    !identifier.test(value.repositoryId) ||
    !provider(value.provider) ||
    typeof value.attempts !== "number" ||
    !Number.isSafeInteger(value.attempts) ||
    value.attempts < 0 ||
    updatedAt === undefined ||
    (value.status !== "pending" && value.status !== "processing")
  ) {
    return undefined;
  }
  const due =
    value.status === "processing"
      ? updatedAt <= staleBefore
      : value.nextAttemptAt === undefined ||
        value.nextAttemptAt === null ||
        (nextAttemptAt !== undefined && nextAttemptAt <= now);
  return due ? value : undefined;
}

function conflict(value: unknown): boolean {
  return object(value) && value.code === 409;
}

export function createAppwriteProviderIssueOutboxStore(
  tables: AppwriteProviderIssueOutboxTablesPort,
  schema: AppwriteProviderIssueOutboxSchema,
  queries: AppwriteProviderIssueOutboxQueryPort = defaultQueries,
): ProviderIssueOutboxStore {
  if (!schemaValid(schema)) throw new Error("PROVIDER_OUTBOX_SCHEMA_INVALID");

  async function transaction<T>(
    work: (transactionId: string) => Promise<T>,
  ): Promise<T> {
    const created = await tables.createTransaction({ ttl: 60 });
    if (!identifier.test(created.$id)) throw new Error("PROVIDER_OUTBOX_TX_INVALID");
    try {
      const result = await work(created.$id);
      await tables.updateTransaction({ transactionId: created.$id, commit: true });
      return result;
    } catch (error) {
      try {
        await tables.updateTransaction({ transactionId: created.$id, rollback: true });
      } catch {
        // Preserve the original failure; Appwrite expires abandoned transactions.
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
    outboxData: Readonly<Record<string, unknown>>,
    linkData: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await transaction(async (transactionId) => {
      const row = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.providerOutboxTableId,
        rowId: input.outboxId,
        transactionId,
      });
      if (
        !object(row) ||
        row.$id !== input.outboxId ||
        row.linkId !== input.linkId ||
        row.status !== "processing" ||
        row.attempts !== input.attempt
      ) {
        throw new Error("PROVIDER_OUTBOX_STATE_CONFLICT");
      }
      const link = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.externalIssueLinksTableId,
        rowId: input.linkId,
        transactionId,
      });
      if (!object(link) || link.$id !== input.linkId || link.state !== "active") {
        throw new Error("PROVIDER_OUTBOX_STATE_CONFLICT");
      }
      const updatedOutbox = await tables.updateRow({
        databaseId: schema.databaseId,
        tableId: schema.providerOutboxTableId,
        rowId: input.outboxId,
        data: outboxData,
        transactionId,
      });
      const updatedLink = await tables.updateRow({
        databaseId: schema.databaseId,
        tableId: schema.externalIssueLinksTableId,
        rowId: input.linkId,
        data: linkData,
        transactionId,
      });
      if (
        !object(updatedOutbox) ||
        updatedOutbox.$id !== input.outboxId ||
        !object(updatedLink) ||
        updatedLink.$id !== input.linkId
      ) {
        throw new Error("PROVIDER_OUTBOX_WRITE_INVALID");
      }
    });
  }

  return {
    async claim(input) {
      if (
        !identifier.test(input.workerId) ||
        !instant(input.now) ||
        !instant(input.staleBefore)
      ) {
        throw new Error("PROVIDER_OUTBOX_CLAIM_INVALID");
      }
      try {
        return await transaction(async (transactionId) => {
          const listed = await tables.listRows({
            databaseId: schema.databaseId,
            tableId: schema.providerOutboxTableId,
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
            .map((value) => candidate(value, input.now, input.staleBefore))
            .find((value) => value !== undefined);
          if (!row) return null;
          const sourceProvider = row.provider as SourceProvider;
          const parsedPayload = payload(row.payloadJson);
          const imported = importedRepository(
            await tables.getRow({
              databaseId: schema.databaseId,
              tableId: schema.sourceConnectionsTableId,
              rowId: String(row.connectionId),
              transactionId,
            }),
            row,
          );
          issueDocument({
            operationId: String(row.operationId),
            repository: imported.repository,
            payload: parsedPayload,
          });
          const attempt = Number(row.attempts) + 1;
          const updated = await tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.providerOutboxTableId,
            rowId: String(row.$id),
            data: {
              status: "processing",
              attempts: attempt,
              claimedBy: input.workerId,
              updatedAt: input.now,
            },
            transactionId,
          });
          if (!object(updated) || updated.$id !== row.$id) {
            throw new Error("PROVIDER_OUTBOX_WRITE_INVALID");
          }
          return {
            outboxId: String(row.$id),
            linkId: String(row.linkId),
            operationId: String(row.operationId),
            provider: sourceProvider,
            encryptedGrantRef: imported.encryptedGrantRef,
            repository: imported.repository,
            payload: parsedPayload,
            attempt,
          } satisfies ClaimedProviderIssue;
        });
      } catch (error) {
        if (conflict(error)) return null;
        throw error;
      }
    },
    delivered(input) {
      if (
        !identifier.test(input.issueId) ||
        !instant(input.deliveredAt) ||
        !input.issueUrl.startsWith("https://")
      ) {
        return Promise.reject(new Error("PROVIDER_OUTBOX_DELIVERY_INVALID"));
      }
      return transition(
        input,
        { status: "delivered", updatedAt: input.deliveredAt },
        {
          synchronizationState: "synchronized",
          providerIssueId: input.issueId,
          providerIssueUrl: input.issueUrl,
          updatedAt: input.deliveredAt,
        },
      );
    },
    retry(input) {
      if (!instant(input.failedAt) || !instant(input.nextAttemptAt)) {
        return Promise.reject(new Error("PROVIDER_OUTBOX_RETRY_INVALID"));
      }
      return transition(
        input,
        {
          status: "pending",
          nextAttemptAt: input.nextAttemptAt,
          lastErrorCode: input.errorCode,
          updatedAt: input.failedAt,
        },
        { synchronizationState: "failed", updatedAt: input.failedAt },
      );
    },
    failed(input) {
      if (!instant(input.failedAt)) {
        return Promise.reject(new Error("PROVIDER_OUTBOX_FAILURE_INVALID"));
      }
      return transition(
        input,
        {
          status: "failed",
          lastErrorCode: input.errorCode,
          updatedAt: input.failedAt,
        },
        { synchronizationState: "failed", updatedAt: input.failedAt },
      );
    },
  };
}

/* v8 ignore start -- Thin Node SDK composition wrapper. */
export function createNodeAppwriteProviderIssueOutboxStore(
  tables: TablesDB,
  schema: AppwriteProviderIssueOutboxSchema,
): ProviderIssueOutboxStore {
  return createAppwriteProviderIssueOutboxStore(tables, schema);
}
/* v8 ignore stop */
