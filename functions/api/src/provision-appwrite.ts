import { Client, Storage, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createNodeAppwriteProvisioningPort } from "./appwrite-provisioner-node.js";
import {
  provisionAppwriteInfrastructure,
  safeAppwriteProvisioningErrorCode,
} from "./appwrite-provisioner.js";
import { createAppwriteInfrastructureManifest } from "./appwrite-schema.js";

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
  const port = createNodeAppwriteProvisioningPort(
    new TablesDB(client),
    new Storage(client),
  );
  const result = await provisionAppwriteInfrastructure(
    port,
    createAppwriteInfrastructureManifest(config.appwriteSchema),
  );
  process.stdout.write(
    `${JSON.stringify({ status: "ok", ...result, environment: config.environment })}\n`,
  );
}

main().catch((error: unknown) => {
  const code = safeAppwriteProvisioningErrorCode(error);
  process.stderr.write(`${JSON.stringify({ status: "error", code })}\n`);
  process.exitCode = 1;
});
