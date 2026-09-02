import { createHash } from "node:crypto";
import { Query, type TablesDB } from "node-appwrite";

import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface ProviderConsentCleanup {
  request(input: {
    readonly feedbackId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly consentOperationId: string;
    readonly occurredAt: string;
  }): Promise<{ readonly queued: number; readonly guarantee: "best_effort" }>;
}

export interface AppwriteProviderConsentCleanupTablesPort {
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
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
    readonly transactionId: string;
  }): Promise<unknown>;
}

export interface AppwriteProviderConsentCleanupQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  orderDesc(attribute: string): string;
  limit(value: number): string;
}

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
/* v8 ignore start -- Node SDK query adaptation is exercised by deployed verification. */
const defaults: AppwriteProviderConsentCleanupQueryPort = {
  equal: (key, values) => Query.equal(key, [...values]),
  orderDesc: (key) => Query.orderDesc(key),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */
const object = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stable = (prefix: string, ...parts: readonly string[]) =>
  `${prefix}${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 31)}`;

export function createAppwriteProviderConsentCleanup(
  tables: AppwriteProviderConsentCleanupTablesPort,
  schema: {
    readonly databaseId: string;
    readonly externalIssueLinksTableId: string;
    readonly providerSyncOutboxTableId: string;
  },
  queries: AppwriteProviderConsentCleanupQueryPort,
  persistence: AppwriteSensitivePersistence,
): ProviderConsentCleanup {
  return {
    async request(input) {
      if (
        ![
          schema.databaseId,
          schema.externalIssueLinksTableId,
          schema.providerSyncOutboxTableId,
          input.feedbackId,
          input.workspaceId,
          input.projectId,
          input.consentOperationId,
        ].every((value) => id.test(value)) ||
        !Number.isFinite(Date.parse(input.occurredAt))
      )
        throw new Error("PROVIDER_CONSENT_CLEANUP_INVALID");
      const tx = await tables.createTransaction({ ttl: 60 });
      try {
        const links = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.externalIssueLinksTableId,
          queries: [
            queries.equal("feedbackId", [input.feedbackId]),
            queries.equal("state", ["active"]),
            queries.limit(2),
          ],
          total: false,
          ttl: 0,
          transactionId: tx.$id,
        });
        let queued = 0;
        for (const link of links.rows) {
          if (
            !object(link) ||
            typeof link.$id !== "string" ||
            link.workspaceId !== input.workspaceId ||
            link.projectId !== input.projectId ||
            link.visibility !== "public" ||
            (link.provider !== "github" && link.provider !== "gitlab") ||
            typeof link.repositoryId !== "string" ||
            typeof link.connectionId !== "string" ||
            typeof link.providerIssueId !== "string"
          )
            continue;
          const operations = await tables.listRows({
            databaseId: schema.databaseId,
            tableId: schema.providerSyncOutboxTableId,
            queries: [
              queries.equal("linkId", [link.$id]),
              queries.orderDesc("sequence"),
              queries.limit(100),
            ],
            total: false,
            ttl: 0,
            transactionId: tx.$id,
          });
          let sequence = 0;
          for (const operation of operations.rows)
            if (
              object(operation) &&
              typeof operation.sequence === "number" &&
              operation.sequence > sequence
            )
              sequence = operation.sequence;
          const published = operations.rows.filter(
            (operation) =>
              object(operation) &&
              operation.kind === "publish_message" &&
              operation.status === "succeeded" &&
              typeof operation.providerObjectId === "string",
          );
          for (const operation of published) {
            /* v8 ignore next 6 -- the filter above establishes these same structural guards. */
            if (
              !object(operation) ||
              typeof operation.$id !== "string" ||
              typeof operation.providerObjectId !== "string"
            )
              continue;
            const operationId = stable("cln_", input.consentOperationId, operation.$id);
            if (
              operations.rows.some(
                (candidate) =>
                  object(candidate) && candidate.operationId === operationId,
              )
            )
              continue;
            sequence += 1;
            const rowId = stable("psyn_", link.$id, operationId);
            const payload = JSON.stringify({
              kind: "remove_message",
              issueId: link.providerIssueId,
              commentId: operation.providerObjectId,
            });
            const created = await tables.createRow({
              databaseId: schema.databaseId,
              tableId: schema.providerSyncOutboxTableId,
              rowId,
              data: {
                operationId,
                linkId: link.$id,
                feedbackId: input.feedbackId,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                connectionId: link.connectionId,
                provider: link.provider,
                repositoryId: link.repositoryId,
                kind: "remove_message",
                status: "pending",
                sequence,
                attempts: 0,
                payloadEnvelope: persistence.protector.seal(
                  {
                    environment: persistence.environment,
                    tableId: schema.providerSyncOutboxTableId,
                    rowId,
                    field: "payloadEnvelope",
                  },
                  payload,
                ),
                payloadDigest: createHash("sha256").update(payload).digest("base64url"),
                originMarker: `y7cleanup:${operationId}`,
                createdAt: input.occurredAt,
                updatedAt: input.occurredAt,
              },
              permissions: [],
              transactionId: tx.$id,
            });
            if (!object(created) || created.$id !== rowId)
              throw new Error("PROVIDER_CONSENT_CLEANUP_WRITE_INVALID");
            queued += 1;
          }
        }
        await tables.updateTransaction({ transactionId: tx.$id, commit: true });
        return { queued, guarantee: "best_effort" };
      } catch (error) {
        try {
          await tables.updateTransaction({ transactionId: tx.$id, rollback: true });
        } catch {
          /* preserve original */
        }
        throw error;
      }
    },
  };
}

/* v8 ignore start -- Node SDK adaptation is covered by deployed Preview verification. */
export function createNodeAppwriteProviderConsentCleanup(
  tables: TablesDB,
  schema: {
    readonly databaseId: string;
    readonly externalIssueLinksTableId: string;
    readonly providerSyncOutboxTableId: string;
  },
  persistence: AppwriteSensitivePersistence,
): ProviderConsentCleanup {
  return createAppwriteProviderConsentCleanup(
    {
      createTransaction: (input) => tables.createTransaction(input),
      updateTransaction: (input) => tables.updateTransaction(input),
      listRows: async (input) => {
        const rows = await tables.listRows({ ...input, queries: [...input.queries] });
        return { rows: rows.rows };
      },
      createRow: (input) =>
        tables.createRow({ ...input, permissions: [...input.permissions] }),
    },
    schema,
    defaults,
    persistence,
  );
}
/* v8 ignore stop */
