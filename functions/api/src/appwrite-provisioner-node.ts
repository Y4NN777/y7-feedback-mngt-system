import { Compression } from "node-appwrite";

import type {
  AppwriteProvisioningPort,
  ExistingAppwriteBucket,
  ExistingAppwriteDatabase,
  ExistingAppwriteTable,
} from "./appwrite-provisioner.js";
import type { AppwriteColumn, AppwriteIndex } from "./appwrite-schema.js";

interface TablesAdminClient {
  get(input: { readonly databaseId: string }): Promise<unknown>;
  create(input: {
    readonly databaseId: string;
    readonly name: string;
    readonly enabled: boolean;
  }): Promise<unknown>;
  getTable(input: {
    readonly databaseId: string;
    readonly tableId: string;
  }): Promise<unknown>;
  createTable(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly name: string;
    readonly permissions: string[];
    readonly rowSecurity: boolean;
    readonly enabled: boolean;
    readonly columns: object[];
    readonly indexes: object[];
  }): Promise<unknown>;
}

interface StorageAdminClient {
  getBucket(input: { readonly bucketId: string }): Promise<unknown>;
  createBucket(input: {
    readonly bucketId: string;
    readonly name: string;
    readonly permissions: string[];
    readonly fileSecurity: boolean;
    readonly enabled: boolean;
    readonly maximumFileSize: number;
    readonly allowedFileExtensions: string[];
    readonly compression: Compression;
    readonly encryption: boolean;
    readonly antivirus: boolean;
    readonly transformations: boolean;
  }): Promise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return isRecord(error) && error.code === 404;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
  }
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
  }
  return value;
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
  }
  return value as readonly string[];
}

function column(value: unknown): AppwriteColumn {
  if (!isRecord(value)) throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
  const key = string(value.key);
  const type = string(value.type);
  const required = boolean(value.required);
  if (type === "boolean" || type === "integer" || type === "datetime") {
    return { key, type, required };
  }
  if (type === "varchar") {
    const encrypt = value.encrypt === true;
    return {
      key,
      type,
      size: number(value.size),
      required,
      ...(encrypt ? { encrypt } : {}),
    };
  }
  if (type === "text") {
    const encrypt = value.encrypt === true;
    return { key, type, required, ...(encrypt ? { encrypt } : {}) };
  }
  throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
}

function index(value: unknown): AppwriteIndex {
  if (!isRecord(value)) throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
  const type = string(value.type);
  if (type !== "key" && type !== "unique") {
    throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
  }
  return { key: string(value.key), type, columns: strings(value.columns) };
}

function database(value: unknown): ExistingAppwriteDatabase {
  if (!isRecord(value)) throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
  return {
    id: string(value.$id),
    name: string(value.name),
    enabled: boolean(value.enabled),
  };
}

function table(value: unknown): ExistingAppwriteTable {
  if (
    !isRecord(value) ||
    !Array.isArray(value.columns) ||
    !Array.isArray(value.indexes)
  ) {
    throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
  }
  return {
    id: string(value.$id),
    name: string(value.name),
    permissions: strings(value.$permissions),
    rowSecurity: boolean(value.rowSecurity),
    enabled: boolean(value.enabled),
    columns: value.columns.map(column),
    indexes: value.indexes.map(index),
  };
}

function bucket(value: unknown): ExistingAppwriteBucket {
  if (!isRecord(value)) throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
  return {
    id: string(value.$id),
    name: string(value.name),
    permissions: strings(value.$permissions),
    fileSecurity: boolean(value.fileSecurity),
    enabled: boolean(value.enabled),
    maximumFileSize: number(value.maximumFileSize),
    allowedFileExtensions: strings(value.allowedFileExtensions),
    compression: string(value.compression),
    encryption: boolean(value.encryption),
    antivirus: boolean(value.antivirus),
    transformations: boolean(value.transformations),
  };
}

async function optional<T>(request: Promise<unknown>, parse: (value: unknown) => T) {
  try {
    return parse(await request);
  } catch (error: unknown) {
    if (absent(error)) return null;
    throw error;
  }
}

export function createNodeAppwriteProvisioningPort(
  tables: TablesAdminClient,
  storage: StorageAdminClient,
): AppwriteProvisioningPort {
  return {
    getDatabase: (databaseId) => optional(tables.get({ databaseId }), database),
    async createDatabase(definition) {
      await tables.create({
        databaseId: definition.id,
        name: definition.name,
        enabled: definition.enabled,
      });
    },
    getTable: (databaseId, tableId) =>
      optional(tables.getTable({ databaseId, tableId }), table),
    async createTable(databaseId, definition) {
      await tables.createTable({
        databaseId,
        tableId: definition.id,
        name: definition.name,
        permissions: [...definition.permissions],
        rowSecurity: definition.rowSecurity,
        enabled: definition.enabled,
        columns: definition.columns.map((item) => ({ ...item })),
        indexes: definition.indexes.map((item) => ({
          key: item.key,
          type: item.type,
          attributes: [...item.columns],
        })),
      });
    },
    getBucket: (bucketId) => optional(storage.getBucket({ bucketId }), bucket),
    async createBucket(definition) {
      if (definition.compression !== "none") {
        throw new Error("APPWRITE_INFRASTRUCTURE_INVALID");
      }
      await storage.createBucket({
        bucketId: definition.id,
        name: definition.name,
        permissions: [...definition.permissions],
        fileSecurity: definition.fileSecurity,
        enabled: definition.enabled,
        maximumFileSize: definition.maximumFileSize,
        allowedFileExtensions: [...definition.allowedFileExtensions],
        compression: Compression.None,
        encryption: definition.encryption,
        antivirus: definition.antivirus,
        transformations: definition.transformations,
      });
    },
  };
}
