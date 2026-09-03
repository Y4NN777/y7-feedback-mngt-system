import { Query } from "node-appwrite";

import type {
  RecoverySource,
  RecoverySourceFile,
  RecoverySourceInventory,
  RecoverySourceRowIdentity,
  RecoverySourceTable,
} from "./recovery-source.js";

interface AppwriteList<T> {
  readonly rows?: readonly T[];
  readonly tables?: readonly T[];
  readonly files?: readonly T[];
}

interface AppwriteTablesPort {
  listTables(input: {
    readonly databaseId: string;
    readonly queries: string[];
    readonly total: false;
  }): Promise<AppwriteList<Readonly<Record<string, unknown>>>>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: string[];
    readonly total: false;
  }): Promise<AppwriteList<Readonly<Record<string, unknown>>>>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<Readonly<Record<string, unknown>>>;
}

interface AppwriteStoragePort {
  getBucket(input: {
    readonly bucketId: string;
  }): Promise<Readonly<Record<string, unknown>>>;
  listFiles(input: {
    readonly bucketId: string;
    readonly queries: string[];
    readonly total: false;
  }): Promise<AppwriteList<Readonly<Record<string, unknown>>>>;
  getFileDownload(input: {
    readonly bucketId: string;
    readonly fileId: string;
  }): Promise<ArrayBuffer>;
}

interface AppwriteFunctionsPort {
  get(input: {
    readonly functionId: string;
  }): Promise<Readonly<Record<string, unknown>>>;
}

function text(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error("RECOVERY_APPWRITE_RESPONSE_INVALID");
  return value;
}

function number(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("RECOVERY_APPWRITE_RESPONSE_INVALID");
  return value;
}

function pageQueries(cursor?: string): string[] {
  return [
    Query.orderAsc("$id"),
    Query.limit(100),
    ...(cursor ? [Query.cursorAfter(cursor)] : []),
  ];
}

async function pages<T extends Readonly<Record<string, unknown>>>(
  load: (queries: string[]) => Promise<readonly T[]>,
): Promise<readonly T[]> {
  const result: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await load(pageQueries(cursor));
    result.push(...page);
    if (page.length < 100) return result;
    const last = page.at(-1);
    if (!last) return result;
    const next = text(last, "$id");
    if (next === cursor) throw new Error("RECOVERY_APPWRITE_PAGINATION_INVALID");
    cursor = next;
  }
}

function safeFunctionConfiguration(value: Readonly<Record<string, unknown>>) {
  const variables: readonly unknown[] = Array.isArray(value.vars) ? value.vars : [];
  const variableName = (candidate: unknown): readonly string[] => {
    if (typeof candidate !== "object" || candidate === null || !("key" in candidate))
      return [];
    const key = candidate.key;
    return typeof key === "string" ? [key] : [];
  };
  return {
    functionId: value.$id,
    name: value.name,
    runtime: value.runtime,
    execute: value.execute,
    entrypoint: value.entrypoint,
    commands: value.commands,
    timeout: value.timeout,
    schedule: value.schedule,
    scopes: value.scopes,
    variableNames: variables.flatMap(variableName).sort(),
  };
}

export function createAppwriteRecoverySource(
  ports: {
    readonly tables: AppwriteTablesPort;
    readonly storage: AppwriteStoragePort;
    readonly functions: AppwriteFunctionsPort;
  },
  config: {
    readonly databaseId: string;
    readonly bucketId: string;
    readonly functionId: string;
    readonly now: () => string;
  },
): RecoverySource {
  return {
    async inventory(): Promise<RecoverySourceInventory> {
      const [tableRecords, fileRecords, bucket, functionDefinition] = await Promise.all(
        [
          pages((queries) =>
            ports.tables
              .listTables({ databaseId: config.databaseId, queries, total: false })
              .then((result) => result.tables ?? []),
          ),
          pages((queries) =>
            ports.storage
              .listFiles({ bucketId: config.bucketId, queries, total: false })
              .then((result) => result.files ?? []),
          ),
          ports.storage.getBucket({ bucketId: config.bucketId }),
          ports.functions.get({ functionId: config.functionId }),
        ],
      );
      const tables: RecoverySourceTable[] = [];
      for (const table of tableRecords) {
        const tableId = text(table, "$id");
        const rows = await pages((queries) =>
          ports.tables
            .listRows({
              databaseId: config.databaseId,
              tableId,
              queries,
              total: false,
            })
            .then((result) => result.rows ?? []),
        );
        tables.push({
          id: tableId,
          schema: table,
          rows: rows.map((row): RecoverySourceRowIdentity => ({
            id: text(row, "$id"),
            updatedAt: text(row, "$updatedAt"),
          })),
        });
      }
      const files = fileRecords.map((file): RecoverySourceFile => ({
        id: text(file, "$id"),
        updatedAt: text(file, "$updatedAt"),
        size: number(file, "sizeOriginal"),
        signature: text(file, "signature"),
      }));
      return {
        capturedAt: config.now(),
        databaseId: config.databaseId,
        bucketId: config.bucketId,
        tables,
        files,
        configuration: {
          bucket,
          function: safeFunctionConfiguration(functionDefinition),
        },
      };
    },
    readRow: (tableId, rowId) =>
      ports.tables.getRow({ databaseId: config.databaseId, tableId, rowId }),
    async readFile(fileId) {
      return new Uint8Array(
        await ports.storage.getFileDownload({
          bucketId: config.bucketId,
          fileId,
        }),
      );
    },
  };
}
