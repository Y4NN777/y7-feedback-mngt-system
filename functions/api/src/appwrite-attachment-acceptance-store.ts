import { Query, type TablesDB } from "node-appwrite";

import {
  createAttachmentRecord,
  type AttachmentLifecycle,
  type AttachmentRecord,
  type AttachmentSourceEntry,
} from "@y7-feedback/domain";

import type { AttachmentMetadataReader } from "./attachment-download.js";
import type { AttachmentAcceptanceStore } from "./attachment-saga.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwriteAttachmentAcceptanceSchema {
  readonly databaseId: string;
  readonly stagingTableId: string;
  readonly attachmentsTableId: string;
}

export interface AppwriteAttachmentAcceptanceTablesPort {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
    readonly transactionId: string;
  }): Promise<unknown>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface AppwriteAttachmentAcceptanceQueryPort {
  readonly equal: (attribute: string, values: readonly string[]) => string;
  readonly limit: (limit: number) => string;
}

export type AppwriteAttachmentAcceptanceStore = AttachmentAcceptanceStore &
  AttachmentMetadataReader;

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const defaultQueries: AppwriteAttachmentAcceptanceQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (limit) => Query.limit(limit),
};

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, maximum: number): string {
  if (typeof value !== "string") {
    throw new Error("APPWRITE_ATTACHMENT_METADATA_INVALID");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error("APPWRITE_ATTACHMENT_METADATA_INVALID");
  }
  return normalized;
}

function utcInstant(value: unknown): string {
  const candidate = requiredString(value, 40);
  if (!/(?:Z|[+]00:00)$/u.test(candidate)) {
    throw new Error("APPWRITE_ATTACHMENT_METADATA_INVALID");
  }
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("APPWRITE_ATTACHMENT_METADATA_INVALID");
  }
  return parsed.toISOString();
}

function sourceEntry(value: Readonly<Record<string, unknown>>): AttachmentSourceEntry {
  const kind = value.sourceKind;
  const id = requiredString(value.sourceEntryId, 200);
  if (
    kind !== "source_submission" &&
    kind !== "visible_message" &&
    kind !== "internal_note"
  ) {
    throw new Error("APPWRITE_ATTACHMENT_METADATA_INVALID");
  }
  return { kind, id };
}

function lifecycle(value: unknown): AttachmentLifecycle {
  if (value !== "available" && value !== "soft_deleted" && value !== "purged") {
    throw new Error("APPWRITE_ATTACHMENT_METADATA_INVALID");
  }
  return value;
}

export function parseAttachmentMetadata(
  value: unknown,
  schema: AppwriteAttachmentAcceptanceSchema,
  sensitive: AppwriteSensitivePersistence,
): AttachmentRecord {
  if (!isObject(value)) throw new Error("APPWRITE_ATTACHMENT_METADATA_INVALID");
  try {
    const parsedLifecycle = lifecycle(value.lifecycle);
    const id = requiredString(value.$id, 36);
    const record = createAttachmentRecord({
      id,
      objectId: requiredString(value.objectId, 500),
      feedbackId: requiredString(value.feedbackId, 200),
      workspaceId: requiredString(value.workspaceId, 200),
      projectId: requiredString(value.projectId, 200),
      audience:
        value.audience === "reporter" || value.audience === "workspace"
          ? value.audience
          : (() => {
              throw new Error("APPWRITE_ATTACHMENT_METADATA_INVALID");
            })(),
      sourceEntry: sourceEntry(value),
      displayName: sensitive.protector.open(
        {
          environment: sensitive.environment,
          tableId: schema.attachmentsTableId,
          rowId: id,
          field: "displayName",
        },
        requiredString(value.displayName, 1_000),
      ),
      mediaType: requiredString(value.mediaType, 100),
      size:
        typeof value.size === "number" && Number.isInteger(value.size)
          ? value.size
          : (() => {
              throw new Error("APPWRITE_ATTACHMENT_METADATA_INVALID");
            })(),
      sha256: requiredString(value.sha256, 200),
      createdAt: utcInstant(value.createdAt),
    });
    requiredString(value.operationId, 36);
    return parsedLifecycle === "available"
      ? record
      : { ...record, lifecycle: parsedLifecycle };
  } catch {
    throw new Error("APPWRITE_ATTACHMENT_METADATA_INVALID");
  }
}

function validateSchema(schema: AppwriteAttachmentAcceptanceSchema): void {
  const ids = [schema.stagingTableId, schema.attachmentsTableId];
  if (
    !appwriteId.test(schema.databaseId) ||
    ids.some((id) => !appwriteId.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("APPWRITE_ATTACHMENT_SCHEMA_INVALID");
  }
}

function validLookupId(value: string, maximum: number): boolean {
  return value.trim().length > 0 && value.length <= maximum;
}

function validateCommit(input: {
  readonly operationId: string;
  readonly feedbackId: string;
  readonly attachments: readonly AttachmentRecord[];
}): void {
  const attachmentIds = new Set(input.attachments.map((item) => item.id));
  const objectIds = new Set(input.attachments.map((item) => item.objectId));
  if (
    !operationIdPattern.test(input.operationId) ||
    !validLookupId(input.feedbackId, 200) ||
    input.attachments.length < 1 ||
    input.attachments.length > 5 ||
    attachmentIds.size !== input.attachments.length ||
    objectIds.size !== input.attachments.length ||
    input.attachments.some(
      (item) =>
        item.feedbackId !== input.feedbackId ||
        !appwriteId.test(item.id) ||
        !item.objectId.startsWith("private/"),
    )
  ) {
    throw new Error("APPWRITE_ATTACHMENT_INPUT_INVALID");
  }
}

function metadataData(
  record: AttachmentRecord,
  operationId: string,
  schema: AppwriteAttachmentAcceptanceSchema,
  sensitive: AppwriteSensitivePersistence,
): Readonly<Record<string, unknown>> {
  return {
    objectId: record.objectId,
    feedbackId: record.feedbackId,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    audience: record.audience,
    sourceKind: record.sourceEntry.kind,
    sourceEntryId: record.sourceEntry.id,
    displayName: sensitive.protector.seal(
      {
        environment: sensitive.environment,
        tableId: schema.attachmentsTableId,
        rowId: record.id,
        field: "displayName",
      },
      record.displayName,
    ),
    mediaType: record.mediaType,
    size: record.size,
    sha256: record.sha256,
    createdAt: record.createdAt,
    lifecycle: record.lifecycle,
    operationId,
  };
}

export function createAppwriteAttachmentAcceptanceStore(
  tables: AppwriteAttachmentAcceptanceTablesPort,
  schema: AppwriteAttachmentAcceptanceSchema,
  queries: AppwriteAttachmentAcceptanceQueryPort,
  sensitive: AppwriteSensitivePersistence,
): AppwriteAttachmentAcceptanceStore {
  validateSchema(schema);

  async function listExact(
    attribute: "$id" | "objectId",
    value: string,
  ): Promise<AttachmentRecord | undefined> {
    if (!validLookupId(value, attribute === "$id" ? 200 : 500)) {
      throw new Error("APPWRITE_ATTACHMENT_INPUT_INVALID");
    }
    const result = await tables.listRows({
      databaseId: schema.databaseId,
      tableId: schema.attachmentsTableId,
      queries: [queries.equal(attribute, [value]), queries.limit(2)],
      total: false,
      ttl: 0,
    });
    if (result.rows.length === 0) return undefined;
    if (result.rows.length !== 1) {
      throw new Error("APPWRITE_ATTACHMENT_METADATA_INCONSISTENT");
    }
    const record = parseAttachmentMetadata(result.rows[0], schema, sensitive);
    if (
      (attribute === "$id" && record.id !== value) ||
      (attribute === "objectId" && record.objectId !== value)
    ) {
      throw new Error("APPWRITE_ATTACHMENT_METADATA_INVALID");
    }
    return record;
  }

  return {
    async commit(input) {
      validateCommit(input);
      for (const attachment of input.attachments) {
        const staged = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.stagingTableId,
          queries: [
            queries.equal("objectId", [attachment.objectId]),
            queries.equal("operationId", [input.operationId]),
            queries.limit(2),
          ],
          total: false,
          ttl: 0,
        });
        if (staged.rows.length !== 1 || !isObject(staged.rows[0])) {
          throw new Error("APPWRITE_ATTACHMENT_STAGING_INCONSISTENT");
        }
        const row = staged.rows[0];
        if (
          row.objectId !== attachment.objectId ||
          row.operationId !== input.operationId
        ) {
          throw new Error("APPWRITE_ATTACHMENT_STAGING_INCONSISTENT");
        }
      }

      const transaction = await tables.createTransaction({ ttl: 60 });
      if (!appwriteId.test(transaction.$id)) {
        throw new Error("APPWRITE_ATTACHMENT_TRANSACTION_INVALID");
      }
      let rowsStaged = false;
      try {
        for (const attachment of input.attachments) {
          await tables.createRow({
            databaseId: schema.databaseId,
            tableId: schema.attachmentsTableId,
            rowId: attachment.id,
            data: metadataData(attachment, input.operationId, schema, sensitive),
            permissions: [],
            transactionId: transaction.$id,
          });
        }
        rowsStaged = true;
        await tables.updateTransaction({
          transactionId: transaction.$id,
          commit: true,
        });
      } catch (error) {
        if (!rowsStaged) {
          try {
            await tables.updateTransaction({
              transactionId: transaction.$id,
              rollback: true,
            });
          } catch {
            // The originating transaction error remains authoritative.
          }
        }
        throw error;
      }
    },

    findById(attachmentId) {
      return listExact("$id", attachmentId);
    },

    async isObjectAssociated(objectId) {
      return (await listExact("objectId", objectId)) !== undefined;
    },
  };
}

export function createNodeAppwriteAttachmentAcceptanceStore(
  tables: TablesDB,
  schema: AppwriteAttachmentAcceptanceSchema,
  sensitive: AppwriteSensitivePersistence,
): AppwriteAttachmentAcceptanceStore {
  return createAppwriteAttachmentAcceptanceStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      updateTransaction: (input) => tables.updateTransaction(input),
      createRow: (input) =>
        tables.createRow({ ...input, permissions: [...input.permissions] }),
      listRows: async (input) => {
        const result = await tables.listRows({
          ...input,
          queries: [...input.queries],
        });
        return { rows: result.rows };
      },
    },
    schema,
    defaultQueries,
    sensitive,
  );
}
