import { randomUUID } from "node:crypto";

import { serializeOperationalEvent } from "./observability.js";
import type { PublicApi } from "./public-api.js";

export interface FunctionRequest {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly bodyJson?: unknown;
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
  readonly publicApi?: PublicApi;
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

export async function routeRequest(
  { req, res, log }: FunctionContext,
  dependencies: HttpDependencies = defaultDependencies,
): Promise<unknown> {
  const startedAt = dependencies.startedAt();
  const correlationId = dependencies.createCorrelationId();
  const headers = {
    "cache-control": "no-store",
    "x-correlation-id": correlationId,
  } as const;

  const isHealth = req.method === "GET" && req.path === "/health";
  const publicResponse = isHealth
    ? null
    : await dependencies.publicApi?.handle({
        method: req.method,
        path: req.path,
        headers: req.headers ?? {},
        body: req.bodyJson,
      });
  const statusCode = isHealth ? 200 : (publicResponse?.statusCode ?? 404);
  const operation = isHealth ? "health" : publicResponse ? "public_api" : "unknown";
  const outcome = isHealth
    ? "success"
    : publicResponse
      ? statusCode < 400
        ? "success"
        : "rejected"
      : "not_found";
  log(
    serializeOperationalEvent({
      event: "api.request.completed",
      correlationId,
      environment: dependencies.environment,
      release: dependencies.release,
      operation,
      outcome,
      statusCode,
      durationMs: Math.max(0, dependencies.now() - startedAt),
    }),
  );

  if (isHealth) {
    return res.json({ status: "ok" }, statusCode, headers);
  }

  if (publicResponse) {
    return res.json(publicResponse.body, publicResponse.statusCode, headers);
  }

  return res.json({ error: "not_found" }, statusCode, headers);
}
