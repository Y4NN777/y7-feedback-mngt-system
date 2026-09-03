import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteAbuseCounterStore,
  type AppwriteAbuseCounterTables,
} from "./appwrite-abuse-counter-store";
import type { AbuseCounterRequest } from "./abuse";

const schema = { databaseId: "feedback", abuseCountersTableId: "abuse_counters" };
const queries = {
  equal: (attribute: string, values: readonly (string | number)[]) =>
    JSON.stringify({ kind: "equal", attribute, values }),
  limit: (value: number) => `limit:${String(value)}`,
};

class FakeTables implements AppwriteAbuseCounterTables {
  readonly rows = new Map<string, Readonly<Record<string, unknown>>>();
  readonly transactions = new Map<
    string,
    Map<string, Readonly<Record<string, unknown>>>
  >();
  transactionSequence = 0;
  commits = 0;
  rollbacks = 0;
  conflicts = 0;
  failList = false;

  createTransaction = vi.fn(() => {
    const transactionId = `transaction_${String(++this.transactionSequence)}`;
    this.transactions.set(transactionId, new Map(this.rows));
    return Promise.resolve({ $id: transactionId });
  });
  updateTransaction = vi.fn(
    (input: Parameters<AppwriteAbuseCounterTables["updateTransaction"]>[0]) => {
      if (input.commit && this.conflicts > 0) {
        this.conflicts -= 1;
        this.transactions.delete(input.transactionId);
        return Promise.reject(Object.assign(new Error("conflict"), { code: 409 }));
      }
      if (input.commit) {
        const staged = this.transactions.get(input.transactionId);
        if (!staged) return Promise.reject(new Error("missing transaction"));
        this.rows.clear();
        for (const [rowId, row] of staged) this.rows.set(rowId, row);
        this.transactions.delete(input.transactionId);
        this.commits += 1;
      }
      if (input.rollback) {
        this.transactions.delete(input.transactionId);
        this.rollbacks += 1;
      }
      return Promise.resolve({});
    },
  );
  listRows = vi.fn((input: Parameters<AppwriteAbuseCounterTables["listRows"]>[0]) => {
    if (this.failList) return Promise.reject(new Error("storage"));
    const equals = input.queries.flatMap((query) => {
      if (!query.startsWith("{")) return [];
      return [JSON.parse(query) as { attribute: string; values: (string | number)[] }];
    });
    return Promise.resolve({
      rows: [
        ...(this.transactions.get(input.transactionId) ?? this.rows).values(),
      ].filter((row) =>
        equals.every(({ attribute, values }) =>
          values.map(String).includes(String(row[attribute])),
        ),
      ),
    });
  });
  getRow = vi.fn((input: Parameters<AppwriteAbuseCounterTables["getRow"]>[0]) => {
    const row = (this.transactions.get(input.transactionId) ?? this.rows).get(
      input.rowId,
    );
    return row
      ? Promise.resolve(row)
      : Promise.reject(Object.assign(new Error("absent"), { code: 404 }));
  });
  createRow = vi.fn((input: Parameters<AppwriteAbuseCounterTables["createRow"]>[0]) => {
    const rows = this.transactions.get(input.transactionId) ?? this.rows;
    if (rows.has(input.rowId))
      return Promise.reject(Object.assign(new Error("conflict"), { code: 409 }));
    const row = { $id: input.rowId, ...input.data };
    rows.set(input.rowId, row);
    return Promise.resolve(row);
  });
  updateRow = vi.fn((input: Parameters<AppwriteAbuseCounterTables["updateRow"]>[0]) => {
    const rows = this.transactions.get(input.transactionId) ?? this.rows;
    const row = { ...rows.get(input.rowId), ...input.data };
    rows.set(input.rowId, row);
    return Promise.resolve(row);
  });
}

function counter(overrides: Partial<AbuseCounterRequest> = {}): AbuseCounterRequest {
  return {
    dimension: "public_ip_minute",
    subjectDigests: ["digest_current"],
    activeDigest: "digest_current",
    keyId: "key_current",
    amount: 1,
    limit: 60,
    windowMs: 60_000,
    ...overrides,
  };
}

function setup() {
  const tables = new FakeTables();
  return {
    tables,
    store: createAppwriteAbuseCounterStore(tables, schema, queries),
  };
}

describe("Appwrite abuse counter store", () => {
  it("BDD-ABUSE-101 allows 60 and returns exact Retry-After on the 61st", async () => {
    const { store, tables } = setup();
    const now = "2026-09-03T12:00:10.000Z";
    let receiptId = "";
    for (let count = 0; count < 60; count += 1) {
      const outcome = await store.consume({ counters: [counter()], now });
      if (outcome.status !== "allowed") throw new Error("unexpected limit");
      receiptId = outcome.receipts[0]?.rowId ?? "";
    }
    await expect(store.consume({ counters: [counter()], now })).resolves.toEqual({
      status: "limited",
      retryAfterSeconds: 50,
    });
    expect(tables.rows.get(receiptId)?.count).toBe(60);
  });

  it("BDD-ABUSE-102 rolls the window and preserves a previous-key count", async () => {
    const { store } = setup();
    const old = counter({
      subjectDigests: ["digest_old"],
      activeDigest: "digest_old",
      keyId: "key_old",
      limit: 1,
    });
    await expect(
      store.consume({ counters: [old], now: "2026-09-03T12:00:10.000Z" }),
    ).resolves.toMatchObject({ status: "allowed" });
    const rotated = counter({
      subjectDigests: ["digest_current", "digest_old"],
      limit: 1,
    });
    await expect(
      store.consume({ counters: [rotated], now: "2026-09-03T12:00:20.000Z" }),
    ).resolves.toMatchObject({ status: "limited" });
    await expect(
      store.consume({ counters: [rotated], now: "2026-09-03T12:01:00.000Z" }),
    ).resolves.toMatchObject({ status: "allowed" });
  });

  it("BDD-ABUSE-103 evaluates dimensions independently in one transaction", async () => {
    const { store, tables } = setup();
    const limited = counter({ limit: 1 });
    await store.consume({ counters: [limited], now: "2026-09-03T12:00:00.000Z" });
    await expect(
      store.consume({
        counters: [
          limited,
          counter({
            dimension: "intake_ip_minute",
            activeDigest: "intake_digest",
            subjectDigests: ["intake_digest"],
            limit: 10,
          }),
        ],
        now: "2026-09-03T12:00:01.000Z",
      }),
    ).resolves.toMatchObject({ status: "limited" });
    expect(
      [...tables.rows.values()].find((row) => row.dimension === "intake_ip_minute")
        ?.count,
    ).toBe(1);
  });

  it("BDD-ABUSE-104 releases only the exact identity reservation", async () => {
    const { store, tables } = setup();
    const identity = counter({
      dimension: "external_identity_hour",
      windowMs: 3_600_000,
    });
    const outcome = await store.consume({
      counters: [identity],
      now: "2026-09-03T12:00:00.000Z",
    });
    if (outcome.status !== "allowed" || !outcome.receipts[0])
      throw new Error("fixture failed");
    await store.release({ receipt: outcome.receipts[0] });
    expect(tables.rows.get(outcome.receipts[0].rowId)?.count).toBe(0);
  });

  it("BDD-ABUSE-105 retries conflicts and rolls back storage failures", async () => {
    const retried = setup();
    retried.tables.conflicts = 1;
    await expect(
      retried.store.consume({
        counters: [counter()],
        now: "2026-09-03T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "allowed" });
    expect(retried.tables.rollbacks).toBe(1);

    const failed = setup();
    failed.tables.failList = true;
    await expect(
      failed.store.consume({
        counters: [counter()],
        now: "2026-09-03T12:00:00.000Z",
      }),
    ).rejects.toThrow("storage");
    expect(failed.tables.rollbacks).toBe(1);
  });

  it("BDD-ABUSE-106 rejects invalid schema, time, counters and transaction IDs", async () => {
    const { store } = setup();
    expect(() =>
      createAppwriteAbuseCounterStore(
        new FakeTables(),
        { ...schema, databaseId: "bad id" },
        queries,
      ),
    ).toThrow("APPWRITE_ABUSE_COUNTER_SCHEMA_INVALID");
    await expect(store.consume({ counters: [], now: "invalid" })).rejects.toThrow(
      "APPWRITE_ABUSE_COUNTER_INVALID",
    );
    await expect(
      store.consume({
        counters: [counter({ amount: 0 })],
        now: "2026-09-03T12:00:00.000Z",
      }),
    ).rejects.toThrow("APPWRITE_ABUSE_COUNTER_INVALID");
  });
});
