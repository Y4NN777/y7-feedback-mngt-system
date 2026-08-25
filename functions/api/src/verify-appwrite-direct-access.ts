import { randomBytes } from "node:crypto";

import { Client, Permission, Role, Storage, TablesDB, Users } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import {
  Channel,
  Client as RealtimeClient,
  Realtime,
  type RealtimeSubscription,
} from "appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import {
  runDirectAccessIsolationMatrix,
  type DirectAccessIsolationPort,
  type DirectAccessSurface,
} from "./appwrite-direct-access-isolation.js";

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return isObject(error) && error.code === 404;
}

function denied(error: unknown): boolean {
  return (
    isObject(error) && (error.code === 401 || error.code === 403 || error.code === 404)
  );
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("APPWRITE_DIRECT_ACCESS_APPLY_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("APPWRITE_DIRECT_ACCESS_NON_PRODUCTION_REQUIRED");
  }

  const suffix = randomBytes(8).toString("hex");
  const ownerUserId = `own_owner_${suffix}`;
  const maintainerUserId = `own_maint_${suffix}`;
  const controlUserId = `own_ctrl_${suffix}`;
  const feedbackId = `own_feedback_${suffix}`;
  const notificationId = `own_notice_${suffix}`;
  const providerGrantId = `own_grant_${suffix}`;
  const sourceConnectionId = `own_source_${suffix}`;
  const fileId = `own_file_${suffix}`;
  const realtimeGrantId = `own_rt_${suffix}`;
  const mutationIds = new Map<string, string>([
    [ownerUserId, `own_mut_o_${suffix}`],
    [maintainerUserId, `own_mut_m_${suffix}`],
  ]);
  const updateGrantIds = new Map<string, string>([
    [ownerUserId, `own_upd_o_${suffix}`],
    [maintainerUserId, `own_upd_m_${suffix}`],
  ]);
  const deleteGrantIds = new Map<string, string>([
    [ownerUserId, `own_del_o_${suffix}`],
    [maintainerUserId, `own_del_m_${suffix}`],
  ]);
  const endpoint = config.appwriteEndpoint;
  const projectId = config.appwriteProjectId;
  const admin = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(config.appwriteApiKey);
  const users = new Users(admin);
  const tables = new TablesDB(admin);
  const storage = new Storage(admin);
  const createdRows: [string, string][] = [];
  const createdUsers: string[] = [];
  let createdFile = false;
  let cleanupFailure: unknown;
  let matrixResult: Awaited<ReturnType<typeof runDirectAccessIsolationMatrix>>;

  const createRow = async (
    tableId: string,
    rowId: string,
    data: Readonly<Record<string, unknown>>,
    permissions: string[] = [],
  ) => {
    await tables.createRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId,
      rowId,
      data,
      permissions,
    });
    createdRows.push([tableId, rowId]);
  };

  try {
    const now = new Date().toISOString();
    await createRow(config.appwriteSchema.feedbackTableId, feedbackId, {
      projectId: "project_alpha",
      workspaceId: "workspace_alpha",
      reporterId: `own_reporter_${suffix}`,
      type: "bug",
      originalSourceJson: "v1.isolation",
      currentSourceJson: "v1.isolation",
      contextJson: "v1.isolation",
      attachmentNamesJson: "v1.isolation",
      state: "received",
      acceptedAt: now,
      reporterHistoryJson: "v1.isolation",
      reporterMessagesJson: "v1.isolation",
      reporterAttachmentsJson: "v1.isolation",
      sourceRevisionsJson: "v1.isolation",
      deletionRequestsJson: "v1.isolation",
      internalNotesJson: "v1.isolation",
    });
    await createRow(config.appwriteSchema.notificationsTableId, notificationId, {
      feedbackId,
      reporterId: `own_reporter_${suffix}`,
      kind: "isolation_probe",
      reference: `OWN-${suffix}`,
      createdAt: now,
    });
    await createRow(config.appwriteSchema.providerGrantsTableId, providerGrantId, {
      provider: "github",
      envelope: "v1.isolation",
    });
    for (const rowId of [...updateGrantIds.values(), ...deleteGrantIds.values()]) {
      await createRow(config.appwriteSchema.providerGrantsTableId, rowId, {
        provider: "gitlab",
        envelope: "v1.isolation",
      });
    }
    await createRow(
      config.appwriteSchema.sourceConnectionsTableId,
      sourceConnectionId,
      {
        workspaceId: "workspace_alpha",
        projectId: "project_alpha",
        provider: `test${suffix.slice(0, 8)}`,
        ownerUserId,
        status: "active",
        encryptedGrantRef: providerGrantId,
        selectedRepositoriesJson: "v1.isolation",
        createdAt: now,
        updatedAt: now,
      },
    );
    await storage.createFile({
      bucketId: config.appwriteSchema.attachmentBucketId,
      fileId,
      file: InputFile.fromBuffer(Buffer.from("isolation probe"), "isolation.txt"),
      permissions: [],
    });
    createdFile = true;

    const jwtByUser = new Map<string, string>();
    const sessionSecretByUser = new Map<string, string>();
    for (const userId of [ownerUserId, maintainerUserId, controlUserId]) {
      await users.create({ userId, name: "OWN temporary principal" });
      createdUsers.push(userId);
      const session = await users.createSession({ userId });
      sessionSecretByUser.set(userId, session.secret);
      const token = await users.createJWT({
        userId,
        sessionId: session.$id,
        duration: 900,
      });
      jwtByUser.set(userId, token.jwt);
    }
    await createRow(
      config.appwriteSchema.providerGrantsTableId,
      realtimeGrantId,
      {
        provider: "github",
        envelope: "v1.realtime-control-0",
      },
      [Permission.read(Role.user(controlUserId))],
    );

    const surfaceRows: Readonly<
      Record<Exclude<DirectAccessSurface, "files">, readonly [string, string]>
    > = {
      projects: [config.appwriteSchema.projectsTableId, "project_alpha"],
      feedback: [config.appwriteSchema.feedbackTableId, feedbackId],
      notifications: [config.appwriteSchema.notificationsTableId, notificationId],
      source_connections: [
        config.appwriteSchema.sourceConnectionsTableId,
        sourceConnectionId,
      ],
      provider_grants: [config.appwriteSchema.providerGrantsTableId, providerGrantId],
    };
    const clientFor = (jwt: string) =>
      new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
    const port: DirectAccessIsolationPort = {
      async countVisible(jwt, surface) {
        if (surface === "files") {
          const result = await new Storage(clientFor(jwt)).listFiles({
            bucketId: config.appwriteSchema.attachmentBucketId,
            total: true,
          });
          return Math.max(result.files.length, result.total);
        }
        const [tableId] = surfaceRows[surface];
        const result = await new TablesDB(clientFor(jwt)).listRows({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          total: true,
        });
        return Math.max(result.rows.length, result.total);
      },
      async readSentinel(jwt, surface) {
        try {
          if (surface === "files") {
            await new Storage(clientFor(jwt)).getFileDownload({
              bucketId: config.appwriteSchema.attachmentBucketId,
              fileId,
            });
          } else {
            const [tableId, rowId] = surfaceRows[surface];
            await new TablesDB(clientFor(jwt)).getRow({
              databaseId: config.appwriteSchema.databaseId,
              tableId,
              rowId,
            });
          }
          return "allowed";
        } catch (error: unknown) {
          if (denied(error)) return "denied";
          throw error;
        }
      },
      async createSyntheticSource(jwt) {
        const principal = [...jwtByUser.entries()].find(
          ([, value]) => value === jwt,
        )?.[0];
        if (!principal) throw new Error("APPWRITE_DIRECT_ACCESS_MATRIX_INVALID");
        const rowId = mutationIds.get(principal);
        if (!rowId) throw new Error("APPWRITE_DIRECT_ACCESS_MATRIX_INVALID");
        try {
          await new TablesDB(clientFor(jwt)).createRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId: config.appwriteSchema.sourceConnectionsTableId,
            rowId,
            data: {
              workspaceId: "workspace_beta",
              projectId: "project_beta",
              provider: `mut${rowId.slice(-8)}`,
              ownerUserId: principal,
              status: "active",
              encryptedGrantRef: providerGrantId,
              selectedRepositoriesJson: "v1.isolation",
              createdAt: now,
              updatedAt: now,
            },
            permissions: [],
          });
          createdRows.push([config.appwriteSchema.sourceConnectionsTableId, rowId]);
          return "allowed";
        } catch (error: unknown) {
          if (denied(error)) return "denied";
          throw error;
        }
      },
      async updateSyntheticGrant(jwt) {
        const principal = [...jwtByUser.entries()].find(
          ([, value]) => value === jwt,
        )?.[0];
        const rowId = principal ? updateGrantIds.get(principal) : undefined;
        if (!rowId) throw new Error("APPWRITE_DIRECT_ACCESS_MATRIX_INVALID");
        try {
          await new TablesDB(clientFor(jwt)).updateRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId: config.appwriteSchema.providerGrantsTableId,
            rowId,
            data: { envelope: "v1.direct-update" },
          });
          return "allowed";
        } catch (error: unknown) {
          if (denied(error)) return "denied";
          throw error;
        }
      },
      async deleteSyntheticGrant(jwt) {
        const principal = [...jwtByUser.entries()].find(
          ([, value]) => value === jwt,
        )?.[0];
        const rowId = principal ? deleteGrantIds.get(principal) : undefined;
        if (!rowId) throw new Error("APPWRITE_DIRECT_ACCESS_MATRIX_INVALID");
        try {
          await new TablesDB(clientFor(jwt)).deleteRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId: config.appwriteSchema.providerGrantsTableId,
            rowId,
          });
          return "allowed";
        } catch (error: unknown) {
          if (denied(error)) return "denied";
          throw error;
        }
      },
      async observeRealtime(jwt) {
        const controlSecret = sessionSecretByUser.get(controlUserId);
        const principal = [...jwtByUser.entries()].find(
          ([, value]) => value === jwt,
        )?.[0];
        const principalSecret = principal
          ? sessionSecretByUser.get(principal)
          : undefined;
        if (!controlSecret || !principal || !principalSecret) {
          throw new Error("APPWRITE_DIRECT_ACCESS_MATRIX_INVALID");
        }

        const createRealtime = (sessionSecret: string) => {
          const runtime = globalThis as unknown as {
            window?: {
              clearInterval: typeof globalThis.clearInterval;
              setInterval: typeof globalThis.setInterval;
            };
          };
          runtime.window ??= {
            clearInterval: globalThis.clearInterval,
            setInterval: globalThis.setInterval,
          };
          const client = new RealtimeClient()
            .setEndpoint(endpoint)
            .setProject(projectId)
            .setSession(sessionSecret);
          return new Realtime(client);
        };
        const controlRealtime = createRealtime(controlSecret);
        const principalRealtime = createRealtime(principalSecret);
        const channel = Channel.tablesdb(config.appwriteSchema.databaseId)
          .table(config.appwriteSchema.providerGrantsTableId)
          .row(realtimeGrantId);
        const observation = { leaked: false };
        let controlSubscription: RealtimeSubscription | undefined;
        let principalSubscription: RealtimeSubscription | undefined;
        let resolveControl: (() => void) | undefined;
        let rejectRealtime: ((error: Error) => void) | undefined;
        const controlObserved = new Promise<void>((resolve, reject) => {
          resolveControl = resolve;
          rejectRealtime = reject;
        });
        const onRealtimeError = (error?: Error) => {
          rejectRealtime?.(error ?? new Error("APPWRITE_REALTIME_CONNECTION_FAILED"));
        };
        controlRealtime.onError(onRealtimeError);
        principalRealtime.onError(onRealtimeError);

        try {
          controlSubscription = await controlRealtime.subscribe(channel, () => {
            resolveControl?.();
          });
          principalSubscription = await principalRealtime.subscribe(channel, () => {
            observation.leaked = true;
          });
          await tables.updateRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId: config.appwriteSchema.providerGrantsTableId,
            rowId: realtimeGrantId,
            data: { envelope: `v1.realtime-control-${principal}` },
          });
          await Promise.race([
            controlObserved,
            new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new Error("APPWRITE_REALTIME_CONTROL_TIMEOUT"));
              }, 5_000);
            }),
          ]);
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
          return observation.leaked ? "leaked" : "isolated";
        } finally {
          await principalSubscription?.unsubscribe();
          await controlSubscription?.unsubscribe();
          await principalRealtime.disconnect();
          await controlRealtime.disconnect();
        }
      },
    };
    matrixResult = await runDirectAccessIsolationMatrix(
      port,
      [jwtByUser.get(ownerUserId) ?? "", jwtByUser.get(maintainerUserId) ?? ""],
      [
        "projects",
        "feedback",
        "notifications",
        "source_connections",
        "provider_grants",
        "files",
      ],
    );
  } finally {
    for (const [tableId, rowId] of [...createdRows].reverse()) {
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
    if (createdFile) {
      try {
        await storage.deleteFile({
          bucketId: config.appwriteSchema.attachmentBucketId,
          fileId,
        });
      } catch (error: unknown) {
        if (!absent(error)) cleanupFailure ??= error;
      }
    }
    for (const userId of [...createdUsers].reverse()) {
      try {
        await users.delete({ userId });
      } catch (error: unknown) {
        if (!absent(error)) cleanupFailure ??= error;
      }
    }
  }

  if (cleanupFailure instanceof Error) throw cleanupFailure;
  if (cleanupFailure) throw new Error("APPWRITE_DIRECT_ACCESS_CLEANUP_FAILED");

  for (const [tableId, rowId] of createdRows) {
    try {
      await tables.getRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId,
        rowId,
      });
      throw new Error("APPWRITE_DIRECT_ACCESS_CLEANUP_FAILED");
    } catch (error: unknown) {
      if (!absent(error)) throw error;
    }
  }
  try {
    await storage.getFile({
      bucketId: config.appwriteSchema.attachmentBucketId,
      fileId,
    });
    throw new Error("APPWRITE_DIRECT_ACCESS_CLEANUP_FAILED");
  } catch (error: unknown) {
    if (!absent(error)) throw error;
  }
  for (const userId of createdUsers) {
    try {
      await users.get({ userId });
      throw new Error("APPWRITE_DIRECT_ACCESS_CLEANUP_FAILED");
    } catch (error: unknown) {
      if (!absent(error)) throw error;
    }
  }
  process.stdout.write(
    `${JSON.stringify({ status: "ok", environment: config.environment, ...matrixResult, cleaned: true })}\n`,
  );
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^[A-Z][A-Z0-9_]{2,100}$/u.test(error.message)
      ? error.message
      : "APPWRITE_DIRECT_ACCESS_VERIFICATION_FAILED";
  process.stderr.write(`${JSON.stringify({ status: "error", code })}\n`);
  process.exitCode = 1;
});
