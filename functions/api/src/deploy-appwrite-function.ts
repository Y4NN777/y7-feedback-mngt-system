import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AppwriteException,
  Client,
  DeploymentStatus,
  Functions,
  ProjectKeyScopes,
  Runtime,
} from "node-appwrite";
import { InputFile } from "node-appwrite/file";

import { parseServerConfig } from "@y7-feedback/config/server";
import type { ApplicationEnvironment } from "@y7-feedback/config/public";

import { resolveAppwriteFunctionTarget } from "./appwrite-function-variables.js";

const buildCommands =
  "corepack enable && corepack prepare pnpm@10.32.1 --activate && pnpm install --frozen-lockfile && pnpm --filter @y7-feedback/config build && pnpm --filter @y7-feedback/domain build && pnpm --filter @y7-feedback/api build";

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("APPWRITE_FUNCTION_ARCHIVE_FAILED"));
    });
  });
}

async function ensureFunction(
  functions: Functions,
  environment: ApplicationEnvironment,
): Promise<"created" | "updated"> {
  const target = resolveAppwriteFunctionTarget(environment);
  const settings = {
    functionId: target.id,
    name: target.name,
    runtime: Runtime.Node22,
    execute: ["any"],
    events: [],
    schedule: "",
    timeout: 15,
    enabled: true,
    logging: true,
    entrypoint: "functions/api/dist/main.js",
    commands: buildCommands,
    scopes: [
      ProjectKeyScopes.RowsRead,
      ProjectKeyScopes.RowsWrite,
      ProjectKeyScopes.FilesRead,
    ],
    deploymentRetention: 3,
  };
  try {
    await functions.get({ functionId: target.id });
    await functions.update(settings);
    return "updated";
  } catch (error: unknown) {
    if (!(error instanceof AppwriteException) || error.code !== 404) throw error;
    await functions.create(settings);
    return "created";
  }
}

async function waitUntilReady(
  functions: Functions,
  functionId: string,
  deploymentId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const deployment = await functions.getDeployment({ functionId, deploymentId });
    if (deployment.status === DeploymentStatus.Ready) return deployment.status;
    if (deployment.status === DeploymentStatus.Failed) {
      throw new Error("APPWRITE_FUNCTION_DEPLOYMENT_FAILED");
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("APPWRITE_FUNCTION_DEPLOYMENT_TIMEOUT");
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("APPWRITE_FUNCTION_DEPLOYMENT_REQUIRES_APPLY");
  }
  const config = parseServerConfig(process.env);
  const target = resolveAppwriteFunctionTarget(config.environment);
  const functions = new Functions(
    new Client()
      .setEndpoint(config.appwriteEndpoint)
      .setProject(config.appwriteProjectId)
      .setKey(config.appwriteApiKey),
  );
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), `y7-appwrite-${config.environment}-`),
  );
  const archivePath = join(temporaryDirectory, "function.tar.gz");
  try {
    await run("tar", [
      "--exclude=.git",
      "--exclude=.github",
      "--exclude=.env*",
      "--exclude=node_modules",
      "--exclude=dist",
      "--exclude=docs",
      "--exclude=apps",
      "--exclude=coverage",
      "--exclude=playwright-report",
      "--exclude=test-results",
      "--exclude=*.tsbuildinfo",
      "-czf",
      archivePath,
      ".",
    ]);
    const functionChange = await ensureFunction(functions, config.environment);
    const deployment = await functions.createDeployment({
      functionId: target.id,
      code: InputFile.fromPath(archivePath),
      activate: true,
      entrypoint: "functions/api/dist/main.js",
      commands: buildCommands,
    });
    const status = await waitUntilReady(functions, target.id, deployment.$id);
    process.stdout.write(
      `${JSON.stringify({ functionId: target.id, functionChange, deploymentId: deployment.$id, status })}\n`,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error ? error.message : "APPWRITE_FUNCTION_DEPLOYMENT_FAILED";
  process.stderr.write(`${JSON.stringify({ status: "error", code })}\n`);
  process.exitCode = 1;
});
