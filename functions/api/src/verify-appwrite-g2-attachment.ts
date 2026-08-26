import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Client, Storage, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createHttpApplication } from "./application.js";
import { createNodeAppwriteAttachmentAcceptanceStore } from "./appwrite-attachment-acceptance-store.js";
import { createNodeAppwriteAttachmentLifecycleStore } from "./appwrite-attachment-lifecycle-store.js";
import {
  runAppwriteG2AttachmentMatrix,
  type AppwriteG2DeployedAttachmentFixture,
} from "./appwrite-g2-attachment-matrix.js";
import { runAppwriteG2SweeperMatrix } from "./appwrite-g2-sweeper-matrix.js";
import {
  appwriteG1SyntheticRows,
  type AppwriteG1MatrixIds,
} from "./appwrite-g1-matrix.js";
import { createNodeAppwritePrivateAttachmentStorage } from "./appwrite-private-attachment-storage.js";
import { createAttachmentDownload } from "./attachment-download.js";
import { createAttachmentLifecycleCoordinator } from "./attachment-lifecycle.js";
import { createAttachmentSaga } from "./attachment-saga.js";
import { validateAttachment } from "./attachment-validation.js";
import { parseClamAvHttpScannerConfig } from "./clamav-http-scanner-config.js";
import { createClamAvHttpScanner } from "./clamav-http-scanner.js";
import { createHttpFunctionPublicApi } from "./http-function-public-api.js";
import type { PublicApi } from "./public-api.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

function ids(suffix: string): AppwriteG1MatrixIds {
  return {
    feedbackId: `g2f_${suffix}`,
    reporterId: `g2r_${suffix}`,
    notificationId: `g2n_${suffix}`,
    lifecycleId: `g2l_${suffix}`,
    outboxId: `g2o_${suffix}`,
  };
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return isObject(error) && error.code === 404;
}

async function acceptSiblingFeedback(
  api: PublicApi,
  clientOperationId: string,
): Promise<{ readonly reference: string; readonly accessProof: string }> {
  const response = await api.handle({
    method: "POST",
    path: "/v1/projects/wisemoney/feedback",
    headers: { "content-type": "application/json" },
    body: {
      clientOperationId,
      locale: "fr",
      feedback: {
        type: "bug",
        source: { type: "bug", problem: "G2 sibling proof marker" },
        reporter: { kind: "unidentified" },
        context: [],
        attachmentNames: [],
      },
    },
  });
  if (
    response?.statusCode !== 201 ||
    !isObject(response.body) ||
    response.body.status !== "accepted" ||
    response.body.replayed !== false ||
    typeof response.body.reference !== "string" ||
    typeof response.body.accessProof !== "string"
  ) {
    throw new Error("APPWRITE_G2_SIBLING_PARENT_FAILED");
  }
  return {
    reference: response.body.reference,
    accessProof: response.body.accessProof,
  };
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("APPWRITE_G2_APPLY_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("APPWRITE_G2_NON_PRODUCTION_REQUIRED");
  }
  const suffix = randomBytes(8).toString("hex");
  const parentIds = ids(suffix);
  const siblingIds = ids(`s${suffix}`);
  const idQueue = [
    parentIds.feedbackId,
    parentIds.reporterId,
    parentIds.notificationId,
    parentIds.lifecycleId,
    parentIds.outboxId,
    siblingIds.feedbackId,
    siblingIds.reporterId,
    siblingIds.notificationId,
    siblingIds.lifecycleId,
    siblingIds.outboxId,
  ];
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const nodeStorage = new Storage(client);
  const users = new Users(client);
  let referenceIndex = 0;
  const application = createHttpApplication(config, {
    tables,
    storage: nodeStorage,
    createId: () => {
      const id = idQueue.shift();
      if (!id) throw new Error("APPWRITE_G2_ID_SEQUENCE_INVALID");
      return id;
    },
    createReference: () => `Y7-G2-${suffix.toUpperCase()}-${String(++referenceIndex)}`,
    createCorrelationId: randomUUID,
    nowIso: () => new Date().toISOString(),
    nowMs: Date.now,
    startedAt: Date.now,
  });
  const publicApi = application.publicApi;
  if (!publicApi) throw new Error("APPWRITE_G2_API_INVALID");

  const sensitive = {
    environment: config.environment,
    protector: createSensitiveDataProtector(
      config.sensitiveDataActiveKeyId,
      Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
        id,
        material: Buffer.from(material, "base64url"),
      })),
    ),
  };
  const privateStorage = createNodeAppwritePrivateAttachmentStorage(
    nodeStorage,
    tables,
    {
      bucketId: config.appwriteSchema.attachmentBucketId,
      databaseId: config.appwriteSchema.databaseId,
      stagingTableId: config.appwriteSchema.attachmentStagingTableId,
    },
  );
  const malwareScanner = createClamAvHttpScanner(
    parseClamAvHttpScannerConfig(process.env),
  );
  const metadata = createNodeAppwriteAttachmentAcceptanceStore(
    tables,
    {
      databaseId: config.appwriteSchema.databaseId,
      stagingTableId: config.appwriteSchema.attachmentStagingTableId,
      attachmentsTableId: config.appwriteSchema.attachmentsTableId,
    },
    sensitive,
  );
  const attachmentId = `g2a_${suffix}`;
  const objectId = `private/g2_${suffix}`;
  const stagedAt = new Date().toISOString();
  const saga = createAttachmentSaga(privateStorage, metadata, {
    now: () => stagedAt,
    createAttachmentId: () => attachmentId,
    createObjectId: () => objectId,
    validate: (candidate) => validateAttachment(candidate, { malwareScanner }),
  });
  const internalAttachmentId = `g2i_${suffix}`;
  const internalObjectId = `private/g2_internal_${suffix}`;
  const internalSaga = createAttachmentSaga(privateStorage, metadata, {
    now: () => stagedAt,
    createAttachmentId: () => internalAttachmentId,
    createObjectId: () => internalObjectId,
    validate: (candidate) => validateAttachment(candidate, { malwareScanner }),
  });
  const lifecycleState = createNodeAppwriteAttachmentLifecycleStore(tables, {
    databaseId: config.appwriteSchema.databaseId,
    attachmentsTableId: config.appwriteSchema.attachmentsTableId,
  });
  const lifecycle = createAttachmentLifecycleCoordinator(
    {
      findById: (id) => metadata.findById(id),
      compareAndSetLifecycle: (id, expected, next) =>
        lifecycleState.compareAndSetLifecycle(id, expected, next),
    },
    privateStorage,
  );
  let workspaceAuth:
    | {
        readonly ownerAuthorized: true;
        readonly unassignedDenied: true;
        readonly maintainerAuthorized: true;
        readonly forgedDenied: true;
        readonly crossScopeDenied: true;
        readonly assignmentRemovalDenied: true;
        readonly membershipRemovalDenied: true;
        readonly sessionRevocationDenied: true;
        readonly cleaned: true;
      }
    | undefined;
  const result = await runAppwriteG2AttachmentMatrix(
    publicApi,
    saga,
    createAttachmentDownload(metadata, privateStorage),
    privateStorage,
    {
      getFile: (input) => nodeStorage.getFile(input),
      getRow: (input) => tables.getRow(input),
      deleteRow: (input) => tables.deleteRow(input),
    },
    config.appwriteSchema,
    {
      intakeIds: parentIds,
      intakeOperationId: randomUUID(),
      attachmentOperationId: randomUUID(),
      attachmentId,
      objectId,
      stagedAt,
    },
    async (fixture: AppwriteG2DeployedAttachmentFixture) => {
      const siblingOperationId = randomUUID();
      let failure: unknown;
      let deployedPassed = false;
      try {
        const siblingAccess = await acceptSiblingFeedback(
          publicApi,
          siblingOperationId,
        );
        const domain = process.env.Y7_FUNCTION_DOMAIN_URL;
        if (!domain) throw new Error("APPWRITE_G2_FUNCTION_DOMAIN_REQUIRED");
        const deployedApi = createHttpFunctionPublicApi({
          baseUrl: domain,
          fetch: globalThis.fetch,
        });
        const authorized = await deployedApi.handle({
          method: "POST",
          path: "/v1/feedback/attachments/download",
          headers: { authorization: `FeedbackProof ${fixture.accessProof}` },
          body: {
            reference: fixture.reference,
            attachmentId: fixture.attachmentId,
          },
        });
        if (authorized?.statusCode !== 200) {
          throw new Error("APPWRITE_G2_DEPLOYED_DOWNLOAD_STATUS_FAILED");
        }
        if (!authorized.binary) {
          throw new Error("APPWRITE_G2_DEPLOYED_DOWNLOAD_BINARY_FAILED");
        }
        if (authorized.binary.displayName !== fixture.displayName) {
          throw new Error("APPWRITE_G2_DEPLOYED_DOWNLOAD_NAME_FAILED");
        }
        if (authorized.binary.mediaType !== fixture.mediaType) {
          throw new Error("APPWRITE_G2_DEPLOYED_DOWNLOAD_MEDIA_FAILED");
        }
        if (!Buffer.from(authorized.binary.bytes).equals(Buffer.from(fixture.bytes))) {
          throw new Error("APPWRITE_G2_DEPLOYED_DOWNLOAD_BYTES_FAILED");
        }
        const sibling = await deployedApi.handle({
          method: "POST",
          path: "/v1/feedback/attachments/download",
          headers: {
            authorization: `FeedbackProof ${siblingAccess.accessProof}`,
          },
          body: {
            reference: siblingAccess.reference,
            attachmentId: fixture.attachmentId,
          },
        });
        if (
          sibling?.statusCode !== 404 ||
          !isObject(sibling.body) ||
          sibling.body.error !== "ERR-ATTACHMENT-DENIED"
        ) {
          throw new Error("APPWRITE_G2_DEPLOYED_SIBLING_FAILED");
        }

        const internalOperationId = randomUUID();
        const ownerUserId = `g2u_o_${suffix}`;
        const maintainerUserId = `g2u_m_${suffix}`;
        const ownerMembershipId = `g2m_o_${suffix}`;
        const maintainerMembershipId = `g2m_m_${suffix}`;
        const assignmentId = `g2p_m_${suffix}`;
        const authRows: Array<readonly [string, string]> = [];
        const authUsers: string[] = [];
        let internalAccepted = false;
        let authPassed = false;
        let authFailure: unknown;
        try {
          const internalAcceptance = await internalSaga.accept({
            operationId: internalOperationId,
            feedbackId: parentIds.feedbackId,
            workspaceId: "workspace_alpha",
            projectId: "project_alpha",
            audience: "workspace",
            sourceEntry: { kind: "internal_note", id: "internal_g2_note" },
            files: [
              {
                bytes: new TextEncoder().encode("Y7 internal attachment evidence\n"),
                clientName: "internal.txt",
                clientMediaType: "text/plain",
              },
            ],
          });
          if (
            internalAcceptance.status !== "accepted" ||
            internalAcceptance.attachmentIds[0] !== internalAttachmentId
          ) {
            throw new Error("APPWRITE_G2_AUTH_ATTACHMENT_FAILED");
          }
          internalAccepted = true;

          const createPrincipal = async (userId: string) => {
            await users.create({ userId, name: "G2 temporary principal" });
            authUsers.push(userId);
            const session = await users.createSession({ userId });
            const token = await users.createJWT({
              userId,
              sessionId: session.$id,
              duration: 900,
            });
            return { jwt: token.jwt, sessionId: session.$id };
          };
          const owner = await createPrincipal(ownerUserId);
          const maintainer = await createPrincipal(maintainerUserId);
          const now = new Date().toISOString();
          const createRoleRow = async (
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
            authRows.push([tableId, rowId]);
          };
          await createRoleRow(
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
          await createRoleRow(
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

          const workspaceRequest = (
            jwt: string,
            workspaceId = "workspace_alpha",
            projectId = "project_alpha",
            claimedPrincipalId?: string,
          ) =>
            deployedApi.handle({
              method: "POST",
              path: `/v1/workspaces/${workspaceId}/projects/${projectId}/attachments/download`,
              headers: { authorization: `Bearer ${jwt}` },
              body: {
                attachmentId: internalAttachmentId,
                ...(claimedPrincipalId === undefined
                  ? {}
                  : { principalId: claimedPrincipalId }),
              },
            });
          const assertDenied = (
            response: Awaited<ReturnType<typeof workspaceRequest>>,
            code: string,
          ) => {
            if (
              response?.statusCode !== 404 ||
              !isObject(response.body) ||
              response.body.error !== "ERR-ATTACHMENT-DENIED"
            ) {
              throw new Error(code);
            }
          };
          const assertAvailable = (
            response: Awaited<ReturnType<typeof workspaceRequest>>,
          ) => {
            if (
              response?.statusCode !== 200 ||
              !response.binary ||
              response.binary.displayName !== "internal.txt" ||
              !Buffer.from(response.binary.bytes).equals(
                Buffer.from("Y7 internal attachment evidence\n"),
              )
            ) {
              throw new Error("APPWRITE_G2_AUTH_DOWNLOAD_FAILED");
            }
          };

          assertAvailable(await workspaceRequest(owner.jwt));
          assertDenied(
            await workspaceRequest(maintainer.jwt),
            "APPWRITE_G2_AUTH_UNASSIGNED_DENIAL_FAILED",
          );
          assertDenied(
            await workspaceRequest(maintainer.jwt, undefined, undefined, ownerUserId),
            "APPWRITE_G2_AUTH_FORGED_DENIAL_FAILED",
          );
          await createRoleRow(
            config.appwriteSchema.projectAssignmentsTableId,
            assignmentId,
            {
              workspaceId: "workspace_alpha",
              projectId: "project_alpha",
              userId: maintainerUserId,
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          );
          assertAvailable(await workspaceRequest(maintainer.jwt));
          assertDenied(
            await workspaceRequest(maintainer.jwt, "workspace_beta", "project_beta"),
            "APPWRITE_G2_AUTH_CROSS_SCOPE_DENIAL_FAILED",
          );
          await tables.updateRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId: config.appwriteSchema.projectAssignmentsTableId,
            rowId: assignmentId,
            data: { status: "removed", updatedAt: new Date().toISOString() },
          });
          assertDenied(
            await workspaceRequest(maintainer.jwt),
            "APPWRITE_G2_AUTH_ASSIGNMENT_REMOVAL_DENIAL_FAILED",
          );
          await tables.updateRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId: config.appwriteSchema.projectAssignmentsTableId,
            rowId: assignmentId,
            data: { status: "active", updatedAt: new Date().toISOString() },
          });
          await tables.updateRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId: config.appwriteSchema.workspaceMembershipsTableId,
            rowId: maintainerMembershipId,
            data: { status: "removed", updatedAt: new Date().toISOString() },
          });
          assertDenied(
            await workspaceRequest(maintainer.jwt),
            "APPWRITE_G2_AUTH_MEMBERSHIP_REMOVAL_DENIAL_FAILED",
          );
          await tables.updateRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId: config.appwriteSchema.workspaceMembershipsTableId,
            rowId: maintainerMembershipId,
            data: { status: "active", updatedAt: new Date().toISOString() },
          });
          await users.deleteSession({
            userId: maintainerUserId,
            sessionId: maintainer.sessionId,
          });
          assertDenied(
            await workspaceRequest(maintainer.jwt),
            "APPWRITE_G2_AUTH_SESSION_REVOCATION_DENIAL_FAILED",
          );
          authPassed = true;
        } catch (error: unknown) {
          authFailure = error;
        }

        let authCleanupFailure: unknown;
        for (const [tableId, rowId] of [...authRows].reverse()) {
          try {
            await tables.deleteRow({
              databaseId: config.appwriteSchema.databaseId,
              tableId,
              rowId,
            });
          } catch (error: unknown) {
            if (!absent(error) && authCleanupFailure === undefined) {
              authCleanupFailure = error;
            }
          }
        }
        for (const userId of [...authUsers].reverse()) {
          try {
            await users.delete({ userId });
          } catch (error: unknown) {
            if (!absent(error) && authCleanupFailure === undefined) {
              authCleanupFailure = error;
            }
          }
        }
        try {
          await privateStorage.remove(internalObjectId);
          if (internalAccepted) {
            await tables.deleteRow({
              databaseId: config.appwriteSchema.databaseId,
              tableId: config.appwriteSchema.attachmentsTableId,
              rowId: internalAttachmentId,
            });
          }
        } catch (error: unknown) {
          if (!absent(error) && authCleanupFailure === undefined) {
            authCleanupFailure = error;
          }
        }
        if (authCleanupFailure === undefined) {
          for (const [tableId, rowId] of authRows) {
            try {
              await tables.getRow({
                databaseId: config.appwriteSchema.databaseId,
                tableId,
                rowId,
              });
              authCleanupFailure = new Error("APPWRITE_G2_AUTH_ROW_RESIDUE");
            } catch (error: unknown) {
              if (!absent(error)) authCleanupFailure = error;
            }
          }
          for (const userId of authUsers) {
            try {
              await users.get({ userId });
              authCleanupFailure = new Error("APPWRITE_G2_AUTH_USER_RESIDUE");
            } catch (error: unknown) {
              if (!absent(error)) authCleanupFailure = error;
            }
          }
          for (const [tableId, rowId] of [
            [config.appwriteSchema.attachmentsTableId, internalAttachmentId],
            [
              config.appwriteSchema.attachmentStagingTableId,
              `stg_${createHash("sha256")
                .update(internalObjectId)
                .digest("hex")
                .slice(0, 32)}`,
            ],
          ] as const) {
            try {
              await tables.getRow({
                databaseId: config.appwriteSchema.databaseId,
                tableId,
                rowId,
              });
              authCleanupFailure = new Error("APPWRITE_G2_AUTH_ROW_RESIDUE");
            } catch (error: unknown) {
              if (!absent(error)) authCleanupFailure = error;
            }
          }
          try {
            await nodeStorage.getFile({
              bucketId: config.appwriteSchema.attachmentBucketId,
              fileId: `att_${createHash("sha256")
                .update(internalObjectId)
                .digest("hex")
                .slice(0, 32)}`,
            });
            authCleanupFailure = new Error("APPWRITE_G2_AUTH_FILE_RESIDUE");
          } catch (error: unknown) {
            if (!absent(error)) authCleanupFailure = error;
          }
        }
        if (authPassed && authCleanupFailure === undefined) {
          workspaceAuth = {
            ownerAuthorized: true,
            unassignedDenied: true,
            maintainerAuthorized: true,
            forgedDenied: true,
            crossScopeDenied: true,
            assignmentRemovalDenied: true,
            membershipRemovalDenied: true,
            sessionRevocationDenied: true,
            cleaned: true,
          };
        }
        if (
          authFailure !== undefined ||
          authCleanupFailure !== undefined ||
          workspaceAuth === undefined
        ) {
          throw new Error("APPWRITE_G2_AUTH_MATRIX_FAILED", {
            cause: authFailure ?? authCleanupFailure,
          });
        }

        const workspaceAuthorization = {
          kind: "workspace_actor" as const,
          authorizedWorkspaceId: "workspace_alpha",
          authorizedProjectId: "project_alpha",
          canReadAttachments: true,
        };
        const transition = async (
          operation: "soft_delete" | "restore" | "purge",
          expected: "soft_deleted" | "available" | "purged",
        ) => {
          const outcome = await lifecycle.transition({
            attachmentId: fixture.attachmentId,
            authorization: workspaceAuthorization,
            operation,
          });
          if (outcome.status !== "ok" || outcome.lifecycle !== expected) {
            throw new Error("APPWRITE_G2_DEPLOYED_LIFECYCLE_FAILED");
          }
        };
        const reporterDownload = () =>
          deployedApi.handle({
            method: "POST",
            path: "/v1/feedback/attachments/download",
            headers: { authorization: `FeedbackProof ${fixture.accessProof}` },
            body: {
              reference: fixture.reference,
              attachmentId: fixture.attachmentId,
            },
          });
        const assertHidden = async () => {
          const response = await reporterDownload();
          if (
            response?.statusCode !== 404 ||
            !isObject(response.body) ||
            response.body.error !== "ERR-ATTACHMENT-DENIED"
          ) {
            throw new Error("APPWRITE_G2_DEPLOYED_LIFECYCLE_VISIBILITY_FAILED");
          }
        };

        await transition("soft_delete", "soft_deleted");
        await assertHidden();
        await transition("restore", "available");
        const restored = await reporterDownload();
        if (
          restored?.statusCode !== 200 ||
          !restored.binary ||
          !Buffer.from(restored.binary.bytes).equals(Buffer.from(fixture.bytes))
        ) {
          throw new Error("APPWRITE_G2_DEPLOYED_RESTORE_FAILED");
        }
        await transition("purge", "purged");
        await assertHidden();
        await transition("purge", "purged");
        const fileId = `att_${createHash("sha256")
          .update(objectId)
          .digest("hex")
          .slice(0, 32)}`;
        try {
          await nodeStorage.getFile({
            bucketId: config.appwriteSchema.attachmentBucketId,
            fileId,
          });
          throw new Error("APPWRITE_G2_DEPLOYED_PURGE_RESIDUE");
        } catch (error: unknown) {
          if (!absent(error)) throw error;
        }
        deployedPassed = true;
      } catch (error: unknown) {
        failure = error;
      }

      let cleaned = 0;
      for (const [tableId, rowId] of [
        ...appwriteG1SyntheticRows(
          config.appwriteSchema,
          siblingIds,
          siblingOperationId,
        ),
      ].reverse()) {
        try {
          await tables.deleteRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId,
            rowId,
          });
          cleaned += 1;
        } catch (error: unknown) {
          if (!absent(error)) throw error;
        }
      }
      if (failure !== undefined || cleaned !== 7 || !deployedPassed) {
        throw new Error("APPWRITE_G2_DEPLOYED_MATRIX_FAILED", { cause: failure });
      }
      return {
        authorizedDownload: true,
        siblingDenied: true,
        siblingCleanedRows: 7,
        softDeleteHidden: true,
        restoreAuthorized: true,
        purgeHidden: true,
        purgeRemoved: true,
      };
    },
  );
  if (idQueue.length !== 0) throw new Error("APPWRITE_G2_ID_SEQUENCE_INVALID");
  const sweeper = await runAppwriteG2SweeperMatrix(
    saga,
    privateStorage,
    metadata,
    {
      getFile: (input) => nodeStorage.getFile(input),
      getRow: (input) => tables.getRow(input),
      deleteRow: (input) => tables.deleteRow(input),
    },
    config.appwriteSchema,
    {
      operationId: randomUUID(),
      attachmentId: `g2a_s${suffix}`,
      associatedObjectId: `private/g2_sweep_associated_${suffix}`,
      orphanObjectId: `private/g2_sweep_orphan_${suffix}`,
      stagedAt: "2000-01-01T00:00:00.000Z",
      sweepBefore: "2000-01-01T00:00:01.000Z",
    },
  );
  process.stdout.write(
    `${JSON.stringify({ status: "ok", environment: config.environment, ...result, workspaceAuth, sweeper })}\n`,
  );
}

function safeCode(error: unknown): string {
  let current = error;
  let code = "APPWRITE_G2_FAILED";
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (/^APPWRITE_G2_[A-Z_]+$/u.test(current.message)) code = current.message;
    current = current.cause;
  }
  return code;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ status: "error", code: safeCode(error) })}\n`,
  );
  process.exitCode = 1;
});
