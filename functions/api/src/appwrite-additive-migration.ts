import type { AppwriteTableDefinition } from "./appwrite-schema.js";

export interface AdditiveTableMigration {
  readonly version: string;
  readonly createTables: readonly AppwriteTableDefinition[];
  readonly rollbackTableIds: readonly string[];
}

export interface AdditiveTableMigrationInput {
  readonly version: string;
  readonly currentTables: readonly AppwriteTableDefinition[];
  readonly targetTables: readonly AppwriteTableDefinition[];
  readonly additiveTableIds: readonly string[];
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const migrationVersion = /^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function indexed(
  tables: readonly AppwriteTableDefinition[],
): ReadonlyMap<string, AppwriteTableDefinition> {
  const result = new Map<string, AppwriteTableDefinition>();
  for (const table of tables) {
    if (!appwriteId.test(table.id) || result.has(table.id)) {
      throw new Error("APPWRITE_ADDITIVE_MIGRATION_INVALID");
    }
    result.set(table.id, table);
  }
  return result;
}

export function planAdditiveTableMigration(
  input: AdditiveTableMigrationInput,
): AdditiveTableMigration {
  if (!migrationVersion.test(input.version)) {
    throw new Error("APPWRITE_ADDITIVE_MIGRATION_INVALID");
  }
  const current = indexed(input.currentTables);
  const target = indexed(input.targetTables);
  const additive = new Set<string>();
  for (const tableId of input.additiveTableIds) {
    if (!appwriteId.test(tableId) || additive.has(tableId) || !target.has(tableId)) {
      throw new Error("APPWRITE_ADDITIVE_MIGRATION_INVALID");
    }
    additive.add(tableId);
  }

  for (const [tableId, definition] of current) {
    const expected = target.get(tableId);
    if (!expected) {
      throw new Error("APPWRITE_ADDITIVE_MIGRATION_DESTRUCTIVE");
    }
    if (canonical(definition) !== canonical(expected)) {
      throw new Error("APPWRITE_ADDITIVE_MIGRATION_DRIFT");
    }
  }

  const createTables = input.targetTables.filter(({ id }) => !current.has(id));
  if (createTables.some(({ id }) => !additive.has(id))) {
    throw new Error("APPWRITE_ADDITIVE_MIGRATION_UNDECLARED");
  }

  return {
    version: input.version,
    createTables,
    rollbackTableIds: createTables.map(({ id }) => id).reverse(),
  };
}

export function assertAdditiveRollbackSafe(
  migration: AdditiveTableMigration,
  rowCounts: Readonly<Record<string, number>>,
): void {
  const expected = new Set(migration.rollbackTableIds);
  const entries = Object.entries(rowCounts);
  if (entries.some(([tableId]) => !expected.has(tableId))) {
    throw new Error("APPWRITE_ADDITIVE_ROLLBACK_UNEXPECTED");
  }
  if (entries.length !== expected.size) {
    throw new Error("APPWRITE_ADDITIVE_ROLLBACK_UNVERIFIED");
  }
  for (const [, rowCount] of entries) {
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
      throw new Error("APPWRITE_ADDITIVE_ROLLBACK_UNVERIFIED");
    }
    if (rowCount !== 0) {
      throw new Error("APPWRITE_ADDITIVE_ROLLBACK_NON_EMPTY");
    }
  }
}
