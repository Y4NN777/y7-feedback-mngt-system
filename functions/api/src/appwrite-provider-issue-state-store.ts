import { Query, type TablesDB } from "node-appwrite";

import type { ProviderIssueStateStore } from "./provider-issue-event.js";

export interface AppwriteProviderIssueStateSchema {
  readonly databaseId: string;
  readonly externalIssueLinksTableId: string;
}

export interface AppwriteProviderIssueStateTablesPort {
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
  updateRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly transactionId: string;
  }): Promise<unknown>;
}

export interface AppwriteProviderIssueStateQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

/* v8 ignore start -- Node Query serialization is covered by deployed verification. */
const defaultQueries: AppwriteProviderIssueStateQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

export function createAppwriteProviderIssueStateStore(
  tables: AppwriteProviderIssueStateTablesPort,
  schema: AppwriteProviderIssueStateSchema,
  queries: AppwriteProviderIssueStateQueryPort = defaultQueries,
): ProviderIssueStateStore {
  if (
    !appwriteId.test(schema.databaseId) ||
    !appwriteId.test(schema.externalIssueLinksTableId) ||
    schema.databaseId === schema.externalIssueLinksTableId
  )
    throw new Error("PROVIDER_ISSUE_STATE_SCHEMA_INVALID");

  return {
    async apply(change) {
      if (
        !appwriteId.test(change.connectionId) ||
        !appwriteId.test(change.workspaceId) ||
        !appwriteId.test(change.projectId) ||
        !identifier.test(change.repositoryId) ||
        !identifier.test(change.issueId) ||
        !identifier.test(change.deliveryId) ||
        !instant(change.providerUpdatedAt)
      )
        return "permanent";
      const transaction = await tables.createTransaction({ ttl: 60 });
      if (!appwriteId.test(transaction.$id))
        throw new Error("PROVIDER_ISSUE_STATE_TX_INVALID");
      try {
        const listed = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.externalIssueLinksTableId,
          queries: [
            queries.equal("provider", [change.provider]),
            queries.equal("repositoryId", [change.repositoryId]),
            queries.equal("providerIssueId", [change.issueId]),
            queries.limit(2),
          ],
          total: false,
          ttl: 60,
          transactionId: transaction.$id,
        });
        if (listed.rows.length === 0) {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            commit: true,
          });
          return "ignored";
        }
        const row = listed.rows[0];
        if (
          listed.rows.length !== 1 ||
          !object(row) ||
          typeof row.$id !== "string" ||
          !appwriteId.test(row.$id) ||
          row.state !== "active" ||
          row.connectionId !== change.connectionId ||
          row.workspaceId !== change.workspaceId ||
          row.projectId !== change.projectId ||
          row.provider !== change.provider ||
          row.repositoryId !== change.repositoryId ||
          row.providerIssueId !== change.issueId
        ) {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            rollback: true,
          });
          return "permanent";
        }
        const previous = instant(row.providerUpdatedAt);
        if (
          row.lastProviderDeliveryId === change.deliveryId ||
          (previous !== null && previous >= change.providerUpdatedAt)
        ) {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            commit: true,
          });
          return "ignored";
        }
        const updated = await tables.updateRow({
          databaseId: schema.databaseId,
          tableId: schema.externalIssueLinksTableId,
          rowId: row.$id,
          data: {
            providerState: change.state,
            providerUpdatedAt: change.providerUpdatedAt,
            lastProviderDeliveryId: change.deliveryId,
            synchronizationState: "synchronized",
            updatedAt: change.providerUpdatedAt,
          },
          transactionId: transaction.$id,
        });
        if (!object(updated) || updated.$id !== row.$id)
          throw new Error("PROVIDER_ISSUE_STATE_WRITE_INVALID");
        await tables.updateTransaction({
          transactionId: transaction.$id,
          commit: true,
        });
        return "applied";
      } catch (error) {
        try {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            rollback: true,
          });
        } catch {
          // Preserve the originating failure; Appwrite expires abandoned transactions.
        }
        throw error;
      }
    },
  };
}

/* v8 ignore start -- thin Node SDK adaptation is covered by deployed verification. */
export function createNodeAppwriteProviderIssueStateStore(
  tables: TablesDB,
  schema: AppwriteProviderIssueStateSchema,
): ProviderIssueStateStore {
  return createAppwriteProviderIssueStateStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      updateTransaction: (input) => tables.updateTransaction(input),
      listRows: (input) => tables.listRows({ ...input, queries: [...input.queries] }),
      updateRow: (input) => tables.updateRow({ ...input, data: { ...input.data } }),
    },
    schema,
  );
}
/* v8 ignore stop */
