import { Query, type TablesDB } from "node-appwrite";

import {
  decidePrivacyDeletion,
  type PrivacyDeletionEvent,
  type PrivacyDeletionRecord,
} from "@y7-feedback/domain";

import type {
  PrivacyPurgeCandidate,
  PrivacyPurgeRepository,
} from "./privacy-cleanup.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwritePrivacyPurgeTables {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
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
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export interface AppwritePrivacyPurgeQueries {
  equal(attribute: string, values: readonly string[]): string;
  lessThanEqual(attribute: string, value: string): string;
  orderAsc(attribute: string): string;
  limit(value: number): string;
}

export interface AppwritePrivacyPurgeDependencies {
  readonly createEventId: () => string;
  readonly workerDigest: (workerId: string) => string;
}

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const digest = /^[A-Za-z0-9_-]{32,128}$/u;
const leaseMs = 15 * 60 * 1_000;

/* v8 ignore start -- SDK query serialization is covered by Preview. */
const nodeQueries: AppwritePrivacyPurgeQueries = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  lessThanEqual: (attribute, value) => Query.lessThanEqual(attribute, value),
  orderAsc: (attribute) => Query.orderAsc(attribute),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/(?:Z|[+-]00:00)$/u.test(value))
    throw new Error("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
  return new Date(parsed).toISOString();
}

function candidate(row: unknown): PrivacyPurgeCandidate & {
  readonly claimedAt?: string;
  readonly workerId?: string;
} {
  if (
    !object(row) ||
    typeof row.$id !== "string" ||
    typeof row.feedbackId !== "string" ||
    typeof row.workspaceId !== "string" ||
    typeof row.projectId !== "string" ||
    !Number.isSafeInteger(row.revision) ||
    Number(row.revision) < 1 ||
    row.state !== "soft_deleted"
  )
    throw new Error("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
  return {
    deletionId: row.$id,
    feedbackId: row.feedbackId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    revision: Number(row.revision),
    purgeEligibleAt: timestamp(row.purgeEligibleAt),
    ...(typeof row.purgeClaimedAt === "string"
      ? { claimedAt: timestamp(row.purgeClaimedAt) }
      : {}),
    ...(typeof row.purgeWorkerId === "string" ? { workerId: row.purgeWorkerId } : {}),
  };
}

function record(
  row: Readonly<Record<string, unknown>>,
  sensitive: AppwriteSensitivePersistence,
  tableId: string,
): PrivacyDeletionRecord {
  const item = candidate(row);
  if (
    (row.requesterKind !== "principal" && row.requesterKind !== "access_proof") ||
    typeof row.requesterDigest !== "string" ||
    typeof row.reasonCode !== "string" ||
    typeof row.requestedAt !== "string" ||
    row.identityErased !== true ||
    typeof row.auditEnvelope !== "string"
  )
    throw new Error("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
  let events: unknown;
  try {
    events = JSON.parse(
      sensitive.protector.open(
        {
          environment: sensitive.environment,
          tableId,
          rowId: item.deletionId,
          field: "auditEnvelope",
        },
        row.auditEnvelope,
      ),
    ) as unknown;
  } catch {
    throw new Error("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
  }
  if (!Array.isArray(events)) throw new Error("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
  return {
    feedbackId: item.feedbackId,
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    state: "soft_deleted",
    requesterKind: row.requesterKind,
    requesterDigest: row.requesterDigest,
    reasonCode: row.reasonCode,
    requestedAt: timestamp(row.requestedAt),
    purgeEligibleAt: item.purgeEligibleAt,
    revision: item.revision,
    identityErased: true,
    events: events as readonly PrivacyDeletionEvent[],
  };
}

export function createAppwritePrivacyPurgeRepository(
  tables: AppwritePrivacyPurgeTables,
  schema: { readonly databaseId: string; readonly deletionRecordsTableId: string },
  queries: AppwritePrivacyPurgeQueries,
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwritePrivacyPurgeDependencies,
): PrivacyPurgeRepository {
  if (!id.test(schema.databaseId) || !id.test(schema.deletionRecordsTableId))
    throw new Error("APPWRITE_PRIVACY_PURGE_SCHEMA_INVALID");
  return {
    async claimDue(input) {
      const now = timestamp(input.now);
      const nowMs = Date.parse(now);
      const transaction = await tables.createTransaction({ ttl: 60 });
      if (!id.test(transaction.$id))
        throw new Error("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
      try {
        const listed = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.deletionRecordsTableId,
          queries: [
            queries.equal("state", ["soft_deleted"]),
            queries.lessThanEqual("purgeEligibleAt", now),
            queries.orderAsc("purgeEligibleAt"),
            queries.limit(input.limit),
          ],
          total: false,
          ttl: 0,
          transactionId: transaction.$id,
        });
        const claimed: PrivacyPurgeCandidate[] = [];
        for (const value of listed.rows) {
          const item = candidate(value);
          const claimExpired =
            item.claimedAt === undefined ||
            Date.parse(item.claimedAt) <= nowMs - leaseMs ||
            item.workerId === input.workerId;
          if (!claimExpired) continue;
          await tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.deletionRecordsTableId,
            rowId: item.deletionId,
            data: { purgeWorkerId: input.workerId, purgeClaimedAt: now },
            transactionId: transaction.$id,
          });
          claimed.push(item);
        }
        await tables.updateTransaction({
          transactionId: transaction.$id,
          commit: true,
        });
        return claimed;
      } catch (error: unknown) {
        try {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            rollback: true,
          });
        } catch {
          // The original failure is authoritative.
        }
        throw error;
      }
    },
    async markPurged(input) {
      const transaction = await tables.createTransaction({ ttl: 60 });
      if (!id.test(transaction.$id))
        throw new Error("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
      try {
        const value = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.deletionRecordsTableId,
          rowId: input.deletionId,
          transactionId: transaction.$id,
        });
        if (!object(value)) throw new Error("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
        const operations =
          typeof value.operationIdsJson === "string"
            ? (JSON.parse(value.operationIdsJson) as unknown)
            : [];
        if (
          value.state === "purged" &&
          Array.isArray(operations) &&
          operations.includes(input.operationId)
        ) {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            rollback: true,
          });
          return "replayed";
        }
        if (
          value.state !== "soft_deleted" ||
          value.revision !== input.expectedRevision ||
          value.purgeWorkerId !== input.workerId
        ) {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            rollback: true,
          });
          return "stale";
        }
        const current = record(value, sensitive, schema.deletionRecordsTableId);
        const actorDigest = dependencies.workerDigest(input.workerId);
        if (!digest.test(actorDigest))
          throw new Error("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
        const decision = decidePrivacyDeletion(
          current,
          {
            type: "purge_feedback",
            operationId: input.operationId,
            expectedRevision: input.expectedRevision,
          },
          {
            actorDigest,
            createEventId: dependencies.createEventId,
            now: () => input.purgedAt,
          },
        );
        if (decision.status !== "accepted")
          throw new Error("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
        const auditEnvelope = sensitive.protector.seal(
          {
            environment: sensitive.environment,
            tableId: schema.deletionRecordsTableId,
            rowId: input.deletionId,
            field: "auditEnvelope",
          },
          JSON.stringify(decision.record.events),
        );
        await tables.updateRow({
          databaseId: schema.databaseId,
          tableId: schema.deletionRecordsTableId,
          rowId: input.deletionId,
          transactionId: transaction.$id,
          data: {
            state: "purged",
            purgedAt: decision.event.occurredAt,
            updatedAt: decision.event.occurredAt,
            revision: decision.record.revision,
            auditEnvelope,
            operationIdsJson: JSON.stringify(
              decision.record.events.map(({ operationId }) => operationId),
            ),
            purgeWorkerId: null,
            purgeClaimedAt: null,
          },
        });
        await tables.updateTransaction({
          transactionId: transaction.$id,
          commit: true,
        });
        return "purged";
      } catch (error: unknown) {
        try {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            rollback: true,
          });
        } catch {
          // The original failure is authoritative.
        }
        throw error;
      }
    },
  };
}

/* v8 ignore start -- Node SDK wiring is covered by Preview. */
export function createNodeAppwritePrivacyPurgeRepository(
  tables: TablesDB,
  schema: { readonly databaseId: string; readonly deletionRecordsTableId: string },
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwritePrivacyPurgeDependencies,
): PrivacyPurgeRepository {
  return createAppwritePrivacyPurgeRepository(
    {
      createTransaction: (input) => tables.createTransaction(input),
      listRows: async (input) => ({
        rows: (await tables.listRows({ ...input, queries: [...input.queries] })).rows,
      }),
      getRow: (input) => tables.getRow(input),
      updateRow: (input) => tables.updateRow(input),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
    nodeQueries,
    sensitive,
    dependencies,
  );
}
/* v8 ignore stop */
