import { randomUUID } from "node:crypto";

import { parseServerConfig } from "@y7-feedback/config/server";

import { routeRequest, type FunctionContext } from "./http";

const config = parseServerConfig(process.env);

export default function handler(context: FunctionContext): unknown {
  return routeRequest(context, {
    createCorrelationId: randomUUID,
    environment: config.environment,
    now: Date.now,
    release: config.release,
    startedAt: Date.now,
  });
}
