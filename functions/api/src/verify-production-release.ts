/* v8 ignore file -- this adapter is exercised only against live Production authorities. */
import { gzipSync } from "node:zlib";
import { Client, DeploymentStatus, Functions, Query } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import {
  appwriteFunctionVariableKeys,
  productionFunctionId,
} from "./appwrite-function-variables.js";
import { createClamAvHttpScanner } from "./clamav-http-scanner.js";
import { parseClamAvHttpScannerConfig } from "./clamav-http-scanner-config.js";
import { assertProductionReleaseReady } from "./production-release-policy.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("PRODUCTION_RELEASE_CONFIGURATION_MISSING");
  return value;
}

function origin(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("PRODUCTION_RELEASE_CONFIGURATION_INVALID");
  }
  return parsed.origin;
}

async function healthy(url: URL): Promise<Response | undefined> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    return response.ok ? response : undefined;
  } catch {
    return undefined;
  }
}

async function safelyDenied(url: URL, method: "GET" | "POST"): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      ...(method === "POST" ? { body: "{}" } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (![400, 401, 403].includes(response.status)) return false;
    const body = (await response.json()) as unknown;
    return (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string" &&
      /^ERR-[A-Z0-9-]+$/u.test(body.error)
    );
  } catch {
    return false;
  }
}

async function waitForDeployment(
  functions: Functions,
  functionId: string,
  deploymentId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await functions.get({ functionId });
    if (current.deploymentId === deploymentId) return true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

async function main(): Promise<void> {
  if (
    !process.argv.includes("--apply") ||
    !process.argv.includes("--rehearse-rollback")
  ) {
    throw new Error("PRODUCTION_RELEASE_EXPLICIT_REHEARSAL_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment !== "production" || !config.antivirusScanner) {
    throw new Error("PRODUCTION_RELEASE_CONFIGURATION_INVALID");
  }
  const functionOrigin = origin(required("Y7_FUNCTION_DOMAIN_URL"));
  const previewFunctionOrigin = origin(required("Y7_PREVIEW_FUNCTION_DOMAIN_URL"));
  const previewWebOrigin = origin(required("Y7_PREVIEW_WEB_ORIGIN"));
  const previewScannerOrigin = origin(required("Y7_PREVIEW_SCANNER_ENDPOINT"));
  const previewProjectId = required("Y7_PREVIEW_APPWRITE_PROJECT_ID");
  const scannerOrigin = origin(config.antivirusScanner.endpoint);
  const webOrigin = origin(config.webOrigin);

  const functions = new Functions(
    new Client()
      .setEndpoint(config.appwriteEndpoint)
      .setProject(config.appwriteProjectId)
      .setKey(config.appwriteApiKey),
  );
  const definition = await functions.get({ functionId: productionFunctionId });
  const deployments = await functions.listDeployments({
    functionId: productionFunctionId,
    queries: [Query.orderDesc("$createdAt"), Query.limit(10)],
    total: false,
  });
  const active = deployments.deployments.find(
    ({ $id }) => $id === definition.deploymentId,
  );
  const rollback = deployments.deployments.find(
    ({ $id, status }) =>
      $id !== definition.deploymentId && status === DeploymentStatus.Ready,
  );
  if (!active || !rollback) throw new Error("PRODUCTION_RELEASE_ROLLBACK_MISSING");

  const variables = new Map(
    definition.vars.map((variable) => [variable.key, variable]),
  );
  const missingFunctionVariables = appwriteFunctionVariableKeys.filter(
    (key) => !variables.has(key),
  );
  const nonSecretFunctionVariables = appwriteFunctionVariableKeys.filter(
    (key) => variables.get(key)?.secret !== true,
  );

  let functionRollbackPassed = false;
  let functionRollForwardPassed = false;
  try {
    await functions.updateFunctionDeployment({
      functionId: productionFunctionId,
      deploymentId: rollback.$id,
    });
    functionRollbackPassed =
      (await waitForDeployment(functions, productionFunctionId, rollback.$id)) &&
      (await healthy(new URL("/health", functionOrigin))) !== undefined;
  } finally {
    await functions.updateFunctionDeployment({
      functionId: productionFunctionId,
      deploymentId: active.$id,
    });
    functionRollForwardPassed =
      (await waitForDeployment(functions, productionFunctionId, active.$id)) &&
      (await healthy(new URL("/health", functionOrigin))) !== undefined;
  }

  const [functionHealth, scannerHealth, webHealth, webHeaders] = await Promise.all([
    healthy(new URL("/health", functionOrigin)),
    healthy(new URL("/health", scannerOrigin)),
    healthy(new URL("/", webOrigin)),
    healthy(new URL("/index.html", webOrigin)),
  ]);
  const providerBoundariesDenyUnsafeRequests = (
    await Promise.all([
      safelyDenied(new URL("/providers/github/callback", functionOrigin), "GET"),
      safelyDenied(new URL("/providers/gitlab/callback", functionOrigin), "GET"),
      safelyDenied(new URL("/providers/github/webhooks/probe", functionOrigin), "POST"),
      safelyDenied(new URL("/providers/gitlab/webhooks/probe", functionOrigin), "POST"),
    ])
  ).every(Boolean);
  const scanner = createClamAvHttpScanner(parseClamAvHttpScannerConfig(process.env));
  const [cleanVerdict, infectedVerdict] = await Promise.all([
    scanner.scan(new TextEncoder().encode("Y7 production scanner clean probe")),
    scanner.scan(
      gzipSync("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"),
    ),
  ]);
  const cacheControl = webHeaders?.headers.get("cache-control") ?? "";
  const result = assertProductionReleaseReady({
    productionProjectId: config.appwriteProjectId,
    previewProjectId,
    productionFunctionId: definition.$id,
    previewFunctionId: "y7-feedback-api-preview",
    productionWebOrigin: webOrigin,
    previewWebOrigin,
    productionFunctionOrigin: functionOrigin,
    previewFunctionOrigin,
    productionScannerOrigin: scannerOrigin,
    previewScannerOrigin,
    activeDeploymentReady: active.status === DeploymentStatus.Ready,
    rollbackDeploymentReady: rollback.status === DeploymentStatus.Ready,
    functionScopes: definition.scopes,
    missingFunctionVariables,
    nonSecretFunctionVariables,
    functionHealthReady: functionHealth !== undefined,
    scannerHealthReady: scannerHealth !== undefined,
    scannerMatrixPassed: cleanVerdict === "clean" && infectedVerdict === "infected",
    providerBoundariesDenyUnsafeRequests,
    webHealthReady: webHealth !== undefined,
    webHeaders: {
      contentSecurityPolicy: Boolean(
        webHeaders?.headers.get("content-security-policy"),
      ),
      referrerPolicy: webHeaders?.headers.get("referrer-policy") === "no-referrer",
      contentTypeOptions:
        webHeaders?.headers.get("x-content-type-options") === "nosniff",
      cacheRevalidation:
        cacheControl.includes("max-age=0") && cacheControl.includes("must-revalidate"),
    },
    functionRollbackPassed,
    functionRollForwardPassed,
  });
  process.stdout.write(
    `${JSON.stringify({ result: "PRODUCTION_RELEASE_READY", checks: result.checks })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : "PRODUCTION_RELEASE_FAILED" })}\n`,
  );
  process.exitCode = 1;
});
