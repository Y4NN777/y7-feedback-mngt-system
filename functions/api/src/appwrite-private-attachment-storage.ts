import { createHash } from "node:crypto";

import { Query, type Storage, type TablesDB } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

import type { PrivateAttachmentReader } from "./attachment-download.js";
import type {
  PrivateAttachmentStorage,
  StagedAttachmentObject,
} from "./attachment-saga.js";

export interface AppwritePrivateAttachmentSchema {
  readonly bucketId: string;
  readonly databaseId: string;
  readonly stagingTableId: string;
}

export interface AppwriteAttachmentFilesPort {
  createFile(input: {
    readonly bucketId: string;
    readonly fileId: string;
    readonly bytes: Uint8Array;
    readonly name: string;
    readonly permissions: readonly string[];
  }): Promise<void>;
  deleteFile(input: {
    readonly bucketId: string;
    readonly fileId: string;
  }): Promise<void>;
  downloadFile(input: {
    readonly bucketId: string;
    readonly fileId: string;
  }): Promise<Uint8Array>;
}

export interface AppwriteAttachmentStagingPort {
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
  }): Promise<void>;
  deleteRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<void>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface AppwriteAttachmentQueryPort {
  readonly equal: (attribute: string, values: readonly string[]) => string;
  readonly lessThan: (attribute: string, value: string) => string;
  readonly limit: (limit: number) => string;
}

export type AppwritePrivateAttachmentStorage = PrivateAttachmentStorage &
  PrivateAttachmentReader;

interface StagingRow extends StagedAttachmentObject {
  readonly rowId: string;
  readonly fileId: string;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const operationId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const maximumAttachmentBytes = 10 * 1024 * 1024;

const defaultQueries: AppwriteAttachmentQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  lessThan: (attribute, value) => Query.lessThan(attribute, value),
  limit: (limit) => Query.limit(limit),
};

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, maximum: number): string {
  if (typeof value !== "string") {
    throw new Error("APPWRITE_ATTACHMENT_STAGING_INVALID");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error("APPWRITE_ATTACHMENT_STAGING_INVALID");
  }
  return normalized;
}

function normalizeUtcInstant(value: string): string | undefined {
  if (!/(?:Z|[+]00:00)$/u.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function isCanonicalInstant(value: string): boolean {
  return normalizeUtcInstant(value) === value;
}

function parseStagingRow(value: unknown): StagingRow {
  if (!isObject(value)) throw new Error("APPWRITE_ATTACHMENT_STAGING_INVALID");
  const rowId = requiredString(value.$id, 36);
  const objectId = requiredString(value.objectId, 500);
  const parsedOperationId = requiredString(value.operationId, 36);
  const stagedAt = normalizeUtcInstant(requiredString(value.stagedAt, 40));
  const fileId = requiredString(value.fileId, 36);
  if (
    !appwriteId.test(rowId) ||
    !objectId.startsWith("private/") ||
    !operationId.test(parsedOperationId) ||
    stagedAt === undefined ||
    !appwriteId.test(fileId)
  ) {
    throw new Error("APPWRITE_ATTACHMENT_STAGING_INVALID");
  }
  return { rowId, objectId, operationId: parsedOperationId, stagedAt, fileId };
}

function validateSchema(schema: AppwritePrivateAttachmentSchema): void {
  if (
    !appwriteId.test(schema.bucketId) ||
    !appwriteId.test(schema.databaseId) ||
    !appwriteId.test(schema.stagingTableId) ||
    schema.databaseId === schema.stagingTableId
  ) {
    throw new Error("APPWRITE_ATTACHMENT_SCHEMA_INVALID");
  }
}

function validateObjectId(value: string): void {
  if (!value.startsWith("private/") || value.length > 500) {
    throw new Error("APPWRITE_ATTACHMENT_INPUT_INVALID");
  }
}

function derivedId(prefix: "att" | "stg", objectId: string): string {
  return `${prefix}_${createHash("sha256").update(objectId).digest("hex").slice(0, 32)}`;
}

export function createAppwritePrivateAttachmentStorage(
  files: AppwriteAttachmentFilesPort,
  tables: AppwriteAttachmentStagingPort,
  schema: AppwritePrivateAttachmentSchema,
  queries: AppwriteAttachmentQueryPort = defaultQueries,
): AppwritePrivateAttachmentStorage {
  validateSchema(schema);

  async function findExact(objectId: string): Promise<StagingRow | undefined> {
    validateObjectId(objectId);
    const result = await tables.listRows({
      databaseId: schema.databaseId,
      tableId: schema.stagingTableId,
      queries: [queries.equal("objectId", [objectId]), queries.limit(2)],
      total: false,
      ttl: 0,
    });
    if (result.rows.length === 0) return undefined;
    if (result.rows.length !== 1) {
      throw new Error("APPWRITE_ATTACHMENT_STAGING_INCONSISTENT");
    }
    const row = parseStagingRow(result.rows[0]);
    if (row.objectId !== objectId) {
      throw new Error("APPWRITE_ATTACHMENT_STAGING_INVALID");
    }
    return row;
  }

  return {
    async stage(input) {
      if (
        !input.objectId.startsWith("private/") ||
        input.objectId.length > 500 ||
        !operationId.test(input.operationId) ||
        !isCanonicalInstant(input.stagedAt) ||
        !(input.bytes instanceof Uint8Array) ||
        input.bytes.byteLength < 1 ||
        input.bytes.byteLength > maximumAttachmentBytes
      ) {
        throw new Error("APPWRITE_ATTACHMENT_INPUT_INVALID");
      }

      const fileId = derivedId("att", input.objectId);
      await files.createFile({
        bucketId: schema.bucketId,
        fileId,
        bytes: input.bytes,
        name: "staged-attachment.bin",
        permissions: [],
      });
      try {
        await tables.createRow({
          databaseId: schema.databaseId,
          tableId: schema.stagingTableId,
          rowId: derivedId("stg", input.objectId),
          data: {
            objectId: input.objectId,
            operationId: input.operationId,
            stagedAt: input.stagedAt,
            fileId,
          },
          permissions: [],
        });
      } catch (error) {
        try {
          await files.deleteFile({ bucketId: schema.bucketId, fileId });
        } catch {
          // The originating persistence error remains the actionable failure.
        }
        throw error;
      }
    },

    async read(objectId) {
      const row = await findExact(objectId);
      if (!row) throw new Error("APPWRITE_ATTACHMENT_STAGING_NOT_FOUND");
      return files.downloadFile({ bucketId: schema.bucketId, fileId: row.fileId });
    },

    async remove(objectId) {
      const row = await findExact(objectId);
      if (!row) return;
      await files.deleteFile({ bucketId: schema.bucketId, fileId: row.fileId });
      await tables.deleteRow({
        databaseId: schema.databaseId,
        tableId: schema.stagingTableId,
        rowId: row.rowId,
      });
    },

    async listStagedBefore(before) {
      if (!isCanonicalInstant(before)) {
        throw new Error("APPWRITE_ATTACHMENT_INPUT_INVALID");
      }
      const result = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.stagingTableId,
        queries: [queries.lessThan("stagedAt", before), queries.limit(5_000)],
        total: false,
        ttl: 0,
      });
      return result.rows.map((value) => {
        const row = parseStagingRow(value);
        return {
          objectId: row.objectId,
          operationId: row.operationId,
          stagedAt: row.stagedAt,
        };
      });
    },
  };
}

export function createNodeAppwritePrivateAttachmentStorage(
  storage: Storage,
  tables: TablesDB,
  schema: AppwritePrivateAttachmentSchema,
): AppwritePrivateAttachmentStorage {
  return createAppwritePrivateAttachmentStorage(
    {
      createFile: async (input) => {
        await storage.createFile({
          bucketId: input.bucketId,
          fileId: input.fileId,
          file: InputFile.fromBuffer(input.bytes, input.name),
          permissions: [...input.permissions],
        });
      },
      deleteFile: async (input) => {
        await storage.deleteFile(input);
      },
      downloadFile: async (input) =>
        new Uint8Array(await storage.getFileDownload(input)),
    },
    {
      createRow: async (input) => {
        await tables.createRow({ ...input, permissions: [...input.permissions] });
      },
      deleteRow: async (input) => {
        await tables.deleteRow(input);
      },
      listRows: async (input) => {
        const result = await tables.listRows({
          ...input,
          queries: [...input.queries],
        });
        return { rows: result.rows };
      },
    },
    schema,
  );
}
