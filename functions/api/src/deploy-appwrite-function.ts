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

import type { ApplicationEnvironment } from "@y7-feedback/config/public";

import { retryAppwriteAdminCall } from "./appwrite-admin-retry.js";
import { stageAppwriteRuntimeArtifact } from "./appwrite-runtime-artifact.js";
import {
  resolveAppwriteFunctionDeploymentAuthority,
  resolveAppwriteFunctionTarget,
  resolveAuthoritativeCommitEvent,
} from "./appwrite-function-variables.js";

const buildCommands =
  "corepack enable && corepack prepare pnpm@10.32.1 --activate && pnpm install --frozen-lockfile --prod";

function run(
  command: string,
  args: readonly string[],
  cwd = process.cwd(),
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
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
  const authoritativeCommitEvent = resolveAuthoritativeCommitEvent(process.env);
  const settings = {
    functionId: target.id,
    name: target.name,
    runtime: Runtime.Node22,
    execute: ["any"],
    events: authoritativeCommitEvent === undefined ? [] : [authoritativeCommitEvent],
    schedule: "*/5 * * * *",
    timeout: 60,
    enabled: true,
    logging: true,
    entrypoint: "functions/api/dist/runtime/main.js",
    commands: buildCommands,
    scopes: [
      ProjectKeyScopes.RowsRead,
      ProjectKeyScopes.RowsWrite,
      ProjectKeyScopes.FilesRead,
      ProjectKeyScopes.FilesWrite,
      ProjectKeyScopes.UsersRead,
      ProjectKeyScopes.TeamsRead,
    ],
    runtimeSpecification: "s-2vcpu-2gb",
    deploymentRetention: 3,
  };
  try {
    await retryAppwriteAdminCall(() => functions.get({ functionId: target.id }));
    await retryAppwriteAdminCall(() => functions.update(settings));
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
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const deployment = await retryAppwriteAdminCall(() =>
      functions.getDeployment({ functionId, deploymentId }),
    );
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
  const authority = resolveAppwriteFunctionDeploymentAuthority(process.env);
  const target = resolveAppwriteFunctionTarget(authority.environment);
  const functions = new Functions(
    new Client()
      .setEndpoint(authority.endpoint)
      .setProject(authority.projectId)
      .setKey(authority.apiKey),
  );
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), `y7-appwrite-${authority.environment}-`),
  );
  const archivePath = join(temporaryDirectory, "function.tar.gz");
  const stagingDirectory = join(temporaryDirectory, "runtime");
  try {
    await stageAppwriteRuntimeArtifact(process.cwd(), stagingDirectory);
    await run("tar", ["-czf", archivePath, "."], stagingDirectory);
    const functionChange = await ensureFunction(functions, authority.environment);
    const deployment = await functions.createDeployment({
      functionId: target.id,
      code: InputFile.fromPath(archivePath),
      activate: true,
      entrypoint: "functions/api/dist/runtime/main.js",
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
