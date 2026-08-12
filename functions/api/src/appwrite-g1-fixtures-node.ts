import type { G1FixtureStore } from "./appwrite-g1-fixtures.js";

interface TablesFixtureClient {
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
  createTransaction(input: { readonly ttl: number }): Promise<unknown>;
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: string[];
    readonly transactionId: string;
  }): Promise<unknown>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsent(error: unknown): boolean {
  return isRecord(error) && error.code === 404;
}

function fixtureData(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error("APPWRITE_G1_FIXTURE_INVALID");
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !key.startsWith("$")),
  );
}

function transactionId(value: unknown): string {
  if (!isRecord(value) || typeof value.$id !== "string" || !value.$id.trim()) {
    throw new Error("APPWRITE_G1_TRANSACTION_INVALID");
  }
  return value.$id;
}

export function createNodeAppwriteG1FixtureStore(
  tables: TablesFixtureClient,
  databaseId: string,
): G1FixtureStore {
  return {
    async getRow(tableId, rowId) {
      try {
        return fixtureData(await tables.getRow({ databaseId, tableId, rowId }));
      } catch (error: unknown) {
        if (isAbsent(error)) return null;
        throw error;
      }
    },
    async createTransaction() {
      return transactionId(await tables.createTransaction({ ttl: 60 }));
    },
    async createRow(input) {
      await tables.createRow({
        databaseId,
        ...input,
        permissions: [...input.permissions],
      });
    },
    async commitTransaction(id) {
      await tables.updateTransaction({ transactionId: id, commit: true });
    },
    async rollbackTransaction(id) {
      await tables.updateTransaction({ transactionId: id, rollback: true });
    },
  };
}
