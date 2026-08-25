import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Client, ExecutionMethod, Functions, Query, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createAppwriteFunctionPublicApi } from "./appwrite-function-public-api.js";
import { previewFunctionId } from "./appwrite-function-variables.js";
import { createHttpFunctionPublicApi } from "./http-function-public-api.js";
import type { PublicApiResponse } from "./public-api.js";

const workspaceId = "workspace_alpha";
const projectId = "project_alpha";

interface Row extends Readonly<Record<string, unknown>> {
  readonly $id: string;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("APPWRITE_DEPLOYED_G1_RESPONSE_INVALID");
  }
  return value as Readonly<Record<string, unknown>>;
}

function expectResponse(
  response: PublicApiResponse | null,
  statusCode: number,
): Readonly<Record<string, unknown>> {
  if (response?.statusCode !== statusCode) {
    throw new Error("APPWRITE_DEPLOYED_G1_STATUS_INVALID");
  }
  return record(response.body);
}

function intakeBody(operationId: string, marker: string) {
  return {
    clientOperationId: operationId,
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

function idempotencyId(operationId: string): string {
  const digest = createHash("sha256")
    .update(`${workspaceId}:${projectId}`)
    .update("\0")
    .update(operationId)
    .digest("hex");
  return `idem_${digest.slice(0, 31)}`;
}

function envelope(row: Row, field: string): boolean {
  return typeof row[field] === "string" && row[field].startsWith("v1.");
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("APPWRITE_DEPLOYED_G1_APPLY_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("APPWRITE_DEPLOYED_G1_NON_PRODUCTION_REQUIRED");
  }

  const directDomain = process.argv.includes("--domain");

  const publicFunctions = new Functions(
    new Client()
      .setEndpoint(config.appwriteEndpoint)
      .setProject(config.appwriteProjectId),
  );
  const api = directDomain
    ? createHttpFunctionPublicApi({
        baseUrl: process.env.Y7_FUNCTION_DOMAIN_URL ?? "",
        fetch,
      })
    : createAppwriteFunctionPublicApi({
        execute: async ({ body, method, path, headers }) => {
          const execution = await publicFunctions.createExecution({
            functionId: previewFunctionId,
            body,
            async: false,
            xpath: path,
            method: method as ExecutionMethod,
            headers,
          });
          return {
            status: execution.status,
            responseStatusCode: execution.responseStatusCode,
            responseBody: execution.responseBody,
          };
        },
      });
  const tables = new TablesDB(
    new Client()
      .setEndpoint(config.appwriteEndpoint)
      .setProject(config.appwriteProjectId)
      .setKey(config.appwriteApiKey),
  );
  const operationId = randomUUID();
  const marker = `G1 deployed private marker ${randomBytes(8).toString("hex")}`;
  let reference: string | undefined;
  let accessProof: string | undefined;
  let matrixFailure: unknown;
  let cleanedRows = 0;

  const findOne = async (
    tableId: string,
    attribute: string,
    value: string,
  ): Promise<Row> => {
    const rows = await tables.listRows({
      databaseId: config.appwriteSchema.databaseId,
      tableId,
      queries: [Query.equal(attribute, [value]), Query.limit(2)],
      total: false,
    });
    if (rows.rows.length !== 1) {
      throw new Error("APPWRITE_DEPLOYED_G1_ROW_INVALID");
    }
    return rows.rows[0] as Row;
  };

  const discover = async () => {
    const idempotency = (await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.idempotencyTableId,
      rowId: idempotencyId(operationId),
    })) as Row;
    if (typeof idempotency.feedbackId !== "string") {
      throw new Error("APPWRITE_DEPLOYED_G1_ROW_INVALID");
    }
    const feedback = (await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.feedbackTableId,
      rowId: idempotency.feedbackId,
    })) as Row;
    if (typeof feedback.reporterId !== "string") {
      throw new Error("APPWRITE_DEPLOYED_G1_ROW_INVALID");
    }
    const lifecycle = await findOne(
      config.appwriteSchema.lifecycleTableId,
      "feedbackId",
      feedback.$id,
    );
    const notification = await findOne(
      config.appwriteSchema.notificationsTableId,
      "feedbackId",
      feedback.$id,
    );
    const outbox = await findOne(
      config.appwriteSchema.outboxTableId,
      "notificationId",
      notification.$id,
    );
    const reporter = (await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.reportersTableId,
      rowId: feedback.reporterId,
    })) as Row;
    const grant = (await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.accessGrantsTableId,
      rowId: feedback.$id,
    })) as Row;
    return {
      feedback,
      lifecycle,
      notification,
      outbox,
      reporter,
      grant,
      idempotency,
      rows: [
        [config.appwriteSchema.reportersTableId, reporter.$id],
        [config.appwriteSchema.feedbackTableId, feedback.$id],
        [config.appwriteSchema.lifecycleTableId, lifecycle.$id],
        [config.appwriteSchema.accessGrantsTableId, grant.$id],
        [config.appwriteSchema.notificationsTableId, notification.$id],
        [config.appwriteSchema.outboxTableId, outbox.$id],
        [config.appwriteSchema.idempotencyTableId, idempotency.$id],
      ] as const,
    };
  };

  let discoveredRows: readonly (readonly [string, string])[] = [];
  try {
    const unavailable = expectResponse(
      await api.handle({
        method: "POST",
        path: "/v1/projects/unknown-project/feedback",
        headers: { "content-type": "application/json" },
        body: intakeBody(randomUUID(), marker),
      }),
      404,
    );
    if (unavailable.error !== "ERR-PROJECT-UNAVAILABLE") {
      throw new Error("APPWRITE_DEPLOYED_G1_DENIAL_INVALID");
    }

    const invalid = expectResponse(
      await api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: { "content-type": "application/json" },
        body: { ...intakeBody(randomUUID(), marker), locale: "invalid" },
      }),
      400,
    );
    if (invalid.error !== "ERR-INTAKE-INVALID") {
      throw new Error("APPWRITE_DEPLOYED_G1_VALIDATION_INVALID");
    }

    const accepted = expectResponse(
      await api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: { "content-type": "application/json" },
        body: intakeBody(operationId, marker),
      }),
      201,
    );
    if (
      accepted.status !== "accepted" ||
      accepted.replayed !== false ||
      typeof accepted.reference !== "string" ||
      typeof accepted.accessProof !== "string"
    ) {
      throw new Error("APPWRITE_DEPLOYED_G1_ACCEPTANCE_INVALID");
    }
    reference = accepted.reference;
    accessProof = accepted.accessProof;

    const replay = expectResponse(
      await api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: { "content-type": "application/json" },
        body: intakeBody(operationId, marker),
      }),
      200,
    );
    if (
      replay.replayed !== true ||
      replay.reference !== reference ||
      replay.accessProof !== accessProof
    ) {
      throw new Error("APPWRITE_DEPLOYED_G1_REPLAY_INVALID");
    }

    const conflict = expectResponse(
      await api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: { "content-type": "application/json" },
        body: intakeBody(operationId, `${marker} changed`),
      }),
      409,
    );
    if (conflict.error !== "ERR-OPERATION-CONFLICT") {
      throw new Error("APPWRITE_DEPLOYED_G1_CONFLICT_INVALID");
    }

    for (const headers of [{}, { authorization: `FeedbackProof ${"A".repeat(43)}` }]) {
      const denial = expectResponse(
        await api.handle({
          method: "POST",
          path: "/v1/feedback/retrieve",
          headers,
          body: { reference },
        }),
        404,
      );
      if (denial.error !== "ERR-ACCESS-DENIED") {
        throw new Error("APPWRITE_DEPLOYED_G1_PROOF_DENIAL_INVALID");
      }
    }

    const retrieved = expectResponse(
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
      throw new Error("APPWRITE_DEPLOYED_G1_RETRIEVAL_INVALID");
    }

    const rotated = expectResponse(
      await api.handle({
        method: "POST",
        path: "/v1/feedback/access-proof/rotate",
        headers: { authorization: `FeedbackProof ${accessProof}` },
        body: { reference },
      }),
      200,
    );
    if (
      rotated.status !== "ok" ||
      rotated.reference !== reference ||
      typeof rotated.accessProof !== "string" ||
      rotated.accessProof === accessProof
    ) {
      throw new Error("APPWRITE_DEPLOYED_G1_ROTATION_INVALID");
    }

    const oldProof = expectResponse(
      await api.handle({
        method: "POST",
        path: "/v1/feedback/retrieve",
        headers: { authorization: `FeedbackProof ${accessProof}` },
        body: { reference },
      }),
      404,
    );
    if (oldProof.error !== "ERR-ACCESS-DENIED") {
      throw new Error("APPWRITE_DEPLOYED_G1_OLD_PROOF_INVALID");
    }

    const rotatedProof = rotated.accessProof;
    const rotatedRetrieval = expectResponse(
      await api.handle({
        method: "POST",
        path: "/v1/feedback/retrieve",
        headers: { authorization: `FeedbackProof ${rotatedProof}` },
        body: { reference },
      }),
      200,
    );
    if (rotatedRetrieval.status !== "ok") {
      throw new Error("APPWRITE_DEPLOYED_G1_ROTATED_PROOF_INVALID");
    }

    const revoked = expectResponse(
      await api.handle({
        method: "POST",
        path: "/v1/feedback/access-proof/revoke",
        headers: { authorization: `FeedbackProof ${rotatedProof}` },
        body: { reference },
      }),
      200,
    );
    if (revoked.status !== "ok") {
      throw new Error("APPWRITE_DEPLOYED_G1_REVOCATION_INVALID");
    }

    const revokedProof = expectResponse(
      await api.handle({
        method: "POST",
        path: "/v1/feedback/retrieve",
        headers: { authorization: `FeedbackProof ${rotatedProof}` },
        body: { reference },
      }),
      404,
    );
    if (revokedProof.error !== "ERR-ACCESS-DENIED") {
      throw new Error("APPWRITE_DEPLOYED_G1_REVOKED_PROOF_INVALID");
    }

    const discovered = await discover();
    const { feedback, grant, idempotency, outbox, reporter } = discovered;
    const serialized = JSON.stringify([reporter, feedback, grant, outbox, idempotency]);
    if (
      serialized.includes(marker) ||
      serialized.includes(accessProof) ||
      !envelope(reporter, "attributionJson") ||
      !envelope(feedback, "originalSourceJson") ||
      !envelope(feedback, "currentSourceJson") ||
      !envelope(grant, "verifier") ||
      !envelope(outbox, "payloadJson") ||
      !envelope(idempotency, "protectedProof") ||
      !envelope(idempotency, "proofVerifier")
    ) {
      throw new Error("APPWRITE_DEPLOYED_G1_ENVELOPE_INVALID");
    }
    discoveredRows = discovered.rows;
  } catch (error: unknown) {
    matrixFailure = error;
  }

  if (reference !== undefined && discoveredRows.length === 0) {
    try {
      discoveredRows = (await discover()).rows;
    } catch (cleanupDiscoveryError: unknown) {
      throw new Error("APPWRITE_DEPLOYED_G1_CLEANUP_DISCOVERY_FAILED", {
        cause: cleanupDiscoveryError,
      });
    }
  }

  for (const [tableId, rowId] of [...discoveredRows].reverse()) {
    await tables.deleteRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId,
      rowId,
    });
    cleanedRows += 1;
  }
  if (matrixFailure !== undefined) {
    throw matrixFailure instanceof Error
      ? matrixFailure
      : new Error("APPWRITE_DEPLOYED_G1_FAILED");
  }
  if (cleanedRows !== 7) {
    throw new Error("APPWRITE_DEPLOYED_G1_CLEANUP_INVALID");
  }
  process.stdout.write(
    `${JSON.stringify({
      status: "ok",
      transport: directDomain ? "direct-domain" : "public-execution",
      unavailableProjectDenied: true,
      invalidInputDenied: true,
      accepted: true,
      replayed: true,
      conflictDenied: true,
      referenceOnlyDenied: true,
      invalidProofDenied: true,
      authorizedRetrieval: true,
      rotated: true,
      oldProofDenied: true,
      rotatedProofAuthorized: true,
      revoked: true,
      revokedProofDenied: true,
      sensitiveRowsEncrypted: true,
      cleanedRows,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^APPWRITE_DEPLOYED_G1_[A-Z_]+$/u.test(error.message)
      ? error.message
      : "APPWRITE_DEPLOYED_G1_FAILED";
  process.stderr.write(`${JSON.stringify({ status: "error", code })}\n`);
  process.exitCode = 1;
});
