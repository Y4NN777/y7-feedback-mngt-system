import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Client, Query, Storage, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createHttpApplication } from "./application.js";
import {
  appwriteG1SyntheticRows,
  type AppwriteG1MatrixIds,
} from "./appwrite-g1-matrix.js";
import { createNodeAppwritePrivacyCleanup } from "./appwrite-privacy-cleanup.js";
import { createNodeAppwritePrivacyPurgeRepository } from "./appwrite-privacy-purge-repository.js";
import { createNodeAppwriteProviderIssueStateStore } from "./appwrite-provider-issue-state-store.js";
import { createPrivacyPurgeWorker } from "./privacy-cleanup.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return object(error) && error.code === 404;
}

function ids(prefix: string, suffix: string): AppwriteG1MatrixIds {
  return {
    feedbackId: `${prefix}f_${suffix}`,
    reporterId: `${prefix}r_${suffix}`,
    notificationId: `${prefix}n_${suffix}`,
    lifecycleId: `${prefix}l_${suffix}`,
    outboxId: `${prefix}o_${suffix}`,
  };
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply"))
    throw new Error("APPWRITE_G4_PRIVACY_APPLY_REQUIRED");
  const config = parseServerConfig(process.env);
  if (config.environment !== "preview")
    throw new Error("APPWRITE_G4_PRIVACY_PREVIEW_REQUIRED");
  const domain = process.env.Y7_FUNCTION_DOMAIN_URL;
  if (!domain) throw new Error("APPWRITE_G4_PRIVACY_DOMAIN_REQUIRED");

  const suffix = randomBytes(6).toString("hex");
  const restoreIds = ids("g4pr", suffix);
  const purgeIds = ids("g4pp", suffix);
  const siblingIds = ids("g4ps", suffix);
  const fixtures = [restoreIds, purgeIds, siblingIds] as const;
  const operations = fixtures.map(() => randomUUID());
  const idQueue = fixtures.flatMap((fixture) => [
    fixture.feedbackId,
    fixture.reporterId,
    fixture.lifecycleId,
    fixture.notificationId,
    fixture.outboxId,
  ]);
  let clock = new Date();
  let referenceIndex = 0;
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const storage = new Storage(client);
  const users = new Users(client);
  const application = createHttpApplication(config, {
    tables,
    storage,
    createId: () => idQueue.shift() ?? `g4px_${randomBytes(12).toString("hex")}`,
    createReference: () =>
      `Y7-G4-PRIV-${suffix.toUpperCase()}-${String(++referenceIndex)}`,
    createCorrelationId: randomUUID,
    nowIso: () => clock.toISOString(),
    nowMs: () => clock.valueOf(),
    startedAt: Date.now,
  });
  if (!application.publicApi || !application.privacy)
    throw new Error("APPWRITE_G4_PRIVACY_APPLICATION_INVALID");

  const protector = createSensitiveDataProtector(
    config.sensitiveDataActiveKeyId,
    Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
      id,
      material: Buffer.from(material, "base64url"),
    })),
  );
  const sensitive = { environment: config.environment, protector };
  const membershipId = `g4pm_${suffix}`;
  const principalId = `g4pu_${suffix}`;
  const extraRows: Array<readonly [string, string]> = [];
  let userCreated = false;
  let cleanupFailure: unknown;
  const createRow = async (
    tableId: string,
    rowId: string,
    data: Readonly<Record<string, unknown>>,
  ) => {
    await tables.createRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId,
      rowId,
      permissions: [],
      data,
    });
    extraRows.push([tableId, rowId]);
  };
  const requireAbsent = async (tableId: string, rowId: string, errorCode: string) => {
    try {
      await tables.getRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId,
        rowId,
      });
      throw new Error(errorCode);
    } catch (error: unknown) {
      if (!absent(error)) throw error;
    }
  };

  const accept = async (index: number) => {
    const response = await application.publicApi?.handle({
      method: "POST",
      path: "/v1/projects/wisemoney/feedback",
      headers: { "content-type": "application/json" },
      body: {
        clientOperationId: operations[index],
        locale: "fr",
        feedback: {
          type: "bug",
          source: { type: "bug", problem: `G4 privacy fixture ${String(index)}` },
          reporter: {
            kind: "contact",
            value: `privacy-${suffix}-${String(index)}@example.invalid`,
            purpose: "G4 privacy verification",
          },
          context: [],
          attachmentNames: [],
        },
      },
    });
    if (
      response?.statusCode !== 201 ||
      !object(response.body) ||
      typeof response.body.reference !== "string" ||
      typeof response.body.accessProof !== "string"
    )
      throw new Error("APPWRITE_G4_PRIVACY_INTAKE_FAILED");
    return { reference: response.body.reference, proof: response.body.accessProof };
  };

  const deployedPrivacy = async (
    access: { readonly reference: string; readonly proof: string },
    feedbackId: string,
    operationId: string,
    expected: number,
  ) => {
    console.log(JSON.stringify({ step: "deployed-privacy", expected }));
    const response = await fetch(new URL("/v1/feedback/privacy", domain), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reference: access.reference,
        proof: access.proof,
        command: {
          kind: "request_deletion",
          operationId,
          feedbackId,
          reasonCode: "reporter_request",
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const body: unknown = await response.json();
    if (response.status !== expected)
      throw new Error(
        `APPWRITE_G4_PRIVACY_HTTP_${String(expected)}_GOT_${String(response.status)}`,
      );
    return body;
  };

  try {
    await users.create({ userId: principalId, name: "G4 Privacy verifier" });
    userCreated = true;
    const session = await users.createSession({ userId: principalId });
    const jwt = (
      await users.createJWT({
        userId: principalId,
        sessionId: session.$id,
        duration: 900,
      })
    ).jwt;
    const now = clock.toISOString();
    await createRow(config.appwriteSchema.workspaceMembershipsTableId, membershipId, {
      workspaceId: "workspace_alpha",
      userId: principalId,
      role: "workspace_owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const restoreAccess = await accept(0);
    const purgeAccess = await accept(1);
    const siblingAccess = await accept(2);
    const consentId = `g4pc_${suffix}`;
    const linkId = `g4pl_${suffix}`;
    const providerOutboxId = `g4po_${suffix}`;
    const syncOutboxId = `g4py_${suffix}`;
    const offlineId = `g4pf_${suffix}`;
    const intelligenceId = `g4pi_${suffix}`;
    const fixtureTime = clock.toISOString();
    await createRow(config.appwriteSchema.publicationConsentsTableId, consentId, {
      feedbackId: restoreIds.feedbackId,
      workspaceId: "workspace_alpha",
      projectId: "project_alpha",
      reporterId: restoreIds.reporterId,
      operationId: `g4pcop_${suffix}`,
      payloadDigest: "c".repeat(64),
      version: 1,
      state: "active",
      disclosureVersion: "g4-v1",
      audience: "github:test/repository",
      occurredAt: fixtureTime,
    });
    await createRow(config.appwriteSchema.externalIssueLinksTableId, linkId, {
      feedbackId: restoreIds.feedbackId,
      workspaceId: "workspace_alpha",
      projectId: "project_alpha",
      connectionId: `g4pn_${suffix}`,
      provider: "github",
      repositoryId: "1329343404",
      visibility: "public",
      providerIssueId: "424242",
      providerIssueUrl:
        "https://github.com/Y4NN777/y7-feedback-mngt-system/issues/424242",
      state: "active",
      synchronizationState: "current",
      providerState: "open",
      providerUpdatedAt: fixtureTime,
      actorId: principalId,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    });
    await createRow(config.appwriteSchema.providerOutboxTableId, providerOutboxId, {
      operationId: `g4pop_${suffix}`,
      feedbackId: restoreIds.feedbackId,
      workspaceId: "workspace_alpha",
      projectId: "project_alpha",
      linkId,
      connectionId: `g4pn_${suffix}`,
      provider: "github",
      repositoryId: "1329343404",
      kind: "create_issue",
      status: "pending",
      attempts: 0,
      payloadJson: "{}",
      payloadDigest: "d".repeat(64),
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    });
    await createRow(config.appwriteSchema.providerSyncOutboxTableId, syncOutboxId, {
      operationId: `g4pso_${suffix}`,
      linkId,
      feedbackId: restoreIds.feedbackId,
      workspaceId: "workspace_alpha",
      projectId: "project_alpha",
      connectionId: `g4pn_${suffix}`,
      provider: "github",
      repositoryId: "1329343404",
      kind: "message_sync",
      status: "pending",
      sequence: 1,
      attempts: 0,
      payloadEnvelope: "{}",
      payloadDigest: "e".repeat(64),
      originMarker: `g4-origin-${suffix}`,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    });
    await createRow(
      config.appwriteSchema.offlineConflictProjectionsTableId,
      offlineId,
      {
        operationId: `g4pfo_${suffix}`,
        workspaceId: "workspace_alpha",
        projectId: "project_alpha",
        actorContextDigest: "f".repeat(64),
        entityType: "feedback",
        entityId: restoreIds.feedbackId,
        clientVersion: 1,
        serverVersion: 2,
        status: "open",
        summaryEnvelope: "{}",
        createdAt: fixtureTime,
      },
    );
    await createRow(
      config.appwriteSchema.intelligenceProvenanceTableId,
      intelligenceId,
      {
        workspaceId: "workspace_alpha",
        projectId: "project_alpha",
        themeId: `g4pth_${suffix}`,
        feedbackId: restoreIds.feedbackId,
        relationType: "supports",
        sourceVersion: 1,
        actorId: principalId,
        createdAt: fixtureTime,
      },
    );
    const denied = await deployedPrivacy(
      siblingAccess,
      restoreIds.feedbackId,
      `g4pd_${suffix}`,
      404,
    );
    if (!object(denied) || denied.error !== "ERR-PRIVACY-DENIED")
      throw new Error("APPWRITE_G4_PRIVACY_SCOPE_DENIAL_FAILED");

    const deleted = await deployedPrivacy(
      restoreAccess,
      restoreIds.feedbackId,
      `g4pa_${suffix}`,
      200,
    );
    if (!object(deleted) || deleted.status !== "ok")
      throw new Error("APPWRITE_G4_PRIVACY_DELETE_FAILED");
    console.log(JSON.stringify({ step: "deployed-retrieval-after-delete" }));
    const retrieval = await fetch(new URL("/v1/feedback/retrieve", domain), {
      method: "POST",
      headers: {
        authorization: `FeedbackProof ${restoreAccess.proof}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reference: restoreAccess.reference }),
      signal: AbortSignal.timeout(90_000),
    });
    if (retrieval.status !== 404)
      throw new Error("APPWRITE_G4_PRIVACY_ORDINARY_ABSENCE_FAILED");
    const feedback = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.feedbackTableId,
      rowId: restoreIds.feedbackId,
    });
    const grant = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.accessGrantsTableId,
      rowId: restoreIds.feedbackId,
    });
    const reporter = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.reportersTableId,
      rowId: restoreIds.reporterId,
    });
    if (!object(feedback) || typeof feedback.deletedAt !== "string")
      throw new Error("APPWRITE_G4_PRIVACY_SOFT_DELETE_FAILED");
    if (!object(grant) || grant.status !== "revoked")
      throw new Error("APPWRITE_G4_PRIVACY_PROOF_REVOCATION_FAILED");
    if (!object(reporter) || typeof reporter.attributionJson !== "string")
      throw new Error("APPWRITE_G4_PRIVACY_ANONYMIZATION_FAILED");
    const attribution: unknown = JSON.parse(
      protector.open(
        {
          environment: config.environment,
          tableId: config.appwriteSchema.reportersTableId,
          rowId: restoreIds.reporterId,
          field: "attributionJson",
        },
        reporter.attributionJson,
      ),
    );
    if (!object(attribution) || attribution.kind !== "unidentified")
      throw new Error("APPWRITE_G4_PRIVACY_IDENTITY_SEARCH_FAILED");
    await requireAbsent(
      config.appwriteSchema.providerOutboxTableId,
      providerOutboxId,
      "APPWRITE_G4_PRIVACY_PROVIDER_OUTBOX_RESURRECTION",
    );
    await requireAbsent(
      config.appwriteSchema.providerSyncOutboxTableId,
      syncOutboxId,
      "APPWRITE_G4_PRIVACY_SYNC_OUTBOX_RESURRECTION",
    );
    await requireAbsent(
      config.appwriteSchema.offlineConflictProjectionsTableId,
      offlineId,
      "APPWRITE_G4_PRIVACY_OFFLINE_PROJECTION_RESURRECTION",
    );
    await requireAbsent(
      config.appwriteSchema.intelligenceProvenanceTableId,
      intelligenceId,
      "APPWRITE_G4_PRIVACY_INTELLIGENCE_RESURRECTION",
    );
    const privacyLink = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.externalIssueLinksTableId,
      rowId: linkId,
    });
    if (
      !object(privacyLink) ||
      privacyLink.state !== "privacy_deleted" ||
      privacyLink.synchronizationState !== "privacy_cleanup_pending"
    )
      throw new Error("APPWRITE_G4_PRIVACY_PROVIDER_LINK_FAILED");
    const lateProviderEvent = await createNodeAppwriteProviderIssueStateStore(tables, {
      databaseId: config.appwriteSchema.databaseId,
      externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
    }).apply({
      provider: "github",
      deliveryId: `g4pdel_${suffix}`,
      connectionId: `g4pn_${suffix}`,
      workspaceId: "workspace_alpha",
      projectId: "project_alpha",
      repositoryId: "1329343404",
      issueId: "424242",
      state: "open",
      providerUpdatedAt: new Date(clock.valueOf() + 1_000).toISOString(),
    });
    if (lateProviderEvent !== "permanent")
      throw new Error("APPWRITE_G4_PRIVACY_PROVIDER_REPLAY_FAILED");
    const consentRows = await tables.listRows({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.publicationConsentsTableId,
      queries: [Query.equal("feedbackId", [restoreIds.feedbackId]), Query.limit(10)],
      total: false,
    });
    for (const row of consentRows.rows)
      extraRows.push([config.appwriteSchema.publicationConsentsTableId, row.$id]);
    if (!consentRows.rows.some((row) => row.state === "revoked"))
      throw new Error("APPWRITE_G4_PRIVACY_CONSENT_REVOCATION_FAILED");

    clock = new Date(Date.now() + 60_000);
    const restored = await application.privacy.handle({
      method: "POST",
      path: "/v1/workspaces/workspace_alpha/projects/project_alpha/privacy",
      headers: { authorization: `Bearer ${jwt}` },
      body: {
        command: {
          kind: "restore_feedback",
          operationId: `g4pt_${suffix}`,
          feedbackId: restoreIds.feedbackId,
          expectedRevision: 1,
        },
      },
    });
    if (restored?.statusCode !== 200)
      throw new Error("APPWRITE_G4_PRIVACY_RESTORE_FAILED");

    const purging = await deployedPrivacy(
      purgeAccess,
      purgeIds.feedbackId,
      `g4pb_${suffix}`,
      200,
    );
    if (!object(purging) || purging.status !== "ok")
      throw new Error("APPWRITE_G4_PRIVACY_PURGE_SETUP_FAILED");
    clock = new Date(Date.now() + 31 * 24 * 60 * 60 * 1_000);
    const repository = createNodeAppwritePrivacyPurgeRepository(
      tables,
      {
        databaseId: config.appwriteSchema.databaseId,
        deletionRecordsTableId: config.appwriteSchema.deletionRecordsTableId,
      },
      sensitive,
      {
        createEventId: () => `g4pe_${randomBytes(12).toString("hex")}`,
        workerDigest: (workerId) =>
          createHash("sha256").update(workerId).digest("base64url"),
      },
    );
    const cleanup = createNodeAppwritePrivacyCleanup(tables, storage, {
      databaseId: config.appwriteSchema.databaseId,
      attachmentBucketId: config.appwriteSchema.attachmentBucketId,
      feedbackTableId: config.appwriteSchema.feedbackTableId,
      reportersTableId: config.appwriteSchema.reportersTableId,
      accessGrantsTableId: config.appwriteSchema.accessGrantsTableId,
      attachmentsTableId: config.appwriteSchema.attachmentsTableId,
      attachmentStagingTableId: config.appwriteSchema.attachmentStagingTableId,
      lifecycleTableId: config.appwriteSchema.lifecycleTableId,
      notificationsTableId: config.appwriteSchema.notificationsTableId,
      conversationMessagesTableId: config.appwriteSchema.conversationMessagesTableId,
      conversationInternalNotesTableId:
        config.appwriteSchema.conversationInternalNotesTableId,
      conversationIdempotencyTableId:
        config.appwriteSchema.conversationIdempotencyTableId,
      conversationLifecycleTableId: config.appwriteSchema.conversationLifecycleTableId,
      publicationConsentsTableId: config.appwriteSchema.publicationConsentsTableId,
      externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
      providerOutboxTableId: config.appwriteSchema.providerOutboxTableId,
      providerSyncOutboxTableId: config.appwriteSchema.providerSyncOutboxTableId,
      offlineConflictProjectionsTableId:
        config.appwriteSchema.offlineConflictProjectionsTableId,
      intelligenceProvenanceTableId:
        config.appwriteSchema.intelligenceProvenanceTableId,
    });
    const workerOptions = {
      workerId: `g4_privacy_${suffix}`,
      batchSize: 25,
      now: () => clock.toISOString(),
      createOperationId: (deletionId: string) => `g4po_${deletionId}`,
    };
    const failed = await createPrivacyPurgeWorker(
      repository,
      [{ cleanup: () => Promise.reject(new Error("forced cleanup failure")) }],
      workerOptions,
    ).runOnce();
    if (failed.failed < 1 || failed.purged !== 0)
      throw new Error("APPWRITE_G4_PRIVACY_PARTIAL_FAILURE_FAILED");
    const purged = await createPrivacyPurgeWorker(
      repository,
      [cleanup],
      workerOptions,
    ).runOnce();
    if (purged.purged < 1 || purged.failed !== 0)
      throw new Error("APPWRITE_G4_PRIVACY_PURGE_FAILED");
    const repeated = await createPrivacyPurgeWorker(
      repository,
      [cleanup],
      workerOptions,
    ).runOnce();
    if (repeated.claimed !== 0)
      throw new Error("APPWRITE_G4_PRIVACY_REPEATED_WORKER_FAILED");
    try {
      await tables.getRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId: config.appwriteSchema.feedbackTableId,
        rowId: purgeIds.feedbackId,
      });
      throw new Error("APPWRITE_G4_PRIVACY_PHYSICAL_ABSENCE_FAILED");
    } catch (error: unknown) {
      if (!absent(error)) throw error;
    }

    console.log(
      JSON.stringify({
        result: "APPWRITE_G4_PRIVACY_PASSED",
        deployedAccountlessDeletion: true,
        ordinaryAbsence: true,
        identityErased: true,
        siblingProofDenied: true,
        restoreBeforeBoundary: true,
        purgeAtBoundary: true,
        partialFailureRetried: true,
        repeatedWorkerIdempotent: true,
        providerReplayDenied: true,
        pendingProviderWritesRemoved: true,
        consentRevoked: true,
        offlineProjectionRemoved: true,
        intelligenceProjectionRemoved: true,
      }),
    );
  } finally {
    const fixtureRows = fixtures.flatMap((fixture, index) => {
      const operation = operations[index];
      if (operation === undefined)
        throw new Error("APPWRITE_G4_PRIVACY_OPERATION_MISSING");
      return appwriteG1SyntheticRows(config.appwriteSchema, fixture, operation);
    });
    for (const [tableId, rowId] of [...extraRows, ...fixtureRows].reverse()) {
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
    const deletions = await tables.listRows({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.deletionRecordsTableId,
      queries: [
        Query.equal(
          "feedbackId",
          fixtures.map(({ feedbackId }) => feedbackId),
        ),
        Query.limit(100),
      ],
      total: false,
    });
    for (const row of deletions.rows) {
      try {
        await tables.deleteRow({
          databaseId: config.appwriteSchema.databaseId,
          tableId: config.appwriteSchema.deletionRecordsTableId,
          rowId: row.$id,
        });
      } catch (error: unknown) {
        cleanupFailure ??= error;
      }
    }
    if (userCreated) {
      try {
        await users.delete({ userId: principalId });
      } catch (error: unknown) {
        if (!absent(error)) cleanupFailure ??= error;
      }
    }
    if (cleanupFailure) {
      // Cleanup failure must fail the verifier even when the behavior matrix passed.
      // eslint-disable-next-line no-unsafe-finally
      throw cleanupFailure instanceof Error
        ? cleanupFailure
        : new Error("APPWRITE_G4_PRIVACY_CLEANUP_FAILED");
    }
  }
}

await main();
