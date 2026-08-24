import { createHash } from "node:crypto";

import type { PublicApi, PublicApiResponse } from "./public-api.js";

export interface AppwriteG1MatrixSchema {
  readonly databaseId: string;
  readonly reportersTableId: string;
  readonly feedbackTableId: string;
  readonly lifecycleTableId: string;
  readonly accessGrantsTableId: string;
  readonly notificationsTableId: string;
  readonly outboxTableId: string;
  readonly idempotencyTableId: string;
}

export interface AppwriteG1MatrixIds {
  readonly feedbackId: string;
  readonly reporterId: string;
  readonly notificationId: string;
  readonly lifecycleId: string;
  readonly outboxId: string;
}

export interface AppwriteG1MatrixTables {
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
  deleteRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
}

export interface AppwriteG1MatrixResult {
  readonly accepted: true;
  readonly replayed: true;
  readonly conflictDenied: true;
  readonly invalidProofDenied: true;
  readonly authorizedRetrieval: true;
  readonly sensitiveRowsEncrypted: true;
  readonly cleanedRows: number;
}

const projectId = "project_alpha";
const workspaceId = "workspace_alpha";
const projectSlug = "wisemoney";
const sensitiveMarker = "G1 private intake marker";

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseBody(
  response: PublicApiResponse | null,
): Readonly<Record<string, unknown>> {
  if (!response || !isObject(response.body))
    throw new Error("APPWRITE_G1_MATRIX_FAILED");
  return response.body;
}

function expectStatus(response: PublicApiResponse | null, statusCode: number) {
  if (response?.statusCode !== statusCode) throw new Error("APPWRITE_G1_MATRIX_FAILED");
  return responseBody(response);
}

function intakeBody(clientOperationId: string, problem = sensitiveMarker) {
  return {
    clientOperationId,
    locale: "fr",
    feedback: {
      type: "bug",
      source: { type: "bug", problem },
      reporter: { kind: "unidentified" },
      context: [],
      attachmentNames: [],
    },
  };
}

function idempotencyRowId(clientOperationId: string): string {
  const digest = createHash("sha256")
    .update(`${workspaceId}:${projectId}`)
    .update("\0")
    .update(clientOperationId)
    .digest("hex");
  return `idem_${digest.slice(0, 31)}`;
}

function envelope(row: unknown, field: string): boolean {
  return (
    isObject(row) && typeof row[field] === "string" && row[field].startsWith("v1.")
  );
}

function absent(error: unknown): boolean {
  return isObject(error) && error.code === 404;
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}

export async function runAppwriteG1Matrix(
  api: PublicApi,
  tables: AppwriteG1MatrixTables,
  schema: AppwriteG1MatrixSchema,
  ids: AppwriteG1MatrixIds,
  clientOperationId: string,
): Promise<AppwriteG1MatrixResult> {
  const rows = [
    [schema.reportersTableId, ids.reporterId],
    [schema.feedbackTableId, ids.feedbackId],
    [schema.lifecycleTableId, ids.lifecycleId],
    [schema.accessGrantsTableId, ids.feedbackId],
    [schema.notificationsTableId, ids.notificationId],
    [schema.outboxTableId, ids.outboxId],
    [schema.idempotencyTableId, idempotencyRowId(clientOperationId)],
  ] as const;
  let cleanedRows = 0;
  let matrixFailure: unknown;
  let result: Omit<AppwriteG1MatrixResult, "cleanedRows"> | undefined;
  let stage = "INTAKE";
  try {
    const accepted = expectStatus(
      await api.handle({
        method: "POST",
        path: `/v1/projects/${projectSlug}/feedback`,
        headers: { "content-type": "application/json" },
        body: intakeBody(clientOperationId),
      }),
      201,
    );
    if (
      accepted.status !== "accepted" ||
      accepted.replayed !== false ||
      typeof accepted.reference !== "string" ||
      typeof accepted.accessProof !== "string"
    ) {
      throw new Error("APPWRITE_G1_MATRIX_FAILED");
    }
    const reference = accepted.reference;
    const accessProof = accepted.accessProof;

    stage = "REPLAY";
    const replay = expectStatus(
      await api.handle({
        method: "POST",
        path: `/v1/projects/${projectSlug}/feedback`,
        headers: { "content-type": "application/json" },
        body: intakeBody(clientOperationId),
      }),
      200,
    );
    if (
      replay.replayed !== true ||
      replay.reference !== reference ||
      replay.accessProof !== accessProof
    ) {
      throw new Error("APPWRITE_G1_MATRIX_FAILED");
    }

    stage = "CONFLICT";
    const conflict = expectStatus(
      await api.handle({
        method: "POST",
        path: `/v1/projects/${projectSlug}/feedback`,
        headers: { "content-type": "application/json" },
        body: intakeBody(clientOperationId, "Different payload"),
      }),
      409,
    );
    if (conflict.error !== "ERR-OPERATION-CONFLICT") {
      throw new Error("APPWRITE_G1_MATRIX_FAILED");
    }

    stage = "DENIAL";
    const denied = expectStatus(
      await api.handle({
        method: "POST",
        path: "/v1/feedback/retrieve",
        headers: { authorization: `FeedbackProof ${"A".repeat(43)}` },
        body: { reference },
      }),
      404,
    );
    if (denied.error !== "ERR-ACCESS-DENIED") {
      throw new Error("APPWRITE_G1_MATRIX_FAILED");
    }

    stage = "RETRIEVAL";
    const retrieved = expectStatus(
      await api.handle({
        method: "POST",
        path: "/v1/feedback/retrieve",
        headers: { authorization: `FeedbackProof ${accessProof}` },
        body: { reference },
      }),
      200,
    );
    if (
      retrieved.status !== "ok" ||
      JSON.stringify(retrieved).includes("internalNotes")
    ) {
      throw new Error("APPWRITE_G1_MATRIX_FAILED");
    }

    stage = "ENVELOPES";
    const [reporter, feedback, grant, outbox, idempotency] = await Promise.all([
      tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.reportersTableId,
        rowId: ids.reporterId,
      }),
      tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.feedbackTableId,
        rowId: ids.feedbackId,
      }),
      tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.accessGrantsTableId,
        rowId: ids.feedbackId,
      }),
      tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.outboxTableId,
        rowId: ids.outboxId,
      }),
      tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.idempotencyTableId,
        rowId: idempotencyRowId(clientOperationId),
      }),
    ]);
    const serialized = JSON.stringify([reporter, feedback, grant, outbox, idempotency]);
    if (
      serialized.includes(sensitiveMarker) ||
      serialized.includes(accessProof) ||
      !envelope(reporter, "attributionJson") ||
      !envelope(feedback, "originalSourceJson") ||
      !envelope(feedback, "currentSourceJson") ||
      !envelope(grant, "verifier") ||
      !envelope(outbox, "payloadJson") ||
      !envelope(idempotency, "protectedProof") ||
      !envelope(idempotency, "proofVerifier")
    ) {
      throw new Error("APPWRITE_G1_MATRIX_FAILED");
    }

    result = {
      accepted: true,
      replayed: true,
      conflictDenied: true,
      invalidProofDenied: true,
      authorizedRetrieval: true,
      sensitiveRowsEncrypted: true,
    };
  } catch (error: unknown) {
    matrixFailure = new Error(`APPWRITE_G1_${stage}_FAILED`, { cause: error });
  }

  let cleanupFailure: unknown;
  for (const [tableId, rowId] of [...rows].reverse()) {
    try {
      await tables.deleteRow({ databaseId: schema.databaseId, tableId, rowId });
      cleanedRows += 1;
    } catch (error: unknown) {
      if (!absent(error) && cleanupFailure === undefined) {
        cleanupFailure = error;
      }
    }
  }
  if (cleanupFailure !== undefined) {
    throw asError(cleanupFailure, "APPWRITE_G1_CLEANUP_FAILED");
  }
  if (matrixFailure !== undefined) {
    throw asError(matrixFailure, "APPWRITE_G1_MATRIX_FAILED");
  }
  return {
    ...(result as Omit<AppwriteG1MatrixResult, "cleanedRows">),
    cleanedRows,
  };
}
