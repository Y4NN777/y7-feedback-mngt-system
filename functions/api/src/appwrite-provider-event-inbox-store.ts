import { Query, type TablesDB } from "node-appwrite";

import type { SourceProvider } from "@y7-feedback/domain";

import type { ProviderEventInboxStore } from "./provider-webhook-ingress.js";
import type {
  ClaimedProviderEvent,
  ProviderEventInboxWorkerStore,
} from "./provider-event-inbox.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwriteProviderEventInboxSchema {
  readonly databaseId: string;
  readonly providerEventInboxTableId: string;
}

export interface AppwriteProviderEventInboxTablesPort {
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
  }): Promise<unknown>;
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

export interface AppwriteProviderEventInboxQueryPort {
  readonly equal: (attribute: string, values: readonly string[]) => string;
  readonly orderAsc: (attribute: string) => string;
  readonly limit: (value: number) => string;
}

export interface AppwriteProviderEventInboxDependencies {
  readonly createId: () => string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const digest = /^[A-Za-z0-9_-]{43}$/u;

/* v8 ignore start -- Node Query serialization is covered by deployed verification. */
const defaultQueries: AppwriteProviderEventInboxQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  orderAsc: (attribute) => Query.orderAsc(attribute),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function provider(value: unknown): SourceProvider | null {
  return value === "github" || value === "gitlab" ? value : null;
}

function instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function conflict(error: unknown): boolean {
  return object(error) && error.code === 409;
}

function candidate(value: unknown): Readonly<Record<string, unknown>> | null {
  if (
    !object(value) ||
    typeof value.$id !== "string" ||
    !appwriteId.test(value.$id) ||
    !provider(value.provider) ||
    typeof value.deliveryId !== "string" ||
    !identifier.test(value.deliveryId) ||
    typeof value.eventType !== "string" ||
    value.eventType.length > 64 ||
    typeof value.connectionId !== "string" ||
    !appwriteId.test(value.connectionId) ||
    typeof value.workspaceId !== "string" ||
    !appwriteId.test(value.workspaceId) ||
    typeof value.projectId !== "string" ||
    !appwriteId.test(value.projectId) ||
    typeof value.repositoryId !== "string" ||
    !identifier.test(value.repositoryId) ||
    typeof value.payloadEnvelope !== "string" ||
    typeof value.attempts !== "number" ||
    !Number.isSafeInteger(value.attempts) ||
    value.attempts < 0 ||
    !instant(value.receivedAt) ||
    !instant(value.availableAt) ||
    (value.status !== "pending" && value.status !== "processing")
  ) {
    return null;
  }
  return value;
}

export function createAppwriteProviderEventInboxStore(
  tables: AppwriteProviderEventInboxTablesPort,
  schema: AppwriteProviderEventInboxSchema,
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwriteProviderEventInboxDependencies,
  queries: AppwriteProviderEventInboxQueryPort = defaultQueries,
): ProviderEventInboxStore & ProviderEventInboxWorkerStore {
  if (
    !appwriteId.test(schema.databaseId) ||
    !appwriteId.test(schema.providerEventInboxTableId) ||
    schema.databaseId === schema.providerEventInboxTableId
  ) {
    throw new Error("PROVIDER_INBOX_SCHEMA_INVALID");
  }

  async function transaction<T>(
    work: (transactionId: string) => Promise<T>,
  ): Promise<T> {
    const created = await tables.createTransaction({ ttl: 60 });
    if (!appwriteId.test(created.$id)) throw new Error("PROVIDER_INBOX_TX_INVALID");
    try {
      const result = await work(created.$id);
      await tables.updateTransaction({ transactionId: created.$id, commit: true });
      return result;
    } catch (error) {
      try {
        await tables.updateTransaction({ transactionId: created.$id, rollback: true });
      } catch {
        // Preserve the originating failure; Appwrite expires abandoned transactions.
      }
      throw error;
    }
  }

  async function transition(
    input: { readonly inboxId: string; readonly attempt: number },
    data: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (!appwriteId.test(input.inboxId) || !Number.isSafeInteger(input.attempt)) {
      throw new Error("PROVIDER_INBOX_TRANSITION_INVALID");
    }
    await transaction(async (transactionId) => {
      const row = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.providerEventInboxTableId,
        rowId: input.inboxId,
        transactionId,
      });
      if (
        !object(row) ||
        row.$id !== input.inboxId ||
        row.status !== "processing" ||
        row.attempts !== input.attempt
      ) {
        throw new Error("PROVIDER_INBOX_STATE_CONFLICT");
      }
      const updated = await tables.updateRow({
        databaseId: schema.databaseId,
        tableId: schema.providerEventInboxTableId,
        rowId: input.inboxId,
        data,
        transactionId,
      });
      if (!object(updated) || updated.$id !== input.inboxId) {
        throw new Error("PROVIDER_INBOX_WRITE_INVALID");
      }
    });
  }

  return {
    async accept(input) {
      const rowId = dependencies.createId();
      if (
        !appwriteId.test(rowId) ||
        !appwriteId.test(input.connectionId) ||
        !appwriteId.test(input.workspaceId) ||
        !appwriteId.test(input.projectId) ||
        !identifier.test(input.deliveryId) ||
        !identifier.test(input.repositoryId) ||
        !digest.test(input.payloadDigest) ||
        !instant(input.receivedAt) ||
        input.payload.length === 0
      ) {
        throw new Error("PROVIDER_INBOX_ACCEPT_INVALID");
      }
      const payloadEnvelope = sensitive.protector.seal(
        {
          environment: sensitive.environment,
          tableId: schema.providerEventInboxTableId,
          rowId,
          field: "payloadEnvelope",
        },
        input.payload,
      );
      try {
        const created = await tables.createRow({
          databaseId: schema.databaseId,
          tableId: schema.providerEventInboxTableId,
          rowId,
          data: {
            provider: input.provider,
            deliveryId: input.deliveryId,
            eventType: input.eventType,
            connectionId: input.connectionId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            repositoryId: input.repositoryId,
            status: "pending",
            attempts: 0,
            payloadEnvelope,
            payloadDigest: input.payloadDigest,
            receivedAt: input.receivedAt,
            availableAt: input.receivedAt,
          },
          permissions: [],
        });
        if (!object(created) || created.$id !== rowId) {
          throw new Error("PROVIDER_INBOX_WRITE_INVALID");
        }
        return "accepted";
      } catch (error) {
        if (conflict(error)) return "duplicate";
        throw error;
      }
    },

    async claim(input) {
      if (
        !identifier.test(input.workerId) ||
        !instant(input.now) ||
        !instant(input.staleBefore)
      ) {
        throw new Error("PROVIDER_INBOX_CLAIM_INVALID");
      }
      return transaction(async (transactionId) => {
        const listed = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.providerEventInboxTableId,
          queries: [
            queries.equal("status", ["pending", "processing"]),
            queries.orderAsc("receivedAt"),
            queries.limit(100),
          ],
          total: false,
          ttl: 60,
          transactionId,
        });
        const seenConnections = new Set<string>();
        let selected: Readonly<Record<string, unknown>> | null = null;
        for (const value of listed.rows) {
          const row = candidate(value);
          if (!row) throw new Error("PROVIDER_INBOX_ROW_INVALID");
          const currentConnectionId = String(row.connectionId);
          if (seenConnections.has(currentConnectionId)) continue;
          seenConnections.add(currentConnectionId);
          const due =
            row.status === "pending"
              ? String(row.availableAt) <= input.now
              : instant(row.claimedAt) !== null &&
                String(instant(row.claimedAt)) <= input.staleBefore;
          if (due) {
            selected = row;
            break;
          }
        }
        if (!selected) return null;
        const attempt = Number(selected.attempts) + 1;
        const updated = await tables.updateRow({
          databaseId: schema.databaseId,
          tableId: schema.providerEventInboxTableId,
          rowId: String(selected.$id),
          data: {
            status: "processing",
            attempts: attempt,
            claimedAt: input.now,
            claimedBy: input.workerId,
            lastErrorCode: null,
          },
          transactionId,
        });
        if (!object(updated) || updated.$id !== selected.$id) {
          throw new Error("PROVIDER_INBOX_WRITE_INVALID");
        }
        const sourceProvider = selected.provider as SourceProvider;
        const context = {
          environment: sensitive.environment,
          tableId: schema.providerEventInboxTableId,
          rowId: String(selected.$id),
          field: "payloadEnvelope",
        } as const;
        return {
          inboxId: String(selected.$id),
          provider: sourceProvider,
          deliveryId: String(selected.deliveryId),
          eventType: String(selected.eventType),
          connectionId: String(selected.connectionId),
          workspaceId: String(selected.workspaceId),
          projectId: String(selected.projectId),
          repositoryId: String(selected.repositoryId),
          payloadEnvelope: sensitive.protector.open(
            context,
            String(selected.payloadEnvelope),
          ),
          attempt,
        } satisfies ClaimedProviderEvent;
      });
    },

    async complete(input) {
      if (!instant(input.completedAt))
        throw new Error("PROVIDER_INBOX_TRANSITION_INVALID");
      await transition(input, {
        status: "completed",
        completedAt: input.completedAt,
        claimedAt: null,
        claimedBy: null,
        lastErrorCode: null,
      });
    },

    async retry(input) {
      if (!instant(input.availableAt)) {
        throw new Error("PROVIDER_INBOX_TRANSITION_INVALID");
      }
      await transition(input, {
        status: "pending",
        availableAt: input.availableAt,
        claimedAt: null,
        claimedBy: null,
        lastErrorCode: input.errorCode,
      });
    },

    async fail(input) {
      if (!instant(input.failedAt)) {
        throw new Error("PROVIDER_INBOX_TRANSITION_INVALID");
      }
      await transition(input, {
        status: "failed",
        completedAt: input.failedAt,
        claimedAt: null,
        claimedBy: null,
        lastErrorCode: input.errorCode,
      });
    },
  };
}

/* v8 ignore start -- thin Node SDK adaptation is covered by deployed verification. */
export function createNodeAppwriteProviderEventInboxStore(
  tables: TablesDB,
  schema: AppwriteProviderEventInboxSchema,
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwriteProviderEventInboxDependencies,
): ProviderEventInboxStore & ProviderEventInboxWorkerStore {
  return createAppwriteProviderEventInboxStore(
    {
      createRow: (input) =>
        tables.createRow({
          ...input,
          data: { ...input.data },
          permissions: [...input.permissions],
        }),
      createTransaction: (input) => tables.createTransaction(input),
      updateTransaction: (input) => tables.updateTransaction(input),
      listRows: (input) => tables.listRows({ ...input, queries: [...input.queries] }),
      getRow: (input) => tables.getRow(input),
      updateRow: (input) => tables.updateRow({ ...input, data: { ...input.data } }),
    },
    schema,
    sensitive,
    dependencies,
  );
}
/* v8 ignore stop */
