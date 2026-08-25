import { randomBytes, randomUUID } from "node:crypto";

import { Client, ID, Storage, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createHttpApplication } from "./application.js";
import { resolveAppwriteFunctionEnvironment } from "./appwrite-function-runtime.js";
import { routeRequest, type FunctionContext } from "./http.js";

const functionStartedAt = Date.now();

export default function handler(context: FunctionContext): Promise<unknown> {
  const config = parseServerConfig(
    resolveAppwriteFunctionEnvironment(process.env, context.req.headers ?? {}),
  );
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const dependencies = createHttpApplication(config, {
    tables,
    storage: new Storage(client),
    createId: () => ID.unique(),
    createReference: () =>
      `Y7-${String(new Date().getUTCFullYear())}-${randomBytes(6).toString("hex").toUpperCase()}`,
    createCorrelationId: randomUUID,
    nowIso: () => new Date().toISOString(),
    nowMs: Date.now,
    startedAt: () => functionStartedAt,
  });
  return routeRequest(context, dependencies);
}
