import { randomBytes } from "node:crypto";

import { Client, Query, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createHttpFunctionPublicApi } from "./http-function-public-api.js";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return object(error) && error.code === 404;
}

function denied(error: unknown): boolean {
  return object(error) && [401, 403, 404].includes(Number(error.code));
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("APPWRITE_G3_ADMIN_APPLY_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("APPWRITE_G3_ADMIN_NON_PRODUCTION_REQUIRED");
  }
  const domain = process.env.Y7_FUNCTION_DOMAIN_URL;
  if (!domain) throw new Error("APPWRITE_G3_ADMIN_DOMAIN_REQUIRED");

  const suffix = randomBytes(7).toString("hex");
  const ownerId = `g3_owner_${suffix}`;
  const maintainerId = `g3_maint_${suffix}`;
  const unassignedId = `g3_none_${suffix}`;
  const projectId = `g3_project_${suffix}`;
  const initialSlug = `g3-${suffix}`;
  const renamedSlug = `g3-renamed-${suffix}`;
  const ownerMembershipId = `g3_om_${suffix}`;
  const maintainerMembershipId = `g3_mm_${suffix}`;
  const operationIds: string[] = [];
  const createdRows: Array<readonly [string, string]> = [];
  const createdUsers: string[] = [];
  let cleanupFailure: unknown;

  const adminClient = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(adminClient);
  const users = new Users(adminClient);
  const api = createHttpFunctionPublicApi({ baseUrl: domain, fetch });

  const createPrincipal = async (userId: string) => {
    await users.create({ userId, name: "G3 administration verification" });
    createdUsers.push(userId);
    const session = await users.createSession({ userId });
    const token = await users.createJWT({
      userId,
      sessionId: session.$id,
      duration: 900,
    });
    return token.jwt;
  };
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
  const operation = (name: string) => {
    const id = `g3_${name}_${suffix}`;
    operationIds.push(id);
    return id;
  };
  const request = async (
    jwt: string,
    command: Readonly<Record<string, unknown>>,
    expected: number,
  ) => {
    const workspaceId = String(command.workspaceId);
    const creation = command.kind === "create_project";
    const path = creation
      ? `/v1/workspaces/${workspaceId}/projects`
      : `/v1/workspaces/${workspaceId}/projects/${String(command.projectId)}/commands`;
    const response = await api.handle({
      method: "POST",
      path,
      headers: { authorization: `Bearer ${jwt}` },
      body: command,
    });
    if (response?.statusCode !== expected) {
      const outcome = object(response?.body) ? response.body.error : undefined;
      throw new Error(
        `APPWRITE_G3_ADMIN_HTTP_${String(expected)}_GOT_${String(response?.statusCode)}_${typeof outcome === "string" ? outcome : "UNKNOWN"}`,
      );
    }
    return response.body;
  };
  const base = (kind: string, operationId: string) => ({
    kind,
    operationId,
    workspaceId: "workspace_alpha",
    projectId,
  });

  let ownerCreated = false;
  let replayed = false;
  let conflictDenied = false;
  let roleIsolation = false;
  let mutations = false;
  let directAccessDenied = false;

  try {
    const now = new Date().toISOString();
    const ownerJwt = await createPrincipal(ownerId);
    const maintainerJwt = await createPrincipal(maintainerId);
    const unassignedJwt = await createPrincipal(unassignedId);
    await createRow(
      config.appwriteSchema.workspaceMembershipsTableId,
      ownerMembershipId,
      {
        workspaceId: "workspace_alpha",
        userId: ownerId,
        role: "workspace_owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    );
    await createRow(
      config.appwriteSchema.workspaceMembershipsTableId,
      maintainerMembershipId,
      {
        workspaceId: "workspace_alpha",
        userId: maintainerId,
        role: "project_maintainer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    );

    const createOperation = operation("create");
    const createCommand = {
      ...base("create_project", createOperation),
      slug: initialSlug,
      enabledTypes: ["bug", "suggestion", "review"],
      contextDeclarations: [],
      reporterPurpose: { fr: "Vérification G3", en: "G3 verification" },
    };
    await request(ownerJwt, createCommand, 201);
    ownerCreated = true;
    await request(ownerJwt, createCommand, 201);
    replayed = true;
    await request(ownerJwt, { ...createCommand, slug: `${initialSlug}-conflict` }, 409);
    conflictDenied = true;

    const deniedCommand = {
      ...base("set_project_activation", operation("denied")),
      active: false,
    };
    await request(maintainerJwt, deniedCommand, 403);
    await request(
      unassignedJwt,
      { ...deniedCommand, operationId: operation("unassigned") },
      403,
    );
    await request(
      ownerJwt,
      {
        ...deniedCommand,
        operationId: operation("cross"),
        workspaceId: "workspace_beta",
      },
      403,
    );
    roleIsolation = true;

    await request(
      ownerJwt,
      {
        ...base("configure_project", operation("configure")),
        enabledTypes: ["bug", "review"],
        contextDeclarations: [
          { name: "version", type: "string", purpose: "Reproduce" },
        ],
        reporterPurpose: { fr: "But G3", en: "G3 purpose" },
      },
      200,
    );
    await request(
      ownerJwt,
      { ...base("rename_project", operation("rename")), slug: renamedSlug },
      200,
    );
    await request(
      ownerJwt,
      { ...base("set_project_activation", operation("deactivate")), active: false },
      200,
    );
    await request(
      ownerJwt,
      { ...base("set_project_activation", operation("reactivate")), active: true },
      200,
    );
    await request(
      ownerJwt,
      { ...base("assign_maintainer", operation("assign")), maintainerId },
      200,
    );
    await request(
      ownerJwt,
      { ...base("remove_maintainer", operation("remove")), maintainerId },
      200,
    );
    mutations = true;

    const clientTables = new TablesDB(
      new Client()
        .setEndpoint(config.appwriteEndpoint)
        .setProject(config.appwriteProjectId)
        .setJWT(ownerJwt),
    );
    for (const tableId of [
      config.appwriteSchema.projectsTableId,
      config.appwriteSchema.administrationAuditTableId,
      config.appwriteSchema.administrationIdempotencyTableId,
    ]) {
      try {
        const visible = await clientTables.listRows({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          total: false,
        });
        if (visible.rows.length !== 0) {
          throw new Error("APPWRITE_G3_ADMIN_DIRECT_ACCESS_ALLOWED");
        }
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.message === "APPWRITE_G3_ADMIN_DIRECT_ACCESS_ALLOWED"
        ) {
          throw error;
        }
        if (!denied(error)) throw error;
      }
    }
    directAccessDenied = true;
  } finally {
    for (const tableId of [
      config.appwriteSchema.administrationIdempotencyTableId,
      config.appwriteSchema.administrationAuditTableId,
      config.appwriteSchema.projectAssignmentsTableId,
      config.appwriteSchema.projectSlugsTableId,
    ]) {
      try {
        const rows = await tables.listRows({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          queries: [Query.equal("projectId", [projectId]), Query.limit(100)],
          total: false,
        });
        for (const row of rows.rows) createdRows.push([tableId, row.$id]);
      } catch (error: unknown) {
        cleanupFailure ??= error;
      }
    }
    createdRows.push([config.appwriteSchema.projectsTableId, projectId]);
    const uniqueRows = [
      ...new Map(createdRows.map((row) => [row.join("\0"), row])).values(),
    ];
    for (const [tableId, rowId] of uniqueRows.reverse()) {
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

  if (cleanupFailure !== undefined) {
    throw new Error("APPWRITE_G3_ADMIN_CLEANUP_FAILED");
  }
  process.stdout.write(
    `${JSON.stringify({
      status: "ok",
      environment: config.environment,
      ownerCreated,
      replayed,
      conflictDenied,
      roleIsolation,
      mutations,
      directAccessDenied,
      cleaned: true,
    })}\n`,
  );
}

await main();
