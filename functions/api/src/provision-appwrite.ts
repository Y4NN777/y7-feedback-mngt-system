import { Client, Storage, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createNodeAppwriteProvisioningPort } from "./appwrite-provisioner-node.js";
import {
  provisionAppwriteInfrastructure,
  safeAppwriteProvisioningErrorCode,
} from "./appwrite-provisioner.js";
import { createAppwriteInfrastructureManifest } from "./appwrite-schema.js";
import { createNodeAppwriteG1FixtureStore } from "./appwrite-g1-fixtures-node.js";
import { createG1FixtureRows, seedG1Fixtures } from "./appwrite-g1-fixtures.js";

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("APPWRITE_PROVISION_APPLY_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("APPWRITE_PROVISION_NON_PRODUCTION_REQUIRED");
  }

  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const port = createNodeAppwriteProvisioningPort(tables, new Storage(client));
  const result = await provisionAppwriteInfrastructure(
    port,
    createAppwriteInfrastructureManifest(config.appwriteSchema),
  );
  const fixtures = await seedG1Fixtures(
    createNodeAppwriteG1FixtureStore(tables, config.appwriteSchema.databaseId),
    createG1FixtureRows(config.appwriteSchema),
  );
  process.stdout.write(
    `${JSON.stringify({
      status: "ok",
      infrastructure: result,
      fixtures,
      environment: config.environment,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  const code = safeAppwriteProvisioningErrorCode(error);
  process.stderr.write(`${JSON.stringify({ status: "error", code })}\n`);
  process.exitCode = 1;
});
