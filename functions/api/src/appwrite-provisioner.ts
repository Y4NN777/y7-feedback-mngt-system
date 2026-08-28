import type {
  AppwriteColumn,
  AppwriteIndex,
  AppwriteInfrastructureManifest,
} from "./appwrite-schema.js";

export interface ExistingAppwriteDatabase {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

export interface ExistingAppwriteTable {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly rowSecurity: boolean;
  readonly enabled: boolean;
  readonly columns: readonly AppwriteColumn[];
  readonly indexes: readonly AppwriteIndex[];
}

export interface ExistingAppwriteBucket {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly fileSecurity: boolean;
  readonly enabled: boolean;
  readonly maximumFileSize: number;
  readonly allowedFileExtensions: readonly string[];
  readonly compression: string;
  readonly encryption: boolean;
  readonly antivirus: boolean;
  readonly transformations: boolean;
}

export interface AppwriteProvisioningPort {
  getDatabase(databaseId: string): Promise<ExistingAppwriteDatabase | null>;
  createDatabase(definition: ExistingAppwriteDatabase): Promise<void>;
  getTable(databaseId: string, tableId: string): Promise<ExistingAppwriteTable | null>;
  createTable(databaseId: string, definition: ExistingAppwriteTable): Promise<void>;
  createColumn(
    databaseId: string,
    tableId: string,
    definition: AppwriteColumn,
  ): Promise<void>;
  createIndex(
    databaseId: string,
    tableId: string,
    definition: AppwriteIndex,
  ): Promise<void>;
  getBucket(bucketId: string): Promise<ExistingAppwriteBucket | null>;
  createBucket(definition: ExistingAppwriteBucket): Promise<void>;
}

export interface AppwriteProvisioningResult {
  readonly created: number;
  readonly verified: number;
}

const operationalCode = /^[A-Z][A-Z0-9_]*(?::[A-Za-z0-9][A-Za-z0-9._-]{0,35}){0,2}$/u;

export function safeAppwriteProvisioningErrorCode(error: unknown): string {
  return error instanceof Error && operationalCode.test(error.message)
    ? error.message
    : "APPWRITE_PROVISION_FAILED";
}

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

function assertConforming(
  kind: "database" | "table" | "bucket",
  id: string,
  actual: unknown,
  expected: unknown,
): void {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`APPWRITE_INFRASTRUCTURE_DRIFT:${kind}:${id}`);
  }
}

function additiveTableChanges(
  actual: ExistingAppwriteTable,
  expected: ExistingAppwriteTable,
): {
  readonly columns: readonly AppwriteColumn[];
  readonly indexes: readonly AppwriteIndex[];
} {
  const actualBase = {
    ...actual,
    columns: expected.columns,
    indexes: expected.indexes,
  };
  if (canonical(actualBase) !== canonical(expected)) {
    throw new Error(`APPWRITE_INFRASTRUCTURE_DRIFT:table:${expected.id}`);
  }
  const target = new Map(expected.columns.map((column) => [column.key, column]));
  for (const column of actual.columns) {
    const definition = target.get(column.key);
    if (definition === undefined || canonical(column) !== canonical(definition)) {
      throw new Error(`APPWRITE_INFRASTRUCTURE_DRIFT:table:${expected.id}`);
    }
  }
  const presentColumns = new Set(actual.columns.map((column) => column.key));
  const missingColumns = expected.columns.filter(
    (column) => !presentColumns.has(column.key),
  );
  if (missingColumns.some((column) => column.required)) {
    throw new Error(`APPWRITE_INFRASTRUCTURE_DRIFT:table:${expected.id}`);
  }
  const targetIndexes = new Map(expected.indexes.map((index) => [index.key, index]));
  for (const index of actual.indexes) {
    const definition = targetIndexes.get(index.key);
    if (definition === undefined || canonical(index) !== canonical(definition)) {
      throw new Error(`APPWRITE_INFRASTRUCTURE_DRIFT:table:${expected.id}`);
    }
  }
  const presentIndexes = new Set(actual.indexes.map((index) => index.key));
  return {
    columns: missingColumns,
    indexes: expected.indexes.filter((index) => !presentIndexes.has(index.key)),
  };
}

export async function provisionAppwriteInfrastructure(
  port: AppwriteProvisioningPort,
  manifest: AppwriteInfrastructureManifest,
): Promise<AppwriteProvisioningResult> {
  const database = await port.getDatabase(manifest.database.id);
  const tables = await Promise.all(
    manifest.tables.map(async (definition) => ({
      definition,
      existing: await port.getTable(manifest.database.id, definition.id),
    })),
  );
  const pendingColumns = new Map<string, readonly AppwriteColumn[]>();
  const pendingIndexes = new Map<string, readonly AppwriteIndex[]>();
  const bucket = await port.getBucket(manifest.attachmentBucket.id);

  if (database) {
    assertConforming("database", manifest.database.id, database, manifest.database);
  }
  for (const candidate of tables) {
    if (candidate.existing) {
      const changes = additiveTableChanges(candidate.existing, candidate.definition);
      pendingColumns.set(candidate.definition.id, changes.columns);
      pendingIndexes.set(candidate.definition.id, changes.indexes);
    }
  }
  if (bucket) {
    assertConforming(
      "bucket",
      manifest.attachmentBucket.id,
      bucket,
      manifest.attachmentBucket,
    );
  }

  let created = 0;
  if (!database) {
    await port.createDatabase(manifest.database);
    created += 1;
  }
  for (const candidate of tables) {
    if (!candidate.existing) {
      await port.createTable(manifest.database.id, candidate.definition);
      created += 1;
    }
  }
  for (const [tableId, columns] of pendingColumns) {
    for (const column of columns) {
      await port.createColumn(manifest.database.id, tableId, column);
      created += 1;
    }
  }
  for (const [tableId, indexes] of pendingIndexes) {
    for (const index of indexes) {
      await port.createIndex(manifest.database.id, tableId, index);
      created += 1;
    }
  }
  if (!bucket) {
    await port.createBucket(manifest.attachmentBucket);
    created += 1;
  }

  return {
    created,
    verified:
      manifest.tables.length +
      2 -
      tables.filter(({ existing }) => !existing).length -
      (database ? 0 : 1) -
      (bucket ? 0 : 1),
  };
}
