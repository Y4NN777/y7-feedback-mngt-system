import { createHash } from "node:crypto";

import { Query, type TablesDB } from "node-appwrite";

import type {
  AbuseCounterReceipt,
  AbuseCounterRequest,
  AbuseCounterStore,
} from "./abuse.js";

export interface AppwriteAbuseCounterSchema {
  readonly databaseId: string;
  readonly abuseCountersTableId: string;
}

export interface AppwriteAbuseCounterTables {
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
}

export interface AppwriteAbuseCounterQueries {
  equal(attribute: string, values: readonly (string | number)[]): string;
  limit(value: number): string;
}

const nodeQueries: AppwriteAbuseCounterQueries = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
};
const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("APPWRITE_ABUSE_COUNTER_INVALID");
  return parsed;
}

function retryable(error: unknown): boolean {
  return (
    object(error) && (error.code === 409 || error.code === 408 || error.code === 429)
  );
}

function rowId(counter: AbuseCounterRequest, windowStartedAt: string): string {
  return `abuse_${createHash("sha256")
    .update(counter.dimension)
    .update("\0")
    .update(counter.activeDigest)
    .update("\0")
    .update(windowStartedAt)
    .digest("hex")
    .slice(0, 30)}`;
}

function parsedRow(value: unknown): {
  readonly id: string;
  readonly digest: string;
  readonly count: number;
} {
  if (
    !object(value) ||
    typeof value.$id !== "string" ||
    typeof value.subjectDigest !== "string" ||
    !Number.isSafeInteger(value.count) ||
    Number(value.count) < 0
  )
    throw new Error("APPWRITE_ABUSE_COUNTER_INVALID");
  return { id: value.$id, digest: value.subjectDigest, count: Number(value.count) };
}

export function createAppwriteAbuseCounterStore(
  tables: AppwriteAbuseCounterTables,
  schema: AppwriteAbuseCounterSchema,
  queries: AppwriteAbuseCounterQueries,
): AbuseCounterStore {
  if (
    !id.test(schema.databaseId) ||
    !id.test(schema.abuseCountersTableId) ||
    schema.databaseId === schema.abuseCountersTableId
  )
    throw new Error("APPWRITE_ABUSE_COUNTER_SCHEMA_INVALID");

  const consumeOnce = async (input: {
    readonly counters: readonly AbuseCounterRequest[];
    readonly now: string;
  }) => {
    const nowMs = instant(input.now);
    const transaction = await tables.createTransaction({ ttl: 30 });
    if (!id.test(transaction.$id)) throw new Error("APPWRITE_ABUSE_COUNTER_INVALID");
    try {
      const receipts: AbuseCounterReceipt[] = [];
      let retryAfterSeconds = 0;
      for (const counter of input.counters) {
        if (
          counter.amount < 1 ||
          counter.limit < 1 ||
          counter.windowMs < 1 ||
          counter.subjectDigests.length < 1 ||
          !counter.subjectDigests.includes(counter.activeDigest)
        )
          throw new Error("APPWRITE_ABUSE_COUNTER_INVALID");
        const startMs = Math.floor(nowMs / counter.windowMs) * counter.windowMs;
        const windowStartedAt = new Date(startMs).toISOString();
        const expiresAt = new Date(startMs + counter.windowMs).toISOString();
        const listed = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.abuseCountersTableId,
          queries: [
            queries.equal("dimension", [counter.dimension]),
            queries.equal("subjectDigest", counter.subjectDigests),
            queries.equal("windowStartedAt", [windowStartedAt]),
            queries.limit(counter.subjectDigests.length + 1),
          ],
          total: false,
          ttl: 0,
          transactionId: transaction.$id,
        });
        const rows = listed.rows.map(parsedRow);
        const current = rows.find(({ digest }) => digest === counter.activeDigest);
        const total = rows.reduce((sum, row) => sum + row.count, 0);
        if (total + counter.amount > counter.limit) {
          retryAfterSeconds = Math.max(
            retryAfterSeconds,
            Math.max(1, Math.ceil((startMs + counter.windowMs - nowMs) / 1_000)),
          );
          continue;
        }
        const targetId = current?.id ?? rowId(counter, windowStartedAt);
        if (current) {
          await tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.abuseCountersTableId,
            rowId: targetId,
            data: { count: current.count + counter.amount, expiresAt },
            transactionId: transaction.$id,
          });
        } else {
          await tables.createRow({
            databaseId: schema.databaseId,
            tableId: schema.abuseCountersTableId,
            rowId: targetId,
            permissions: [],
            transactionId: transaction.$id,
            data: {
              dimension: counter.dimension,
              subjectDigest: counter.activeDigest,
              keyId: counter.keyId,
              count: counter.amount,
              windowStartedAt,
              expiresAt,
            },
          });
        }
        receipts.push({
          dimension: counter.dimension,
          rowId: targetId,
          amount: counter.amount,
        });
      }
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
      return retryAfterSeconds > 0
        ? ({ status: "limited", retryAfterSeconds } as const)
        : ({ status: "allowed", receipts } as const);
    } catch (error: unknown) {
      try {
        await tables.updateTransaction({
          transactionId: transaction.$id,
          rollback: true,
        });
      } catch {
        // Preserve the authoritative failure.
      }
      throw error;
    }
  };

  return {
    async consume(input) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          return await consumeOnce(input);
        } catch (error: unknown) {
          if (!retryable(error) || attempt === 3) throw error;
        }
      }
      throw new Error("APPWRITE_ABUSE_COUNTER_UNAVAILABLE");
    },
    async release({ receipt }) {
      const transaction = await tables.createTransaction({ ttl: 30 });
      if (!id.test(transaction.$id)) throw new Error("APPWRITE_ABUSE_COUNTER_INVALID");
      try {
        const value = parsedRow(
          await tables.getRow({
            databaseId: schema.databaseId,
            tableId: schema.abuseCountersTableId,
            rowId: receipt.rowId,
            transactionId: transaction.$id,
          }),
        );
        await tables.updateRow({
          databaseId: schema.databaseId,
          tableId: schema.abuseCountersTableId,
          rowId: receipt.rowId,
          data: { count: Math.max(0, value.count - receipt.amount) },
          transactionId: transaction.$id,
        });
        await tables.updateTransaction({
          transactionId: transaction.$id,
          commit: true,
        });
      } catch (error: unknown) {
        try {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            rollback: true,
          });
        } catch {
          // Preserve the authoritative failure.
        }
        throw error;
      }
    },
  };
}

/* v8 ignore start -- SDK serialization is covered by the Preview verifier. */
export function createNodeAppwriteAbuseCounterStore(
  tables: TablesDB,
  schema: AppwriteAbuseCounterSchema,
): AbuseCounterStore {
  return createAppwriteAbuseCounterStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      updateTransaction: (input) => tables.updateTransaction(input),
      listRows: async (input) => ({
        rows: (await tables.listRows({ ...input, queries: [...input.queries] })).rows,
      }),
      getRow: (input) => tables.getRow(input),
      createRow: (input) =>
        tables.createRow({ ...input, permissions: [...input.permissions] }),
      updateRow: (input) => tables.updateRow(input),
    },
    schema,
    nodeQueries,
  );
}
/* v8 ignore stop */
