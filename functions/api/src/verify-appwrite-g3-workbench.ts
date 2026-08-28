import { randomBytes } from "node:crypto";

import { Client, Query, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return object(error) && error.code === 404;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply"))
    throw new Error("APPWRITE_G3_WORKBENCH_APPLY_REQUIRED");
  const config = parseServerConfig(process.env);
  if (config.environment === "production")
    throw new Error("APPWRITE_G3_WORKBENCH_NON_PRODUCTION_REQUIRED");
  const domain = process.env.Y7_FUNCTION_DOMAIN_URL;
  if (!domain) throw new Error("APPWRITE_G3_WORKBENCH_DOMAIN_REQUIRED");

  const suffix = randomBytes(7).toString("hex");
  const workspaceId = `g3w_${suffix}`;
  const siblingWorkspaceId = `g3x_${suffix}`;
  const projectId = `g3p_${suffix}`;
  const siblingProjectId = `g3s_${suffix}`;
  const feedbackId = `g3f_${suffix}`;
  const reporterId = `g3r_${suffix}`;
  const ownerId = `g3o_${suffix}`;
  const maintainerId = `g3m_${suffix}`;
  const createdRows: Array<readonly [string, string]> = [];
  const createdUsers: string[] = [];
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const users = new Users(client);
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
  const createPrincipal = async (userId: string) => {
    await users.create({ userId, name: "G3 Workbench verifier" });
    createdUsers.push(userId);
    const session = await users.createSession({ userId });
    return (await users.createJWT({ userId, sessionId: session.$id, duration: 900 }))
      .jwt;
  };
  const seal = (field: string, value: unknown) =>
    protector.seal(
      {
        environment: config.environment,
        tableId: config.appwriteSchema.feedbackTableId,
        rowId: feedbackId,
        field,
      },
      JSON.stringify(value),
    );
  const request = async (
    jwt: string,
    method: "GET" | "POST",
    path: string,
    expected: number,
    body?: unknown,
    extraHeaders: Readonly<Record<string, string>> = {},
  ) => {
    const response = await fetch(new URL(path, domain).toString(), {
      method,
      headers: {
        authorization: `Bearer ${jwt}`,
        ...extraHeaders,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const payload: unknown = await response.json();
    if (response.status !== expected)
      throw new Error(
        `APPWRITE_G3_WORKBENCH_HTTP_${String(expected)}_GOT_${String(response.status)}_${JSON.stringify(payload)}`,
      );
    return payload;
  };
  const path = `/v1/workspaces/${workspaceId}/projects/${projectId}/workbench`;
  let ownerJwt = "";
  let maintainerJwt = "";
  let cleanupFailure: unknown;
  let scopedInbox = false;
  let detailPassed = false;
  let mutationsPassed = false;
  let isolationPassed = false;
  let removalPassed = false;
  let deletionPassed = false;
  let sessionRevocationPassed = false;
  let directAccessDenied = false;

  try {
    const now = new Date().toISOString();
    ownerJwt = await createPrincipal(ownerId);
    maintainerJwt = await createPrincipal(maintainerId);
    for (const [rowId, data] of [
      [
        `g3om_${suffix}`,
        {
          workspaceId,
          userId: ownerId,
          role: "workspace_owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ],
      [
        `g3mm_${suffix}`,
        {
          workspaceId,
          userId: maintainerId,
          role: "project_maintainer",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ],
    ] as const)
      await createRow(config.appwriteSchema.workspaceMembershipsTableId, rowId, data);
    for (const [rowId, targetWorkspace] of [
      [projectId, workspaceId],
      [siblingProjectId, siblingWorkspaceId],
    ] as const) {
      await createRow(config.appwriteSchema.projectsTableId, rowId, {
        workspaceId: targetWorkspace,
        slug: `g3-${rowId}`,
        active: true,
        enabledTypesJson: '["bug"]',
        contextDeclarationsJson: "[]",
        reporterPurposeFr: "Vérification G3",
        reporterPurposeEn: "G3 verification",
      });
    }
    await createRow(config.appwriteSchema.projectAssignmentsTableId, `g3a_${suffix}`, {
      workspaceId,
      projectId,
      userId: maintainerId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await createRow(config.appwriteSchema.feedbackTableId, feedbackId, {
      projectId,
      workspaceId,
      reporterId,
      type: "bug",
      originalSourceJson: seal("originalSourceJson", {
        type: "bug",
        problem: "G3 Workbench fixture",
      }),
      currentSourceJson: seal("currentSourceJson", {
        type: "bug",
        problem: "G3 Workbench fixture",
      }),
      contextJson: seal("contextJson", [
        {
          name: "version",
          value: "1.0",
          purpose: "Reproduce",
          source: "public",
          trust: "unverified",
        },
      ]),
      attachmentNamesJson: seal("attachmentNamesJson", ["trace.txt"]),
      state: "received",
      acceptedAt: now,
      reporterHistoryJson: seal("reporterHistoryJson", []),
      reporterMessagesJson: seal("reporterMessagesJson", []),
      reporterAttachmentsJson: seal("reporterAttachmentsJson", []),
      sourceRevisionsJson: seal("sourceRevisionsJson", []),
      deletionRequestsJson: seal("deletionRequestsJson", []),
      internalNotesJson: seal("internalNotesJson", []),
      workspaceClassification: null,
      assignedMaintainerId: maintainerId,
    });

    const ownerInbox = await request(
      ownerJwt,
      "GET",
      `${path}?type=bug&state=received&assignment=all`,
      200,
    );
    if (
      !object(ownerInbox) ||
      !Array.isArray(ownerInbox.result) ||
      ownerInbox.result.length !== 1
    )
      throw new Error("APPWRITE_G3_WORKBENCH_INBOX_INVALID");
    scopedInbox = true;
    const detail = await request(maintainerJwt, "GET", `${path}/${feedbackId}`, 200);
    if (
      !object(detail) ||
      !object(detail.result) ||
      detail.result.classification !== null ||
      !Array.isArray(detail.result.context)
    )
      throw new Error("APPWRITE_G3_WORKBENCH_DETAIL_INVALID");
    detailPassed = true;

    const classify = {
      kind: "classify_feedback",
      operationId: `g3c_${suffix}`,
      classification: "Performance",
    };
    await request(maintainerJwt, "POST", `${path}/${feedbackId}`, 200, classify);
    await request(maintainerJwt, "POST", `${path}/${feedbackId}`, 200, classify);
    await request(maintainerJwt, "POST", `${path}/${feedbackId}`, 409, {
      ...classify,
      classification: "Reliability",
    });
    mutationsPassed = true;

    await request(
      ownerJwt,
      "GET",
      `/v1/workspaces/${workspaceId}/projects/${siblingProjectId}/workbench/${feedbackId}`,
      404,
    );
    await request(
      ownerJwt,
      "GET",
      `/v1/workspaces/${siblingWorkspaceId}/projects/${projectId}/workbench/${feedbackId}`,
      404,
    );
    await request(ownerJwt, "GET", `${path}/${feedbackId}`, 404, undefined, {
      "x-appwrite-user-id": ownerId,
    });
    isolationPassed = true;

    await request(ownerJwt, "POST", `${path}/${feedbackId}`, 200, {
      kind: "unassign_feedback",
      operationId: `g3u_${suffix}`,
    });
    await request(maintainerJwt, "GET", `${path}/${feedbackId}`, 404);
    const unassigned = await request(
      ownerJwt,
      "GET",
      `${path}?assignment=unassigned`,
      200,
    );
    if (
      !object(unassigned) ||
      !Array.isArray(unassigned.result) ||
      unassigned.result.length !== 1
    )
      throw new Error("APPWRITE_G3_WORKBENCH_UNASSIGNED_INVALID");
    removalPassed = true;

    await request(ownerJwt, "POST", `${path}/${feedbackId}`, 200, {
      kind: "delete_feedback",
      operationId: `g3d_${suffix}`,
    });
    await request(ownerJwt, "GET", `${path}/${feedbackId}`, 404);
    const deletedInbox = await request(ownerJwt, "GET", path, 200);
    if (
      !object(deletedInbox) ||
      !Array.isArray(deletedInbox.result) ||
      deletedInbox.result.length !== 0
    )
      throw new Error("APPWRITE_G3_WORKBENCH_DELETED_VISIBLE");
    deletionPassed = true;

    const directTables = new TablesDB(
      new Client()
        .setEndpoint(config.appwriteEndpoint)
        .setProject(config.appwriteProjectId)
        .setJWT(ownerJwt),
    );
    try {
      const visible = await directTables.listRows({
        databaseId: config.appwriteSchema.databaseId,
        tableId: config.appwriteSchema.feedbackTableId,
        total: false,
      });
      if (visible.rows.length > 0)
        throw new Error("APPWRITE_G3_WORKBENCH_DIRECT_ACCESS_ALLOWED");
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === "APPWRITE_G3_WORKBENCH_DIRECT_ACCESS_ALLOWED"
      )
        throw error;
    }
    directAccessDenied = true;
    await users.delete({ userId: ownerId });
    createdUsers.splice(createdUsers.indexOf(ownerId), 1);
    await request(ownerJwt, "GET", path, 404);
    sessionRevocationPassed = true;
  } finally {
    try {
      const rows = await tables.listRows({
        databaseId: config.appwriteSchema.databaseId,
        tableId: config.appwriteSchema.conversationIdempotencyTableId,
        queries: [Query.equal("feedbackId", [feedbackId]), Query.limit(100)],
        total: false,
      });
      for (const row of rows.rows)
        createdRows.push([
          config.appwriteSchema.conversationIdempotencyTableId,
          row.$id,
        ]);
    } catch (error: unknown) {
      cleanupFailure ??= error;
    }
    for (const [tableId, rowId] of [
      ...new Map(createdRows.map((row) => [row.join("\0"), row])).values(),
    ].reverse()) {
      try {
        await tables.deleteRow({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          rowId,
        });
      } catch (error: unknown) {
        if (!absent(error)) cleanupFailure ??= error;
      }
    }
    for (const userId of createdUsers.reverse()) {
      try {
        await users.delete({ userId });
      } catch (error: unknown) {
        if (!absent(error)) cleanupFailure ??= error;
      }
    }
  }
  if (cleanupFailure) {
    throw cleanupFailure instanceof Error
      ? cleanupFailure
      : new Error("APPWRITE_G3_WORKBENCH_CLEANUP_FAILED");
  }
  console.log(
    JSON.stringify({
      result: "APPWRITE_G3_WORKBENCH_PASSED",
      scopedInbox,
      detailPassed,
      mutationsPassed,
      isolationPassed,
      removalPassed,
      deletionPassed,
      sessionRevocationPassed,
      directAccessDenied,
      cleanupPassed: true,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "APPWRITE_G3_WORKBENCH_FAILED",
  );
  process.exitCode = 1;
});
