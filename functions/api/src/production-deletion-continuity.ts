export interface ProductionDeletionProbeTablesPort {
  readonly createTable: (input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly name: string;
    readonly permissions: readonly string[];
    readonly rowSecurity: boolean;
    readonly enabled: boolean;
  }) => Promise<unknown>;
  readonly deleteTable: (input: {
    readonly databaseId: string;
    readonly tableId: string;
  }) => Promise<unknown>;
  readonly createRow: (input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, never>>;
    readonly permissions: readonly string[];
  }) => Promise<unknown>;
  readonly deleteRow: (input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }) => Promise<unknown>;
  readonly getRow: (input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }) => Promise<unknown>;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function notFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === 404
  );
}

export async function proveProductionDeletionContinuity(
  tables: ProductionDeletionProbeTablesPort,
  input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly markerId: string;
    readonly rollback: () => Promise<void>;
    readonly rollForward: () => Promise<void>;
  },
): Promise<{ readonly rollbackAbsent: true; readonly rollForwardAbsent: true }> {
  if (
    !identifier.test(input.databaseId) ||
    !identifier.test(input.tableId) ||
    !identifier.test(input.markerId)
  ) {
    throw new Error("PRODUCTION_DELETION_PROBE_INVALID");
  }

  let tableCreated = false;
  let failure: unknown;
  const assertAbsent = async () => {
    try {
      await tables.getRow({
        databaseId: input.databaseId,
        tableId: input.tableId,
        rowId: input.markerId,
      });
    } catch (error) {
      if (notFound(error)) return;
      throw error;
    }
    throw new Error("PRODUCTION_DELETION_RESURRECTED");
  };

  try {
    await tables.createTable({
      databaseId: input.databaseId,
      tableId: input.tableId,
      name: "Y7 release deletion continuity probe",
      permissions: [],
      rowSecurity: true,
      enabled: true,
    });
    tableCreated = true;
    await tables.createRow({
      databaseId: input.databaseId,
      tableId: input.tableId,
      rowId: input.markerId,
      data: {},
      permissions: [],
    });
    await tables.deleteRow({
      databaseId: input.databaseId,
      tableId: input.tableId,
      rowId: input.markerId,
    });
    await assertAbsent();
    try {
      await input.rollback();
      await assertAbsent();
    } finally {
      await input.rollForward();
      await assertAbsent();
    }
  } catch (error) {
    failure = error;
  }
  if (tableCreated) {
    try {
      await tables.deleteTable({
        databaseId: input.databaseId,
        tableId: input.tableId,
      });
    } catch (cleanupError) {
      failure ??= cleanupError;
    }
  }
  if (failure !== undefined) {
    throw failure instanceof Error
      ? failure
      : new Error("PRODUCTION_DELETION_PROBE_FAILED");
  }
  return { rollbackAbsent: true, rollForwardAbsent: true };
}
