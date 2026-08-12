import { randomBytes, randomUUID } from "node:crypto";

import { Client, ID, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createHttpApplication } from "./application.js";
import { routeRequest, type FunctionContext } from "./http.js";

const config = parseServerConfig(process.env);
const client = new Client()
  .setEndpoint(config.appwriteEndpoint)
  .setProject(config.appwriteProjectId)
  .setKey(config.appwriteApiKey);
const tables = new TablesDB(client);
const dependencies = createHttpApplication(config, {
  tables,
  createId: () => ID.unique(),
  createReference: () =>
    `Y7-${String(new Date().getUTCFullYear())}-${randomBytes(6).toString("hex").toUpperCase()}`,
  createCorrelationId: randomUUID,
  nowIso: () => new Date().toISOString(),
  nowMs: Date.now,
  startedAt: Date.now,
});

export default function handler(context: FunctionContext): Promise<unknown> {
  return routeRequest(context, dependencies);
}
