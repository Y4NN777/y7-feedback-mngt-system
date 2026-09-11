import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Client, ID, Storage, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createHttpApplication } from "./application.js";
import {
  resolveAppwriteFunctionEnvironment,
  resolveAppwriteFunctionPrincipal,
} from "./appwrite-function-runtime.js";
import { routeRequest, type FunctionContext } from "./http.js";

export default function handler(context: FunctionContext): Promise<unknown> {
  const requestHeaders = context.req.headers ?? {};
  const config = parseServerConfig(
    resolveAppwriteFunctionEnvironment(process.env, requestHeaders),
  );
  const functionPrincipal = resolveAppwriteFunctionPrincipal(requestHeaders);
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const dependencies = createHttpApplication(config, {
    tables,
    storage: new Storage(client),
    users: new Users(client),
    createId: () => ID.unique(),
    createReference: () =>
      `Y7-${String(new Date().getUTCFullYear())}-${randomBytes(6).toString("hex").toUpperCase()}`,
    createCorrelationId: randomUUID,
    nowIso: () => new Date().toISOString(),
    nowMs: Date.now,
    startedAt: Date.now,
    ...(functionPrincipal === undefined
      ? {}
      : {
          principalVerifier: {
            verify: (jwt: string) =>
              Promise.resolve(
                jwt === functionPrincipal.jwt
                  ? {
                      status: "verified" as const,
                      principalId: functionPrincipal.principalId,
                    }
                  : { status: "denied" as const },
              ),
          },
        }),
    createProviderNonce: () => randomBytes(24).toString("base64url"),
    digestProviderNonce: (nonce) =>
      createHash("sha256").update(nonce).digest("base64url"),
    providerDiagnostic: (event) => {
      context.log(JSON.stringify({ event: "source_provider", ...event }));
    },
    notificationDiagnostic: (event) => {
      context.log(JSON.stringify(event));
    },
    conversationLifecycleDiagnostic: (event) => {
      context.log(JSON.stringify({ event: "conversation_lifecycle_phase", ...event }));
    },
  });
  return routeRequest(context, dependencies);
}
