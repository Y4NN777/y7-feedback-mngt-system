import { randomBytes } from "node:crypto";

import { Client, Query, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createHttpFunctionPublicApi } from "./http-function-public-api.js";
import { createAccessProof, hashAccessProof } from "./proof-crypto.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function denied(error: unknown): boolean {
  return object(error) && [401, 403, 404].includes(Number(error.code));
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("APPWRITE_G3_CONVERSATION_APPLY_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("APPWRITE_G3_CONVERSATION_NON_PRODUCTION_REQUIRED");
  }
  const domain = process.env.Y7_FUNCTION_DOMAIN_URL;
  if (!domain) throw new Error("APPWRITE_G3_CONVERSATION_DOMAIN_REQUIRED");

  const suffix = randomBytes(7).toString("hex");
  const workspaceId = `g3w_${suffix}`;
  const projectId = `g3p_${suffix}`;
  const feedbackId = `g3f_${suffix}`;
  const reporterId = `g3r_${suffix}`;
  const ownerId = `g3u_${suffix}`;
  const membershipId = `g3m_${suffix}`;
  const reference = `Y7-G3-${suffix.toUpperCase()}`;
  const proof = createAccessProof();
  const createdRows: Array<readonly [string, string]> = [];
  let createdUser = false;

  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const users = new Users(client);
  const api = createHttpFunctionPublicApi({ baseUrl: domain, fetch });
  const protector = createSensitiveDataProtector(
    config.sensitiveDataActiveKeyId,
    Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
      id,
      material: Buffer.from(material, "base64url"),
    })),
  );
  const createRow = async (
    tableId: string,
    rowId: string,
    data: Readonly<Record<string, unknown>>,
  ) => {
    await tables.createRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId,
      rowId,
      data,
      permissions: [],
    });
    createdRows.push([tableId, rowId]);
  };
  const sealFeedback = (field: string, value: unknown) =>
    protector.seal(
      {
        environment: config.environment,
        tableId: config.appwriteSchema.feedbackTableId,
        rowId: feedbackId,
        field,
      },
      typeof value === "string" ? value : JSON.stringify(value),
    );
  const request = async (
    method: "GET" | "POST",
    path: string,
    headers: Readonly<Record<string, string>>,
    body: unknown,
    statusCode: number,
  ) => {
    const response = await api.handle({ method, path, headers, body });
    if (response?.statusCode !== statusCode) {
      throw new Error(
        `APPWRITE_G3_CONVERSATION_HTTP_${String(statusCode)}_${String(response?.statusCode)}`,
      );
    }
    return response.body;
  };
  const workspacePath = `/v1/workspaces/${workspaceId}/projects/${projectId}/feedback/${feedbackId}`;
  const reporterPath = `/v1/feedback/${feedbackId}/conversation`;
  let jwt = "";
  let cleanupPassed = false;

  try {
    const now = new Date().toISOString();
    await users.create({ userId: ownerId, name: "G3 Conversation verifier" });
    createdUser = true;
    const session = await users.createSession({ userId: ownerId });
    jwt = (
      await users.createJWT({ userId: ownerId, sessionId: session.$id, duration: 900 })
    ).jwt;
    await createRow(config.appwriteSchema.projectsTableId, projectId, {
      workspaceId,
      slug: `g3-${suffix}`,
      active: true,
      enabledTypesJson: '["bug"]',
      contextDeclarationsJson: "[]",
      reporterPurposeFr: "Vérification conversation G3",
      reporterPurposeEn: "G3 conversation verification",
    });
    await createRow(config.appwriteSchema.workspaceMembershipsTableId, membershipId, {
      workspaceId,
      userId: ownerId,
      role: "workspace_owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await createRow(config.appwriteSchema.feedbackTableId, feedbackId, {
      projectId,
      workspaceId,
      reporterId,
      type: "bug",
      originalSourceJson: sealFeedback("originalSourceJson", {
        type: "bug",
        problem: "G3 conversation fixture",
      }),
      currentSourceJson: sealFeedback("currentSourceJson", {
        type: "bug",
        problem: "G3 conversation fixture",
      }),
      contextJson: sealFeedback("contextJson", []),
      attachmentNamesJson: sealFeedback("attachmentNamesJson", []),
      state: "received",
      acceptedAt: now,
      reporterHistoryJson: sealFeedback("reporterHistoryJson", []),
      reporterMessagesJson: sealFeedback("reporterMessagesJson", []),
      reporterAttachmentsJson: sealFeedback("reporterAttachmentsJson", []),
      sourceRevisionsJson: sealFeedback("sourceRevisionsJson", []),
      deletionRequestsJson: sealFeedback("deletionRequestsJson", []),
      internalNotesJson: sealFeedback("internalNotesJson", []),
      workspaceClassification: null,
    });
    await createRow(config.appwriteSchema.accessGrantsTableId, feedbackId, {
      feedbackId,
      reference,
      verifier: protector.seal(
        {
          environment: config.environment,
          tableId: config.appwriteSchema.accessGrantsTableId,
          rowId: feedbackId,
          field: "verifier",
        },
        hashAccessProof(proof),
      ),
      generation: 1,
      status: "active",
    });

    const bearer = { authorization: `Bearer ${jwt}` };
    const reporter = { authorization: `FeedbackProof ${proof}` };
    const command = async (
      actor: "workspace" | "reporter",
      value: Readonly<Record<string, unknown>>,
      expected = 201,
    ) =>
      request(
        "POST",
        actor === "workspace"
          ? `${workspacePath}/conversation/commands`
          : `${reporterPath}/commands`,
        actor === "workspace" ? bearer : reporter,
        actor === "workspace" ? { command: value } : { reference, command: value },
        expected,
      );

    const note = {
      kind: "append_internal_note",
      eventId: `g3n_${suffix}`,
      content: "G3 private note sentinel",
    };
    const question = {
      kind: "append_message",
      eventId: `g3q_${suffix}`,
      audience: "reporter",
      content: "Which version is affected?",
    };
    await command("workspace", note);
    await command("workspace", question);
    await command("workspace", question, 200);
    await command("workspace", { ...question, content: "conflicting payload" }, 409);
    await command("workspace", {
      kind: "start_review",
      eventId: `g3s_${suffix}`,
      expectedVersion: 1,
      reason: "Triage started",
    });
    await command("workspace", {
      kind: "request_clarification",
      eventId: `g3c_${suffix}`,
      expectedVersion: 2,
      reason: "Version required",
    });

    const reporterProjection = await request(
      "POST",
      `${reporterPath}/retrieve`,
      reporter,
      { reference },
      200,
    );
    const conversation =
      object(reporterProjection) && object(reporterProjection.conversation)
        ? reporterProjection.conversation
        : undefined;
    if (
      !conversation ||
      "internalNotes" in conversation ||
      JSON.stringify(conversation).includes("G3 private note sentinel") ||
      !JSON.stringify(conversation).includes("Which version is affected?")
    ) {
      throw new Error("APPWRITE_G3_CONVERSATION_REPORTER_PROJECTION_INVALID");
    }

    await command("reporter", {
      kind: "append_message",
      eventId: `g3a_${suffix}`,
      audience: "reporter",
      content: "Version 2.1",
    });
    await command("reporter", {
      kind: "reporter_answer",
      eventId: `g3ra_${suffix}`,
      expectedVersion: 3,
      reason: "Version 2.1",
    });
    await command("workspace", {
      kind: "resolve",
      eventId: `g3rs_${suffix}`,
      expectedVersion: 4,
      reason: "Fixed",
    });
    await command("workspace", {
      kind: "close",
      eventId: `g3cl_${suffix}`,
      expectedVersion: 5,
      reason: "Closed after notification",
    });
    await command("reporter", {
      kind: "reopen",
      eventId: `g3ro_${suffix}`,
      expectedVersion: 6,
      reason: "Issue still occurs",
    });
    await command(
      "workspace",
      {
        kind: "resolve",
        eventId: `g3st_${suffix}`,
        expectedVersion: 4,
        reason: "Stale attempt",
      },
      409,
    );
    const workspaceProjection = await request(
      "GET",
      `${workspacePath}/conversation`,
      bearer,
      undefined,
      200,
    );
    if (
      !JSON.stringify(workspaceProjection).includes("G3 private note sentinel") ||
      !JSON.stringify(workspaceProjection).includes('"state":"under_review"')
    ) {
      throw new Error("APPWRITE_G3_CONVERSATION_WORKSPACE_PROJECTION_INVALID");
    }
    const direct = new TablesDB(
      new Client()
        .setEndpoint(config.appwriteEndpoint)
        .setProject(config.appwriteProjectId)
        .setJWT(jwt),
    );
    for (const tableId of [
      config.appwriteSchema.conversationMessagesTableId,
      config.appwriteSchema.conversationInternalNotesTableId,
      config.appwriteSchema.conversationLifecycleTableId,
      config.appwriteSchema.conversationIdempotencyTableId,
    ]) {
      try {
        await direct.listRows({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          total: false,
        });
        throw new Error("APPWRITE_G3_CONVERSATION_DIRECT_ACCESS_ALLOWED");
      } catch (error: unknown) {
        if (!denied(error)) throw error;
      }
    }
  } finally {
    for (const tableId of [
      config.appwriteSchema.conversationIdempotencyTableId,
      config.appwriteSchema.conversationLifecycleTableId,
      config.appwriteSchema.conversationInternalNotesTableId,
      config.appwriteSchema.conversationMessagesTableId,
    ]) {
      try {
        const rows = await tables.listRows({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          queries: [Query.equal("feedbackId", [feedbackId]), Query.limit(100)],
          total: false,
        });
        for (const row of rows.rows) {
          await tables.deleteRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId,
            rowId: row.$id,
          });
        }
      } catch {
        // Cleanup continues so every independently known fixture is attempted.
      }
    }
    for (const [tableId, rowId] of createdRows.reverse()) {
      try {
        await tables.deleteRow({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          rowId,
        });
      } catch {
        // A prior cascade or retry may already have removed the row.
      }
    }
    if (createdUser) {
      try {
        await users.delete({ userId: ownerId });
      } catch {
        // Preserve the primary matrix outcome; residue check below remains authoritative.
      }
    }
    const residueChecks = await Promise.all(
      [
        config.appwriteSchema.conversationIdempotencyTableId,
        config.appwriteSchema.conversationLifecycleTableId,
        config.appwriteSchema.conversationInternalNotesTableId,
        config.appwriteSchema.conversationMessagesTableId,
      ].map(async (tableId) => {
        const rows = await tables.listRows({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          queries: [Query.equal("feedbackId", [feedbackId]), Query.limit(1)],
          total: false,
        });
        return rows.rows.length;
      }),
    );
    cleanupPassed = residueChecks.every((count) => count === 0);
  }

  if (!cleanupPassed) {
    throw new Error("APPWRITE_G3_CONVERSATION_MATRIX_FAILED");
  }
  process.stdout.write(
    `${JSON.stringify({
      result: "APPWRITE_G3_CONVERSATION_LIFECYCLE_PASSED",
      matrixPassed: true,
      directAccessDenied: true,
      cleanupPassed,
    })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "APPWRITE_G3_CONVERSATION_FAILED"}\n`,
  );
  process.exitCode = 1;
});
