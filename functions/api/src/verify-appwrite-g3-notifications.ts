import { randomBytes } from "node:crypto";

import { Client, Query, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createNodeAppwriteOutboxStore } from "./appwrite-outbox-store.js";
import { createOutboxWorker } from "./outbox.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return object(error) && error.code === 404;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) throw new Error("APPWRITE_G3_NOTIFICATION_LATENCY_EMPTY");
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply"))
    throw new Error("APPWRITE_G3_NOTIFICATIONS_APPLY_REQUIRED");
  const config = parseServerConfig(process.env);
  if (config.environment === "production")
    throw new Error("APPWRITE_G3_NOTIFICATIONS_NON_PRODUCTION_REQUIRED");
  const domain = process.env.Y7_FUNCTION_DOMAIN_URL;
  if (!domain) throw new Error("APPWRITE_G3_NOTIFICATIONS_DOMAIN_REQUIRED");

  const suffix = randomBytes(7).toString("hex");
  const ids = {
    workspace: `n3w_${suffix}`,
    project: `n3p_${suffix}`,
    feedback: `n3f_${suffix}`,
    reporter: `n3r_${suffix}`,
    owner: `n3o_${suffix}`,
    maintainer: `n3m_${suffix}`,
    ownerMembership: `n3om_${suffix}`,
    maintainerMembership: `n3mm_${suffix}`,
    assignment: `n3a_${suffix}`,
    grant: `n3g_${suffix}`,
    event: `n3e_${suffix}`,
  } as const;
  const reference = `Y7-G3-NOT-${suffix.toUpperCase()}`;
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const users = new Users(client);
  const createdRows: Array<readonly [string, string]> = [];
  const createdUsers: string[] = [];
  const protector = createSensitiveDataProtector(
    config.sensitiveDataActiveKeyId,
    Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
      id,
      material: Buffer.from(material, "base64url"),
    })),
  );
  const sensitive = { environment: config.environment, protector };
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
    await users.create({ userId, name: "G3 Notification verifier" });
    createdUsers.push(userId);
    const session = await users.createSession({ userId });
    return (await users.createJWT({ userId, sessionId: session.$id, duration: 900 }))
      .jwt;
  };
  const request = async (
    jwt: string,
    path: string,
    expected: number,
    body: unknown,
  ) => {
    const response = await fetch(new URL(path, domain).toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const payload: unknown = await response.json();
    if (response.status !== expected) {
      throw new Error(
        `APPWRITE_G3_NOTIFICATIONS_HTTP_${String(expected)}_GOT_${String(response.status)}_${JSON.stringify(payload)}`,
      );
    }
    return payload;
  };
  const seal = (field: string, value: unknown) =>
    protector.seal(
      {
        environment: config.environment,
        tableId: config.appwriteSchema.feedbackTableId,
        rowId: ids.feedback,
        field,
      },
      JSON.stringify(value),
    );
  let cleanupFailure: unknown;
  let recipientPolicyPassed = false;
  let feedPassed = false;
  let readStatePassed = false;
  let isolationPassed = false;
  let retryReconciliationPassed = false;
  let sourceFactPreserved = false;
  let sourceToVisibleP95Ms = Number.POSITIVE_INFINITY;
  let providerHandoffP95Ms = Number.POSITIVE_INFINITY;

  try {
    const now = new Date().toISOString();
    const ownerJwt = await createPrincipal(ids.owner);
    const maintainerJwt = await createPrincipal(ids.maintainer);
    await createRow(
      config.appwriteSchema.workspaceMembershipsTableId,
      ids.ownerMembership,
      {
        workspaceId: ids.workspace,
        userId: ids.owner,
        role: "workspace_owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    );
    await createRow(
      config.appwriteSchema.workspaceMembershipsTableId,
      ids.maintainerMembership,
      {
        workspaceId: ids.workspace,
        userId: ids.maintainer,
        role: "project_maintainer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    );
    await createRow(config.appwriteSchema.projectsTableId, ids.project, {
      workspaceId: ids.workspace,
      slug: `g3-not-${suffix}`,
      active: true,
      enabledTypesJson: '["bug"]',
      contextDeclarationsJson: "[]",
      reporterPurposeFr: "Vérification notifications G3",
      reporterPurposeEn: "G3 notification verification",
    });
    await createRow(config.appwriteSchema.projectAssignmentsTableId, ids.assignment, {
      workspaceId: ids.workspace,
      projectId: ids.project,
      userId: ids.maintainer,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await createRow(config.appwriteSchema.feedbackTableId, ids.feedback, {
      projectId: ids.project,
      workspaceId: ids.workspace,
      reporterId: ids.reporter,
      type: "bug",
      originalSourceJson: seal("originalSourceJson", {
        type: "bug",
        problem: "G3 notification fixture",
      }),
      currentSourceJson: seal("currentSourceJson", {
        type: "bug",
        problem: "G3 notification fixture",
      }),
      contextJson: seal("contextJson", []),
      attachmentNamesJson: seal("attachmentNamesJson", []),
      state: "under_review",
      acceptedAt: now,
      reporterHistoryJson: seal("reporterHistoryJson", []),
      reporterMessagesJson: seal("reporterMessagesJson", []),
      reporterAttachmentsJson: seal("reporterAttachmentsJson", []),
      sourceRevisionsJson: seal("sourceRevisionsJson", []),
      deletionRequestsJson: seal("deletionRequestsJson", []),
      internalNotesJson: seal("internalNotesJson", []),
      assignedMaintainerId: ids.maintainer,
    });
    await createRow(config.appwriteSchema.accessGrantsTableId, ids.grant, {
      feedbackId: ids.feedback,
      reference,
      verifier: "g3_notification_verifier",
      generation: 1,
      status: "active",
    });

    const sourceStartedAt = Date.now();
    await request(
      ownerJwt,
      `/v1/workspaces/${ids.workspace}/projects/${ids.project}/feedback/${ids.feedback}/conversation/commands`,
      201,
      {
        command: {
          kind: "append_message",
          eventId: ids.event,
          audience: "reporter",
          content: "G3 public notification message",
        },
      },
    );
    const notificationRows = await tables.listRows({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.notificationsTableId,
      queries: [Query.equal("eventId", [ids.event]), Query.limit(10)],
      total: false,
    });
    for (const row of notificationRows.rows) {
      createdRows.push([config.appwriteSchema.notificationsTableId, row.$id]);
    }
    const recipients = notificationRows.rows
      .map((row) => {
        const recipientId: unknown = row.recipientId;
        if (typeof recipientId !== "string") {
          throw new Error("APPWRITE_G3_NOTIFICATIONS_RECIPIENT_ROW_INVALID");
        }
        return recipientId;
      })
      .sort();
    if (
      recipients.length !== 2 ||
      recipients[0] !== ids.maintainer ||
      recipients[1] !== ids.reporter ||
      recipients.includes(ids.owner)
    ) {
      throw new Error("APPWRITE_G3_NOTIFICATIONS_RECIPIENT_POLICY_FAILED");
    }
    recipientPolicyPassed = true;

    const feedPath = `/v1/workspaces/${ids.workspace}/projects/${ids.project}/operations/notifications`;
    const visible = await request(maintainerJwt, `${feedPath}/list`, 200, {});
    sourceToVisibleP95Ms = percentile95([Date.now() - sourceStartedAt]);
    if (
      !object(visible) ||
      !object(visible.data) ||
      !Array.isArray(visible.data.notifications) ||
      visible.data.notifications.length !== 1 ||
      !object(visible.data.notifications[0]) ||
      visible.data.notifications[0].readAt !== null
    ) {
      throw new Error("APPWRITE_G3_NOTIFICATIONS_FEED_FAILED");
    }
    feedPassed = true;
    const maintainerNotification = visible.data.notifications[0];
    await request(maintainerJwt, `${feedPath}/read`, 200, {
      notificationId: maintainerNotification.id,
      readAt: new Date().toISOString(),
    });
    const readFeed = await request(maintainerJwt, `${feedPath}/list`, 200, {});
    if (
      !object(readFeed) ||
      !object(readFeed.data) ||
      !Array.isArray(readFeed.data.notifications) ||
      !object(readFeed.data.notifications[0]) ||
      typeof readFeed.data.notifications[0].readAt !== "string"
    ) {
      throw new Error("APPWRITE_G3_NOTIFICATIONS_READ_STATE_FAILED");
    }
    readStatePassed = true;
    await request(ownerJwt, `${feedPath}/list`, 200, {});
    await request("forged.jwt.value", `${feedPath}/list`, 404, {});
    isolationPassed = true;

    const notificationIds = notificationRows.rows.map((row) => row.$id);
    const outboxRows = await tables.listRows({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.outboxTableId,
      queries: [Query.equal("notificationId", notificationIds), Query.limit(20)],
      total: false,
    });
    const outboxIds = new Set(outboxRows.rows.map((row) => row.$id));
    for (const row of outboxRows.rows)
      createdRows.push([config.appwriteSchema.outboxTableId, row.$id]);
    if (outboxIds.size !== 3)
      throw new Error("APPWRITE_G3_NOTIFICATIONS_OUTBOX_COUNT_FAILED");
    const attempts = new Map<string, number>();
    const handoffLatencies: number[] = [];
    let logicalClock = Date.now();
    const worker = createOutboxWorker({
      store: createNodeAppwriteOutboxStore(
        tables,
        config.appwriteSchema,
        sensitive,
        outboxIds,
      ),
      sender: {
        deliver: ({ deliveryId }) => {
          handoffLatencies.push(Date.now() - sourceStartedAt);
          const attempt = (attempts.get(deliveryId) ?? 0) + 1;
          attempts.set(deliveryId, attempt);
          return Promise.resolve(
            attempt === 1 && attempts.size === 1 ? "retryable" : "delivered",
          );
        },
      },
      workerId: "g3_notification_worker",
      createLeaseToken: () => randomBytes(16).toString("base64url"),
      now: () => {
        logicalClock += 2_000;
        return new Date(logicalClock);
      },
      leaseDurationMs: 30_000,
      retryDelayMs: (attempt) => 1_000 * 2 ** (attempt - 1),
      maximumAttempts: 3,
      log: () => undefined,
    });
    for (let run = 0; run < 8; run += 1) {
      const outcome = await worker.runOnce();
      if (outcome.status === "idle") break;
    }
    const deliveredRows = await tables.listRows({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.outboxTableId,
      queries: [Query.equal("$id", [...outboxIds]), Query.limit(20)],
      total: false,
    });
    if (
      deliveredRows.rows.length !== 3 ||
      deliveredRows.rows.some((row) => row.status !== "delivered") ||
      ![...attempts.values()].some((attempt) => attempt === 2)
    ) {
      throw new Error("APPWRITE_G3_NOTIFICATIONS_RETRY_FAILED");
    }
    retryReconciliationPassed = true;
    providerHandoffP95Ms = percentile95(handoffLatencies);
    const facts = await tables.listRows({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.conversationMessagesTableId,
      queries: [Query.equal("$id", [ids.event]), Query.limit(2)],
      total: false,
    });
    if (facts.rows.length !== 1)
      throw new Error("APPWRITE_G3_NOTIFICATIONS_SOURCE_FACT_LOST");
    createdRows.push([config.appwriteSchema.conversationMessagesTableId, ids.event]);
    sourceFactPreserved = true;
    if (sourceToVisibleP95Ms > 5_000 || providerHandoffP95Ms > 30_000) {
      throw new Error("APPWRITE_G3_NOTIFICATIONS_LATENCY_BUDGET_FAILED");
    }
  } finally {
    for (const tableId of [
      config.appwriteSchema.conversationIdempotencyTableId,
      config.appwriteSchema.notificationsTableId,
      config.appwriteSchema.outboxTableId,
    ]) {
      try {
        const rows = await tables.listRows({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          queries:
            tableId === config.appwriteSchema.conversationIdempotencyTableId
              ? [Query.equal("feedbackId", [ids.feedback]), Query.limit(100)]
              : [Query.limit(100)],
          total: false,
        });
        for (const row of rows.rows) {
          if (
            tableId === config.appwriteSchema.conversationIdempotencyTableId ||
            (tableId === config.appwriteSchema.notificationsTableId &&
              row.feedbackId === ids.feedback) ||
            (tableId === config.appwriteSchema.outboxTableId &&
              createdRows.some(
                ([candidateTable, candidateId]) =>
                  candidateTable === config.appwriteSchema.outboxTableId &&
                  candidateId === row.$id,
              ))
          ) {
            createdRows.push([tableId, row.$id]);
          }
        }
      } catch (error: unknown) {
        cleanupFailure ??= error;
      }
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
      : new Error("APPWRITE_G3_NOTIFICATIONS_CLEANUP_FAILED");
  }
  console.log(
    JSON.stringify({
      result: "APPWRITE_G3_NOTIFICATIONS_PASSED",
      envelope:
        "Appwrite Preview Frankfurt / one Project / one Reporter / two Workspace actors",
      recipientPolicyPassed,
      feedPassed,
      readStatePassed,
      isolationPassed,
      retryReconciliationPassed,
      sourceFactPreserved,
      sourceToVisibleP95Ms,
      providerHandoffP95Ms,
      cleanupPassed: true,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "APPWRITE_G3_NOTIFICATIONS_FAILED",
  );
  process.exitCode = 1;
});
