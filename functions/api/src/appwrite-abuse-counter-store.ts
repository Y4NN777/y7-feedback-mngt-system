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
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly [];
  }): Promise<unknown>;
  incrementRowColumn(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly column: string;
    readonly value: number;
    readonly max: number;
  }): Promise<unknown>;
  decrementRowColumn(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly column: string;
    readonly value: number;
    readonly min: number;
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
        try {
          await tables.incrementRowColumn({
            databaseId: schema.databaseId,
            tableId: schema.abuseCountersTableId,
            rowId: targetId,
            column: "count",
            value: counter.amount,
            max: counter.limit - (total - current.count),
          });
        } catch (error: unknown) {
          if (object(error) && (error.code === 400 || error.code === 409)) {
            throw Object.assign(new Error("counter contention"), { code: 409 });
          }
          throw error;
        }
      } else {
        await tables.createRow({
          databaseId: schema.databaseId,
          tableId: schema.abuseCountersTableId,
          rowId: targetId,
          permissions: [],
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
    return retryAfterSeconds > 0
      ? ({ status: "limited", retryAfterSeconds } as const)
      : ({ status: "allowed", receipts } as const);
  };

  return {
    async consume(input) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          return await consumeOnce(input);
        } catch (error: unknown) {
          if (!retryable(error) || attempt === 19) throw error;
        }
      }
      /* v8 ignore next -- the bounded loop either returns or throws on its final pass. */
      throw new Error("APPWRITE_ABUSE_COUNTER_UNAVAILABLE");
    },
    async release({ receipt }) {
      await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.abuseCountersTableId,
        rowId: receipt.rowId,
      });
      await tables.decrementRowColumn({
        databaseId: schema.databaseId,
        tableId: schema.abuseCountersTableId,
        rowId: receipt.rowId,
        column: "count",
        value: receipt.amount,
        min: 0,
      });
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
      listRows: async (input) => ({
        rows: (await tables.listRows({ ...input, queries: [...input.queries] })).rows,
      }),
      getRow: (input) => tables.getRow(input),
      createRow: (input) =>
        tables.createRow({ ...input, permissions: [...input.permissions] }),
      incrementRowColumn: (input) => tables.incrementRowColumn(input),
      decrementRowColumn: (input) => tables.decrementRowColumn(input),
    },
    schema,
    nodeQueries,
  );
}
/* v8 ignore stop */
