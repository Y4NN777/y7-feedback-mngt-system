import type { ServerConfig } from "@y7-feedback/config/server";

export interface G1FixtureRow {
  readonly tableId: string;
  readonly rowId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly permissions: readonly [];
}

export interface G1FixtureStore {
  getRow(
    tableId: string,
    rowId: string,
  ): Promise<Readonly<Record<string, unknown>> | null>;
  createTransaction(): Promise<string>;
  createRow(input: {
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
    readonly transactionId: string;
  }): Promise<void>;
  commitTransaction(transactionId: string): Promise<void>;
  rollbackTransaction(transactionId: string): Promise<void>;
}

const createdAt = "2026-08-10T00:00:00.000Z";

function project(
  tableId: string,
  rowId: string,
  workspaceId: string,
  slug: string,
  purposeFr: string,
  purposeEn: string,
): G1FixtureRow {
  return {
    tableId,
    rowId,
    permissions: [],
    data: {
      workspaceId,
      slug,
      active: true,
      enabledTypesJson: JSON.stringify(["bug", "suggestion", "review"]),
      contextDeclarationsJson: "[]",
      reporterPurposeFr: purposeFr,
      reporterPurposeEn: purposeEn,
    },
  };
}

function slug(
  tableId: string,
  rowId: string,
  value: string,
  workspaceId: string,
  projectId: string,
  current: boolean,
): G1FixtureRow {
  return {
    tableId,
    rowId,
    permissions: [],
    data: { slug: value, workspaceId, projectId, current, claimedAt: createdAt },
  };
}

export function createG1FixtureRows(
  schema: ServerConfig["appwriteSchema"],
): readonly G1FixtureRow[] {
  return [
    {
      tableId: schema.workspacesTableId,
      rowId: "workspace_alpha",
      permissions: [],
      data: { name: "Alpha Workspace", active: true, createdAt },
    },
    {
      tableId: schema.workspacesTableId,
      rowId: "workspace_beta",
      permissions: [],
      data: { name: "Beta Workspace", active: true, createdAt },
    },
    project(
      schema.projectsTableId,
      "project_alpha",
      "workspace_alpha",
      "wisemoney",
      "Partager un retour sur WiseMoney.",
      "Share feedback about WiseMoney.",
    ),
    project(
      schema.projectsTableId,
      "project_beta",
      "workspace_beta",
      "lantern",
      "Partager un retour sur Lantern.",
      "Share feedback about Lantern.",
    ),
    slug(
      schema.projectSlugsTableId,
      "slug_wisemoney_legacy",
      "wisemoney-legacy",
      "workspace_alpha",
      "project_alpha",
      false,
    ),
    slug(
      schema.projectSlugsTableId,
      "slug_wisemoney",
      "wisemoney",
      "workspace_alpha",
      "project_alpha",
      true,
    ),
    slug(
      schema.projectSlugsTableId,
      "slug_lantern",
      "lantern",
      "workspace_beta",
      "project_beta",
      true,
    ),
  ];
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

export async function seedG1Fixtures(
  store: G1FixtureStore,
  rows: readonly G1FixtureRow[],
): Promise<{ readonly created: number; readonly verified: number }> {
  const inspected = await Promise.all(
    rows.map(async (row) => ({
      row,
      existing: await store.getRow(row.tableId, row.rowId),
    })),
  );
  for (const candidate of inspected) {
    if (
      candidate.existing &&
      canonical(candidate.existing) !== canonical(candidate.row.data)
    ) {
      throw new Error(
        `APPWRITE_G1_FIXTURE_DRIFT:${candidate.row.tableId}:${candidate.row.rowId}`,
      );
    }
  }
  const missing = inspected.filter(({ existing }) => !existing).map(({ row }) => row);
  if (missing.length === 0) return { created: 0, verified: rows.length };

  const transactionId = await store.createTransaction();
  try {
    for (const row of missing) {
      await store.createRow({
        tableId: row.tableId,
        rowId: row.rowId,
        data: row.data,
        permissions: row.permissions,
        transactionId,
      });
    }
    await store.commitTransaction(transactionId);
  } catch (error: unknown) {
    try {
      await store.rollbackTransaction(transactionId);
    } catch {
      // Preserve the originating mutation failure.
    }
    throw error;
  }
  return { created: missing.length, verified: rows.length - missing.length };
}
