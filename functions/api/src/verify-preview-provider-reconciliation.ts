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
  if (failedIndex < 0 || !successBefore || !successAfter || !fixtureAbsent)
    throw new Error("PROVIDER_RECONCILIATION_EVIDENCE_INCOMPLETE");
  process.stdout.write(
    `${JSON.stringify({
      result: "APPWRITE_G4_PROVIDER_RECONCILIATION_PASSED",
      schedule: deployed.schedule,
      timeout: deployed.timeout,
      successBefore,
      outageDetected: true,
      recoveryDetected: successAfter,
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
