import { randomBytes } from "node:crypto";

import { Client, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createNodeAppwritePrincipalVerifier } from "./appwrite-principal-verifier.js";
import { createNodeAppwriteWorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope.js";
import { createNodeAppwriteWorkspaceProjectOperationPorts } from "./appwrite-workspace-project-ports.js";
import { createHttpFunctionPublicApi } from "./http-function-public-api.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";
import {
  createWorkspaceProjectOperations,
  type WorkspaceOperationOutcome,
} from "./workspace-project-operations.js";

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return isObject(error) && error.code === 404;
}

function okData(outcome: WorkspaceOperationOutcome, code: string) {
  if (outcome.status !== "ok" || !isObject(outcome.data)) throw new Error(code);
  return outcome.data;
}

function expectDenied(outcome: WorkspaceOperationOutcome, code: string): void {
  if (outcome.status !== "denied") throw new Error(code);
}

function expectOk(outcome: WorkspaceOperationOutcome, code: string): void {
  if (outcome.status !== "ok") throw new Error(code);
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("APPWRITE_WORKSPACE_OPERATIONS_APPLY_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("APPWRITE_WORKSPACE_OPERATIONS_NON_PRODUCTION_REQUIRED");
  }

  const suffix = randomBytes(8).toString("hex");
  const ownerUserId = `wop_owner_${suffix}`;
  const maintainerUserId = `wop_maint_${suffix}`;
  const ownerMembershipId = `wop_om_${suffix}`;
  const maintainerMembershipId = `wop_mm_${suffix}`;
  const assignmentId = `wop_asn_${suffix}`;
  const feedbackA = `wop_fa_${suffix}`;
  const feedbackB = `wop_fb_${suffix}`;
  const ownerCreatedId = `wop_oc_${suffix}`;
  const maintainerCreatedId = `wop_mc_${suffix}`;
  const notificationA = `wop_na_${suffix}`;
  const notificationB = `wop_nb_${suffix}`;
  const createdRows: Array<readonly [string, string]> = [];
  const allRows: Array<readonly [string, string]> = [];
  const createdUsers: string[] = [];
  let cleanupFailure: unknown;

  const admin = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(admin);
  const users = new Users(admin);
  const sensitive = createSensitiveDataProtector(
    config.sensitiveDataActiveKeyId,
    Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
      id,
      material: Buffer.from(material, "base64url"),
    })),
  );
  const rowIds = [ownerCreatedId, maintainerCreatedId];
  const ports = createNodeAppwriteWorkspaceProjectOperationPorts(
    tables,
    {
      databaseId: config.appwriteSchema.databaseId,
      feedbackTableId: config.appwriteSchema.feedbackTableId,
      notificationsTableId: config.appwriteSchema.notificationsTableId,
      notificationSignalsTableId: config.appwriteSchema.notificationSignalsTableId,
    },
    () => {
      const id = rowIds.shift();
      if (!id) throw new Error("APPWRITE_WORKSPACE_OPERATIONS_ID_SEQUENCE");
      return id;
    },
  );
  const operations = createWorkspaceProjectOperations(
    createNodeAppwritePrincipalVerifier({
      endpoint: config.appwriteEndpoint,
      projectId: config.appwriteProjectId,
    }),
    createNodeAppwriteWorkspaceCapabilityScopeResolver(tables, {
      databaseId: config.appwriteSchema.databaseId,
      projectsTableId: config.appwriteSchema.projectsTableId,
      workspaceMembershipsTableId: config.appwriteSchema.workspaceMembershipsTableId,
      projectAssignmentsTableId: config.appwriteSchema.projectAssignmentsTableId,
    }),
    ports,
  );

  const feedbackData = (
    rowId: string,
    workspaceId: string,
    projectId: string,
  ): Readonly<Record<string, unknown>> => {
    const seal = (field: string, value: unknown) =>
      sensitive.seal(
        {
          environment: config.environment,
          tableId: config.appwriteSchema.feedbackTableId,
          rowId,
          field,
        },
        JSON.stringify(value),
      );
    return {
      workspaceId,
      projectId,
      reporterId: `wop_r_${suffix}`,
      type: "bug",
      originalSourceJson: seal("originalSourceJson", { type: "bug" }),
      currentSourceJson: seal("currentSourceJson", { type: "bug" }),
      contextJson: seal("contextJson", []),
      attachmentNamesJson: seal("attachmentNamesJson", []),
      state: "received",
      acceptedAt: new Date().toISOString(),
      reporterHistoryJson: seal("reporterHistoryJson", []),
      reporterMessagesJson: seal("reporterMessagesJson", []),
      reporterAttachmentsJson: seal("reporterAttachmentsJson", []),
      sourceRevisionsJson: seal("sourceRevisionsJson", []),
      deletionRequestsJson: seal("deletionRequestsJson", []),
      internalNotesJson: seal("internalNotesJson", []),
      workspaceClassification: null,
    };
  };
  const feedbackCommand = (rowId: string) =>
    Object.fromEntries(
      Object.entries(feedbackData(rowId, "workspace_alpha", "project_alpha")).filter(
        ([key]) => key !== "workspaceId" && key !== "projectId",
      ),
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
    allRows.push([tableId, rowId]);
  };

  const principal = async (userId: string) => {
    await users.create({ userId, name: "Workspace operation matrix principal" });
    createdUsers.push(userId);
    const session = await users.createSession({ userId });
    const token = await users.createJWT({
      userId,
      sessionId: session.$id,
      duration: 900,
    });
    return token.jwt;
  };

  const request = (jwt: string, workspaceId: string, projectId: string) => ({
    jwt,
    workspaceId,
    projectId,
  });

  let ownerExactScope = false;
  let crossScopeDenied = false;
  let maintainerAssigned = false;
  let removalDenied = false;
  let crud = false;
  let search = false;
  let aggregate = false;
  let notifications = false;
  let realtime = false;
  let deployed = false;

  try {
    const now = new Date().toISOString();
    await createRow(
      config.appwriteSchema.feedbackTableId,
      feedbackA,
      feedbackData(feedbackA, "workspace_alpha", "project_alpha"),
    );
    await createRow(
      config.appwriteSchema.feedbackTableId,
      feedbackB,
      feedbackData(feedbackB, "workspace_beta", "project_beta"),
    );
    await createRow(config.appwriteSchema.notificationsTableId, notificationA, {
      feedbackId: feedbackA,
      reporterId: `wop_r_${suffix}`,
      kind: "workspace_operation_probe",
      reference: `WOPA-${suffix}`,
      createdAt: now,
    });
    await createRow(config.appwriteSchema.notificationsTableId, notificationB, {
      feedbackId: feedbackB,
      reporterId: `wop_rb_${suffix}`,
      kind: "workspace_operation_probe",
      reference: `WOPB-${suffix}`,
      createdAt: now,
    });
    const ownerJwt = await principal(ownerUserId);
    const maintainerJwt = await principal(maintainerUserId);
    await createRow(
      config.appwriteSchema.workspaceMembershipsTableId,
      ownerMembershipId,
      {
        workspaceId: "workspace_alpha",
        userId: ownerUserId,
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
        userId: maintainerUserId,
        role: "project_maintainer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    );

    const ownerA = request(ownerJwt, "workspace_alpha", "project_alpha");
    const ownerB = request(ownerJwt, "workspace_beta", "project_beta");
    okData(
      await operations.readFeedback({ ...ownerA, feedbackId: feedbackA }),
      "OWN_READ",
    );
    const searchData = okData(
      await operations.searchFeedback({ ...ownerA, query: feedbackA }),
      "OWN_SEARCH",
    );
    if (!Array.isArray(searchData.ids) || !searchData.ids.includes(feedbackA)) {
      throw new Error("OWN_SEARCH_RESULT");
    }
    search = true;
    const aggregateData = okData(await operations.aggregateFeedback(ownerA), "OWN_AGG");
    if (typeof aggregateData.count !== "number" || aggregateData.count < 1) {
      throw new Error("OWN_AGG_RESULT");
    }
    aggregate = true;
    const notificationData = okData(
      await operations.listNotifications(ownerA),
      "OWN_NOTIFICATIONS",
    );
    if (
      !Array.isArray(notificationData.ids) ||
      !notificationData.ids.includes(notificationA) ||
      notificationData.ids.includes(notificationB)
    ) {
      throw new Error("OWN_NOTIFICATION_RESULT");
    }
    notifications = true;
    const realtimeData = okData(
      await operations.authorizeRealtime(ownerA),
      "OWN_REALTIME",
    );
    if (realtimeData.channel !== "workspace.workspace_alpha.project.project_alpha") {
      throw new Error("OWN_REALTIME_RESULT");
    }
    realtime = true;
    ownerExactScope = true;

    const crossOutcomes = await Promise.all([
      operations.createFeedback({
        ...ownerB,
        command: feedbackCommand(ownerCreatedId),
      }),
      operations.readFeedback({ ...ownerB, feedbackId: feedbackA }),
      operations.updateFeedback({
        ...ownerB,
        feedbackId: feedbackA,
        command: { state: "closed" },
      }),
      operations.deleteFeedback({ ...ownerB, feedbackId: feedbackA }),
      operations.searchFeedback({ ...ownerB, query: feedbackA }),
      operations.aggregateFeedback(ownerB),
      operations.listNotifications(ownerB),
      operations.authorizeRealtime(ownerB),
    ]);
    if (crossOutcomes.some((outcome) => outcome.status !== "denied")) {
      throw new Error("OWN_CROSS_SCOPE");
    }
    crossScopeDenied = true;

    const created = okData(
      await operations.createFeedback({
        ...ownerA,
        command: feedbackCommand(ownerCreatedId),
      }),
      "OWN_CREATE",
    );
    if (created.id !== ownerCreatedId) throw new Error("OWN_CREATE_RESULT");
    createdRows.push([config.appwriteSchema.feedbackTableId, ownerCreatedId]);
    allRows.push([config.appwriteSchema.feedbackTableId, ownerCreatedId]);
    okData(
      await operations.updateFeedback({
        ...ownerA,
        feedbackId: ownerCreatedId,
        command: { state: "under_review" },
      }),
      "OWN_UPDATE",
    );
    expectOk(
      await operations.deleteFeedback({ ...ownerA, feedbackId: ownerCreatedId }),
      "OWN_DELETE_OPERATION",
    );
    const ownerCreatedIndex = createdRows.findIndex(
      (entry) => entry[1] === ownerCreatedId,
    );
    if (ownerCreatedIndex < 0) throw new Error("OWN_CREATE_TRACKING");
    createdRows.splice(ownerCreatedIndex, 1);
    expectDenied(
      await operations.readFeedback({ ...ownerA, feedbackId: ownerCreatedId }),
      "OWN_DELETE",
    );
    crud = true;

    const maintainerA = request(maintainerJwt, "workspace_alpha", "project_alpha");
    expectDenied(
      await operations.readFeedback({ ...maintainerA, feedbackId: feedbackA }),
      "MAINTAINER_UNASSIGNED",
    );
    await createRow(config.appwriteSchema.projectAssignmentsTableId, assignmentId, {
      workspaceId: "workspace_alpha",
      projectId: "project_alpha",
      userId: maintainerUserId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    okData(
      await operations.readFeedback({ ...maintainerA, feedbackId: feedbackA }),
      "MAINTAINER_READ",
    );
    okData(
      await operations.createFeedback({
        ...maintainerA,
        command: feedbackCommand(maintainerCreatedId),
      }),
      "MAINTAINER_CREATE",
    );
    createdRows.push([config.appwriteSchema.feedbackTableId, maintainerCreatedId]);
    allRows.push([config.appwriteSchema.feedbackTableId, maintainerCreatedId]);
    expectOk(
      await operations.deleteFeedback({
        ...maintainerA,
        feedbackId: maintainerCreatedId,
      }),
      "MAINTAINER_DELETE",
    );
    const maintainerCreatedIndex = createdRows.findIndex(
      (entry) => entry[1] === maintainerCreatedId,
    );
    if (maintainerCreatedIndex < 0) throw new Error("MAINTAINER_CREATE_TRACKING");
    createdRows.splice(maintainerCreatedIndex, 1);
    maintainerAssigned = true;
    await tables.updateRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.projectAssignmentsTableId,
      rowId: assignmentId,
      data: { status: "removed", updatedAt: new Date().toISOString() },
    });
    for (const outcome of await Promise.all([
      operations.readFeedback({ ...maintainerA, feedbackId: feedbackA }),
      operations.searchFeedback({ ...maintainerA, query: feedbackA }),
      operations.aggregateFeedback(maintainerA),
      operations.listNotifications(maintainerA),
      operations.authorizeRealtime(maintainerA),
    ])) {
      expectDenied(outcome, "MAINTAINER_REMOVAL");
    }
    removalDenied = true;

    if (process.argv.includes("--domain")) {
      const domain = process.env.Y7_FUNCTION_DOMAIN_URL;
      if (!domain) throw new Error("APPWRITE_WORKSPACE_OPERATIONS_DOMAIN_REQUIRED");
      const deployedApi = createHttpFunctionPublicApi({
        baseUrl: domain,
        fetch: globalThis.fetch,
      });
      const deployedRequest = (path: string, body: unknown, jwt = ownerJwt) =>
        deployedApi.handle({
          method: "POST",
          path: `/v1/workspaces/workspace_alpha/projects/project_alpha/operations/${path}`,
          headers: { authorization: `Bearer ${jwt}` },
          body,
        });
      for (const response of await Promise.all([
        deployedRequest("feedback/read", { feedbackId: feedbackA }),
        deployedRequest("feedback/search", { query: feedbackA }),
        deployedRequest("feedback/aggregate", {}),
        deployedRequest("notifications/list", {}),
        deployedRequest("realtime/authorize", {}),
      ])) {
        if (response?.statusCode !== 200) {
          throw new Error("APPWRITE_WORKSPACE_OPERATIONS_DEPLOYED_ALLOWED");
        }
      }
      const cross = await deployedApi.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_beta/projects/project_beta/operations/feedback/read",
        headers: { authorization: `Bearer ${ownerJwt}` },
        body: { feedbackId: feedbackB },
      });
      if (cross?.statusCode !== 404) {
        throw new Error("APPWRITE_WORKSPACE_OPERATIONS_DEPLOYED_DENIAL");
      }
      deployed = true;
    }
  } finally {
    for (const [tableId, rowId] of [...createdRows].reverse()) {
      try {
        await tables.deleteRow({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          rowId,
        });
      } catch (error: unknown) {
        if (!absent(error) && cleanupFailure === undefined) cleanupFailure = error;
      }
    }
    for (const userId of [...createdUsers].reverse()) {
      try {
        await users.delete({ userId });
      } catch (error: unknown) {
        if (!absent(error) && cleanupFailure === undefined) cleanupFailure = error;
      }
    }
  }

  for (const [tableId, rowId] of allRows) {
    try {
      await tables.getRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId,
        rowId,
      });
      cleanupFailure ??= new Error("APPWRITE_WORKSPACE_OPERATIONS_ROW_RESIDUE");
    } catch (error: unknown) {
      if (!absent(error)) cleanupFailure ??= error;
    }
  }
  for (const userId of createdUsers) {
    try {
      await users.get({ userId });
      cleanupFailure ??= new Error("APPWRITE_WORKSPACE_OPERATIONS_USER_RESIDUE");
    } catch (error: unknown) {
      if (!absent(error)) cleanupFailure ??= error;
    }
  }
  if (cleanupFailure !== undefined) {
    throw new Error("APPWRITE_WORKSPACE_OPERATIONS_CLEANUP_FAILED");
  }
  process.stdout.write(
    `${JSON.stringify({
      status: "ok",
      environment: config.environment,
      ownerExactScope,
      crossScopeDenied,
      maintainerAssigned,
      removalDenied,
      crud,
      search,
      aggregate,
      notifications,
      realtime,
      deployed,
      cleaned: true,
    })}\n`,
  );
}

await main();
