export interface FunctionRequest {
  readonly method: string;
  readonly path: string;
}

export interface FunctionResponse {
  json(
    body: unknown,
    statusCode?: number,
    headers?: Readonly<Record<string, string>>,
  ): unknown;
}

export interface FunctionContext {
  readonly req: FunctionRequest;
  readonly res: FunctionResponse;
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

export interface HttpDependencies {
  readonly createCorrelationId: () => string;
  readonly environment: "development" | "preview" | "production";
  readonly now: () => number;
  readonly release: string;
  readonly startedAt: () => number;
}

const defaultDependencies: HttpDependencies = {
  createCorrelationId: randomUUID,
  environment: "development",
  now: Date.now,
  release: "local",
  startedAt: Date.now,
};

export function routeRequest(
  { req, res, log }: FunctionContext,
  dependencies: HttpDependencies = defaultDependencies,
): unknown {
  const startedAt = dependencies.startedAt();
  const correlationId = dependencies.createCorrelationId();
  const headers = {
    "cache-control": "no-store",
    "x-correlation-id": correlationId,
  } as const;

  const isHealth = req.method === "GET" && req.path === "/health";
  const statusCode = isHealth ? 200 : 404;
  log(
    serializeOperationalEvent({
      event: "api.request.completed",
      correlationId,
      environment: dependencies.environment,
      release: dependencies.release,
      operation: isHealth ? "health" : "unknown",
      outcome: isHealth ? "success" : "not_found",
      statusCode,
      durationMs: Math.max(0, dependencies.now() - startedAt),
    }),
  );

  if (isHealth) {
    return res.json({ status: "ok" }, statusCode, headers);
  }

  return res.json({ error: "not_found" }, statusCode, headers);
}
import { randomUUID } from "node:crypto";

import { serializeOperationalEvent } from "./observability";
