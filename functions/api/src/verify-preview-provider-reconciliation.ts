import {
  Client,
  ExecutionStatus,
  ExecutionTrigger,
  Functions,
  Query,
  TablesDB,
} from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { resolveAppwriteFunctionTarget } from "./appwrite-function-variables.js";
import { createNodeAppwriteProviderGrantVault } from "./appwrite-provider-grant-vault.js";

async function absentDelete(
  tables: TablesDB,
  input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  },
): Promise<void> {
  try {
    await tables.deleteRow(input);
  } catch (error: unknown) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== 404
    )
      throw error;
  }
}

async function proveRevokedToken(input: {
  readonly config: ReturnType<typeof parseServerConfig>;
  readonly functions: Functions;
  readonly tables: TablesDB;
  readonly functionId: string;
}): Promise<boolean> {
  const connectionId = "sync_revoked_probe";
  const grantId = "sync_revoked_grant";
  const schema = input.config.appwriteSchema;
  await absentDelete(input.tables, {
    databaseId: schema.databaseId,
    tableId: schema.sourceConnectionsTableId,
    rowId: connectionId,
  });
  await absentDelete(input.tables, {
    databaseId: schema.databaseId,
    tableId: schema.providerGrantsTableId,
    rowId: grantId,
  });
  const startedAt = new Date().toISOString();
  try {
    const vault = createNodeAppwriteProviderGrantVault(
      input.tables,
      {
        databaseId: schema.databaseId,
        providerGrantsTableId: schema.providerGrantsTableId,
      },
      Buffer.from(input.config.providerGrantEnvelopeKey, "base64url"),
      { createReference: () => grantId, createNonce: () => Buffer.alloc(12, 7) },
    );
    await vault.seal("github", { accessToken: "definitely-revoked-preview-token" });
    await input.tables.createRow({
      databaseId: schema.databaseId,
      tableId: schema.sourceConnectionsTableId,
      rowId: connectionId,
      data: {
        workspaceId: "sync_probe_workspace",
        projectId: "sync_probe_project",
        provider: "github",
        ownerUserId: "sync_probe_owner",
        status: "active",
        encryptedGrantRef: grantId,
        selectedRepositoriesJson: JSON.stringify({
          kind: "selected",
          repositories: [{ provider: "github", id: "1329343404" }],
        }),
        createdAt: startedAt,
        updatedAt: startedAt,
      },
      permissions: [],
    });
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const [row, executions] = await Promise.all([
        input.tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.sourceConnectionsTableId,
          rowId: connectionId,
        }),
        input.functions.listExecutions({
          functionId: input.functionId,
          queries: [Query.orderDesc("$createdAt"), Query.limit(10)],
          total: false,
        }),
      ]);
      const passed = executions.executions.some(
        ({ trigger, status, responseStatusCode, $createdAt }) =>
          trigger === ExecutionTrigger.Schedule &&
          status === ExecutionStatus.Completed &&
          responseStatusCode === 200 &&
          $createdAt >= startedAt,
      );
      if (row.status === "suspended" && passed) return true;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    return false;
  } finally {
    await absentDelete(input.tables, {
      databaseId: schema.databaseId,
      tableId: schema.sourceConnectionsTableId,
      rowId: connectionId,
    });
    await absentDelete(input.tables, {
      databaseId: schema.databaseId,
      tableId: schema.providerGrantsTableId,
      rowId: grantId,
    });
  }
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply"))
    throw new Error("PROVIDER_RECONCILIATION_VERIFY_REQUIRES_APPLY");
  const config = parseServerConfig(process.env);
  if (config.environment !== "preview")
    throw new Error("PROVIDER_RECONCILIATION_VERIFY_PREVIEW_ONLY");
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const functions = new Functions(client);
  const tables = new TablesDB(client);
  const target = resolveAppwriteFunctionTarget(config.environment);
  const deployed = await functions.get({ functionId: target.id });
  if (deployed.schedule !== "*/5 * * * *" || deployed.timeout !== 60)
    throw new Error("PROVIDER_RECONCILIATION_SCHEDULE_INVALID");
  const executions = await functions.listExecutions({
    functionId: target.id,
    queries: [Query.orderDesc("$createdAt"), Query.limit(100)],
    total: false,
  });
  const scheduled = executions.executions
    .filter(({ trigger }) => trigger === ExecutionTrigger.Schedule)
    .reverse();
  const failedIndex = scheduled.findIndex(
    ({ status, responseStatusCode }) =>
      status === ExecutionStatus.Failed && responseStatusCode === 503,
  );
  const successBefore = scheduled
    .slice(0, failedIndex)
    .some(
      ({ status, responseStatusCode }) =>
        status === ExecutionStatus.Completed && responseStatusCode === 200,
    );
  const successAfter = scheduled
    .slice(failedIndex + 1)
    .some(
      ({ status, responseStatusCode }) =>
        status === ExecutionStatus.Completed && responseStatusCode === 200,
    );
  let fixtureAbsent = false;
  try {
    await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.sourceConnectionsTableId,
      rowId: "sync_outage_probe",
    });
  } catch (error: unknown) {
    fixtureAbsent =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 404;
  }
  const tokenRevocationSuspended = await proveRevokedToken({
    config,
    functions,
    tables,
    functionId: target.id,
  });
  if (
    failedIndex < 0 ||
    !successBefore ||
    !successAfter ||
    !fixtureAbsent ||
    !tokenRevocationSuspended
  )
    throw new Error("PROVIDER_RECONCILIATION_EVIDENCE_INCOMPLETE");
  process.stdout.write(
    `${JSON.stringify({
      result: "APPWRITE_G4_PROVIDER_RECONCILIATION_PASSED",
      schedule: deployed.schedule,
      timeout: deployed.timeout,
      successBefore,
      outageDetected: true,
      recoveryDetected: successAfter,
      tokenRevocationSuspended,
      cleanupPassed: fixtureAbsent,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error ? error.message : "PROVIDER_RECONCILIATION_VERIFY_FAILED";
  process.stderr.write(`${JSON.stringify({ error: code })}\n`);
  process.exitCode = 1;
});
