import { randomBytes } from "node:crypto";

import { Client, Query, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

const workspaceId = "workspace_alpha";

function absent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Number(error.code) === 404
  );
}

function authority() {
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("DEPLOYED_SMOKE_PREVIEW_REQUIRED");
  }
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  return {
    config,
    tables: new TablesDB(client),
    users: new Users(client),
  };
}

async function createWebPlatform(platformId: string): Promise<void> {
  const { config } = authority();
  const previewUrl = process.env.Y7_DEPLOYED_PREVIEW_URL;
  if (!previewUrl) throw new Error("DEPLOYED_PREVIEW_URL_REQUIRED");
  const hostname = new URL(previewUrl).hostname;
  if (!hostname.endsWith(".vercel.app")) {
    throw new Error("DEPLOYED_PREVIEW_HOST_INVALID");
  }
  const response = await fetch(
    `${config.appwriteEndpoint}/projects/${config.appwriteProjectId}/platforms`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Key": config.appwriteApiKey,
        "X-Appwrite-Project": config.appwriteProjectId,
      },
      body: JSON.stringify({
        platformId,
        type: "web",
        name: "Deployed Preview smoke",
        hostname,
      }),
    },
  );
  if (response.status !== 201) throw new Error("DEPLOYED_SMOKE_PLATFORM_CREATE_FAILED");
}

async function deleteWebPlatform(platformId: string): Promise<void> {
  const { config } = authority();
  const response = await fetch(
    `${config.appwriteEndpoint}/projects/${config.appwriteProjectId}/platforms/${platformId}`,
    {
      method: "DELETE",
      headers: {
        "X-Appwrite-Key": config.appwriteApiKey,
        "X-Appwrite-Project": config.appwriteProjectId,
      },
    },
  );
  if (response.status !== 204 && response.status !== 404) {
    throw new Error("DEPLOYED_SMOKE_PLATFORM_DELETE_FAILED");
  }
}

export async function createDeployedSmokeFixture(): Promise<void> {
  const { config, tables, users } = authority();
  const suffix = randomBytes(7).toString("hex");
  const userId = `smoke_user_${suffix}`;
  const platformId = `smoke_web_${suffix}`;
  const membershipId = `smoke_member_${suffix}`;
  const projectId = `smoke_project_${suffix}`;
  const operationId = `smoke_operation_${suffix}`;
  const slug = `deployed-smoke-${suffix}`;
  const email = `deployed-smoke-${suffix}@example.test`;
  const password = `Y7-${randomBytes(18).toString("base64url")}`;

  await createWebPlatform(platformId);
  try {
    await users.create({
      userId,
      email,
      password,
      name: "Deployed Preview smoke",
    });
    const now = new Date().toISOString();
    await tables.createRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.workspaceMembershipsTableId,
      rowId: membershipId,
      data: {
        workspaceId,
        userId,
        role: "workspace_owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      permissions: [],
    });
  } catch (error: unknown) {
    let cleanupFailure: unknown;
    try {
      await users.delete({ userId });
    } catch (cleanupError: unknown) {
      if (!absent(cleanupError)) cleanupFailure = cleanupError;
    }
    try {
      await deleteWebPlatform(platformId);
    } catch (cleanupError: unknown) {
      cleanupFailure ??= cleanupError;
    }
    if (cleanupFailure !== undefined) {
      throw new AggregateError(
        [error, cleanupFailure],
        "DEPLOYED_SMOKE_SETUP_AND_CLEANUP_FAILED",
      );
    }
    throw error;
  }

  Object.assign(process.env, {
    Y7_SMOKE_EMAIL: email,
    Y7_SMOKE_MEMBERSHIP_ID: membershipId,
    Y7_SMOKE_OPERATION_ID: operationId,
    Y7_SMOKE_PASSWORD: password,
    Y7_SMOKE_PLATFORM_ID: platformId,
    Y7_SMOKE_PROJECT_ID: projectId,
    Y7_SMOKE_SLUG: slug,
    Y7_SMOKE_USER_ID: userId,
    Y7_SMOKE_WORKSPACE_ID: workspaceId,
  });
}

export async function deleteDeployedSmokeFixture(): Promise<void> {
  const { config, tables, users } = authority();
  const projectId = process.env.Y7_SMOKE_PROJECT_ID;
  const membershipId = process.env.Y7_SMOKE_MEMBERSHIP_ID;
  const platformId = process.env.Y7_SMOKE_PLATFORM_ID;
  const userId = process.env.Y7_SMOKE_USER_ID;
  if (!projectId || !membershipId || !platformId || !userId) return;

  let cleanupFailure: unknown;
  const rows: Array<readonly [string, string]> = [];
  for (const tableId of [
    config.appwriteSchema.administrationIdempotencyTableId,
    config.appwriteSchema.administrationAuditTableId,
    config.appwriteSchema.projectAssignmentsTableId,
    config.appwriteSchema.projectSlugsTableId,
  ]) {
    try {
      const result = await tables.listRows({
        databaseId: config.appwriteSchema.databaseId,
        tableId,
        queries: [Query.equal("projectId", [projectId]), Query.limit(100)],
        total: false,
      });
      rows.push(...result.rows.map((row) => [tableId, row.$id] as const));
    } catch (error: unknown) {
      cleanupFailure ??= error;
    }
  }
  rows.push(
    [config.appwriteSchema.projectsTableId, projectId],
    [config.appwriteSchema.workspaceMembershipsTableId, membershipId],
  );
  for (const [tableId, rowId] of rows.reverse()) {
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
  try {
    await users.delete({ userId });
  } catch (error: unknown) {
    if (!absent(error)) cleanupFailure ??= error;
  }
  try {
    await deleteWebPlatform(platformId);
  } catch (error: unknown) {
    cleanupFailure ??= error;
  }
  if (cleanupFailure !== undefined) {
    throw new Error("DEPLOYED_SMOKE_CLEANUP_FAILED");
  }
}
