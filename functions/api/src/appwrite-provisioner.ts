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
  const bucket = await port.getBucket(manifest.attachmentBucket.id);

  if (database) {
    assertConforming("database", manifest.database.id, database, manifest.database);
  }
  for (const candidate of tables) {
    if (candidate.existing) {
      assertConforming(
        "table",
        candidate.definition.id,
        candidate.existing,
        candidate.definition,
      );
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
  if (!bucket) {
    await port.createBucket(manifest.attachmentBucket);
    created += 1;
  }

  return { created, verified: manifest.tables.length + 2 - created };
}
