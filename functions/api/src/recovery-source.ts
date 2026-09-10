import type { RecoveryEntry } from "@y7-feedback/domain";

export interface RecoverySourceRowIdentity {
  readonly id: string;
  readonly updatedAt: string;
}

export interface RecoverySourceTable {
  readonly id: string;
  readonly schema: unknown;
  readonly rows: readonly RecoverySourceRowIdentity[];
}

export interface RecoverySourceFile {
  readonly id: string;
  readonly updatedAt: string;
  readonly size: number;
  readonly signature: string;
}

export interface RecoverySourceInventory {
  readonly capturedAt: string;
  readonly databaseId: string;
  readonly bucketId: string;
  readonly tables: readonly RecoverySourceTable[];
  readonly files: readonly RecoverySourceFile[];
  readonly configuration: unknown;
}

export interface RecoverySource {
  inventory(): Promise<RecoverySourceInventory>;
  readRow(tableId: string, rowId: string): Promise<unknown>;
  readFile(fileId: string): Promise<Uint8Array>;
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, candidate]) => [key, normalized(candidate)]),
  );
}

function serialize(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(normalized(value)));
}

function fingerprint(inventory: RecoverySourceInventory): string {
  return JSON.stringify(
    normalized({
      databaseId: inventory.databaseId,
      bucketId: inventory.bucketId,
      tables: inventory.tables,
      files: inventory.files,
      configuration: inventory.configuration,
    }),
  );
}

function maximumTimestamp(inventory: RecoverySourceInventory): string {
  const mutations = [
    ...inventory.tables.flatMap((table) => table.rows.map((row) => row.updatedAt)),
    ...inventory.files.map((file) => file.updatedAt),
  ];
  const timestamps = mutations.length === 0 ? [inventory.capturedAt] : mutations;
  if (timestamps.some((value) => !Number.isFinite(Date.parse(value))))
    throw new Error("RECOVERY_SOURCE_INVENTORY_INVALID");
  return timestamps.reduce((latest, value) => (value > latest ? value : latest));
}

export async function collectRecoveryEntries(input: {
  readonly source: RecoverySource;
  readonly deletionTableIds: readonly string[];
}): Promise<{
  readonly entries: readonly RecoveryEntry[];
  readonly latestSourceMutationAt: string;
}> {
  const before = await input.source.inventory();
  const entries: RecoveryEntry[] = [
    {
      kind: "config",
      path: "config/appwrite.json",
      bytes: serialize({
        databaseId: before.databaseId,
        bucketId: before.bucketId,
        tables: before.tables.map(({ id, schema }) => ({ id, schema })),
        files: before.files,
        configuration: before.configuration,
      }),
    },
  ];
  try {
    for (const table of before.tables) {
      for (const row of table.rows) {
        const deletion = input.deletionTableIds.includes(table.id);
        entries.push({
          kind: deletion ? "deletion_event" : "table_row",
          path: deletion
            ? `deletions/${table.id}/${row.id}.json`
            : `tables/${table.id}/${row.id}.json`,
          bytes: serialize(await input.source.readRow(table.id, row.id)),
        });
      }
    }
    for (const file of before.files) {
      const bytes = await input.source.readFile(file.id);
      if (bytes.byteLength !== file.size)
        throw new Error("RECOVERY_SOURCE_FILE_CHANGED");
      entries.push({
        kind: "private_file",
        path: `storage/${before.bucketId}/${file.id}`,
        bytes,
      });
    }
  } catch {
    throw new Error("RECOVERY_SOURCE_READ_FAILED");
  }
  const after = await input.source.inventory();
  if (fingerprint(before) !== fingerprint(after))
    throw new Error("RECOVERY_SOURCE_CHANGED");
  return { entries, latestSourceMutationAt: maximumTimestamp(before) };
}
