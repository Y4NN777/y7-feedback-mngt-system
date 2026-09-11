import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client, Functions, Query } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { productionFunctionId } from "./appwrite-function-variables.js";

const deploymentId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

export interface ProductionFunctionDeploymentsPort {
  readonly get: (input: {
    readonly functionId: string;
  }) => Promise<{ readonly deploymentId: string }>;
  readonly listDeployments: (input: {
    readonly functionId: string;
    readonly queries?: string[];
    readonly total?: boolean;
  }) => Promise<{
    readonly deployments: readonly {
      readonly $id: string;
      readonly status: string;
    }[];
  }>;
  readonly updateFunctionDeployment: (input: {
    readonly functionId: string;
    readonly deploymentId: string;
  }) => Promise<unknown>;
}

export async function captureProductionFunctionDeployment(
  functions: ProductionFunctionDeploymentsPort,
): Promise<string> {
  const current = await functions.get({ functionId: productionFunctionId });
  if (!deploymentId.test(current.deploymentId)) {
    throw new Error("PRODUCTION_FUNCTION_ACTIVE_DEPLOYMENT_INVALID");
  }
  return current.deploymentId;
}

export async function restoreProductionFunctionDeployment(
  functions: ProductionFunctionDeploymentsPort,
  targetDeploymentId: string,
  options: {
    readonly attempts?: number;
    readonly delay?: () => Promise<void>;
  } = {},
): Promise<void> {
  if (!deploymentId.test(targetDeploymentId)) {
    throw new Error("PRODUCTION_FUNCTION_ROLLBACK_TARGET_INVALID");
  }
  const deployments = await functions.listDeployments({
    functionId: productionFunctionId,
    queries: [Query.limit(100)],
    total: false,
  });
  const target = deployments.deployments.find(
    ({ $id, status }) => $id === targetDeploymentId && status === "ready",
  );
  if (!target) throw new Error("PRODUCTION_FUNCTION_ROLLBACK_TARGET_INVALID");

  await functions.updateFunctionDeployment({
    functionId: productionFunctionId,
    deploymentId: targetDeploymentId,
  });
  const attempts = options.attempts ?? 30;
  const delay =
    options.delay ??
    (() => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2_000)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await functions.get({ functionId: productionFunctionId });
    if (current.deploymentId === targetDeploymentId) return;
    if (attempt + 1 < attempts) await delay();
  }
  throw new Error("PRODUCTION_FUNCTION_ROLLBACK_TIMEOUT");
}

/* v8 ignore start -- composition and CLI execution require live Production authority. */
function productionFunctions(): ProductionFunctionDeploymentsPort {
  const config = parseServerConfig(process.env);
  if (config.environment !== "production") {
    throw new Error("PRODUCTION_FUNCTION_ROLLBACK_ENVIRONMENT_INVALID");
  }
  return new Functions(
    new Client()
      .setEndpoint(config.appwriteEndpoint)
      .setProject(config.appwriteProjectId)
      .setKey(config.appwriteApiKey),
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const functions = productionFunctions();
  if (command === "capture") {
    process.stdout.write(await captureProductionFunctionDeployment(functions));
    return;
  }
  if (command === "restore") {
    const target = process.env.Y7_PREVIOUS_FUNCTION_DEPLOYMENT_ID?.trim() ?? "";
    await restoreProductionFunctionDeployment(functions, target);
    process.stdout.write('{"result":"PRODUCTION_FUNCTION_ROLLBACK_PASSED"}\n');
    return;
  }
  throw new Error("PRODUCTION_FUNCTION_ROLLBACK_COMMAND_INVALID");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const code =
      error instanceof Error && /^PRODUCTION_FUNCTION_[A-Z_]+$/u.test(error.message)
        ? error.message
        : "PRODUCTION_FUNCTION_ROLLBACK_FAILED";
    process.stderr.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 1;
  });
}
/* v8 ignore stop */
