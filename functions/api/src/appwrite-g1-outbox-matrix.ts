import {
  appwriteG1SyntheticRows,
  type AppwriteG1MatrixIds,
  type AppwriteG1MatrixSchema,
  type AppwriteG1MatrixTables,
} from "./appwrite-g1-matrix.js";
import type { OutboxRunResult } from "./outbox.js";
import type { PublicApi } from "./public-api.js";

export interface AppwriteG1OutboxMatrixInput {
  readonly retryIds: AppwriteG1MatrixIds;
  readonly permanentIds: AppwriteG1MatrixIds;
  readonly retryOperationId: string;
  readonly permanentOperationId: string;
}

export interface AppwriteG1OutboxMatrixResult {
  readonly retryScheduled: true;
  readonly retryDelivered: true;
  readonly permanentFailed: true;
  readonly deduplicated: true;
  readonly terminalRowsEncrypted: true;
  readonly cleanedRows: 14;
}

export interface AppwriteG1OutboxWorker {
  readonly runOnce: () => Promise<OutboxRunResult>;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return isObject(error) && error.code === 404;
}

function intakeBody(clientOperationId: string, marker: string) {
  return {
    clientOperationId,
    locale: "fr",
    feedback: {
      type: "bug",
      source: { type: "bug", problem: marker },
      reporter: { kind: "unidentified" },
      context: [],
      attachmentNames: [],
    },
  };
}

async function accept(api: PublicApi, operationId: string, marker: string) {
  const response = await api.handle({
    method: "POST",
    path: "/v1/projects/wisemoney/feedback",
    headers: { "content-type": "application/json" },
    body: intakeBody(operationId, marker),
  });
  if (
    response?.statusCode !== 201 ||
    !isObject(response.body) ||
    response.body.status !== "accepted" ||
    response.body.replayed !== false
  ) {
    throw new Error("APPWRITE_G1_OUTBOX_ACCEPT_FAILED");
  }
}

function expectRun(result: OutboxRunResult, status: OutboxRunResult["status"]): void {
  if (result.status !== status) {
    throw new Error(`APPWRITE_G1_OUTBOX_UNEXPECTED_${result.status.toUpperCase()}`);
  }
}

export async function runAppwriteG1OutboxMatrix(
  api: PublicApi,
  worker: AppwriteG1OutboxWorker,
  tables: AppwriteG1MatrixTables,
  schema: AppwriteG1MatrixSchema,
  input: AppwriteG1OutboxMatrixInput,
): Promise<AppwriteG1OutboxMatrixResult> {
  const rows = [
    ...appwriteG1SyntheticRows(schema, input.retryIds, input.retryOperationId),
    ...appwriteG1SyntheticRows(schema, input.permanentIds, input.permanentOperationId),
  ] as const;
  let failure: unknown;
  let stage = "ACCEPT_RETRY";
  let result: Omit<AppwriteG1OutboxMatrixResult, "cleanedRows"> | undefined;
  try {
    await accept(api, input.retryOperationId, "G1 retry outbox marker");
    stage = "ACCEPT_PERMANENT";
    await accept(api, input.permanentOperationId, "G1 permanent outbox marker");
    stage = "RETRY";
    expectRun(await worker.runOnce(), "retry_scheduled");
    stage = "RECOVERY";
    expectRun(await worker.runOnce(), "delivered");
    stage = "PERMANENT";
    expectRun(await worker.runOnce(), "failed");
    stage = "DEDUPLICATION";
    expectRun(await worker.runOnce(), "idle");

    stage = "TERMINAL_ROWS";
    const [delivered, failed] = await Promise.all([
      tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.outboxTableId,
        rowId: input.retryIds.outboxId,
      }),
      tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.outboxTableId,
        rowId: input.permanentIds.outboxId,
      }),
    ]);
    if (
      !isObject(delivered) ||
      delivered.status !== "delivered" ||
      typeof delivered.payloadJson !== "string" ||
      !delivered.payloadJson.startsWith("v1.") ||
      !isObject(failed) ||
      failed.status !== "failed" ||
      typeof failed.payloadJson !== "string" ||
      !failed.payloadJson.startsWith("v1.")
    ) {
      throw new Error("APPWRITE_G1_OUTBOX_TERMINAL_FAILED");
    }
    result = {
      retryScheduled: true,
      retryDelivered: true,
      permanentFailed: true,
      deduplicated: true,
      terminalRowsEncrypted: true,
    };
  } catch (error: unknown) {
    failure = error;
  }

  let cleanedRows = 0;
  let cleanupFailure: unknown;
  for (const [tableId, rowId] of [...rows].reverse()) {
    try {
      await tables.deleteRow({ databaseId: schema.databaseId, tableId, rowId });
      cleanedRows += 1;
    } catch (error: unknown) {
      if (!absent(error) && cleanupFailure === undefined) cleanupFailure = error;
    }
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure instanceof Error
      ? cleanupFailure
      : new Error("APPWRITE_G1_OUTBOX_CLEANUP_FAILED");
  }
  if (failure !== undefined || cleanedRows !== 14) {
    throw new Error(`APPWRITE_G1_OUTBOX_${stage}_FAILED`, { cause: failure });
  }
  return { ...result, cleanedRows } as AppwriteG1OutboxMatrixResult;
}
