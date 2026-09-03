import type {
  createPlatformAccessCoordinator,
  PlatformAccessOutcome,
} from "./platform-access.js";

export interface PlatformAccessHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface PlatformAccessHttpResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface PlatformAccessHttp {
  handle(
    request: PlatformAccessHttpRequest,
  ): Promise<PlatformAccessHttpResponse | undefined>;
}

type Coordinator = ReturnType<typeof createPlatformAccessCoordinator>;
const commandPath = "/v1/platform/exceptional-access/commands";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bearer(headers: Readonly<Record<string, string | undefined>>): string | null {
  const value = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "authorization",
  )?.[1];
  const match = /^Bearer ([^\s]+)$/u.exec(value ?? "");
  return match?.[1] && match[1].length <= 4096 ? match[1] : null;
}

function response(outcome: PlatformAccessOutcome): PlatformAccessHttpResponse {
  switch (outcome.status) {
    case "ok":
      return { statusCode: 200, body: { status: "ok", result: outcome.result } };
    case "invalid":
      return { statusCode: 400, body: { error: "ERR-PLATFORM-ACCESS-INVALID" } };
    case "denied":
      return { statusCode: 403, body: { error: "ERR-PLATFORM-ACCESS-DENIED" } };
    case "conflict":
      return { statusCode: 409, body: { error: "ERR-PLATFORM-ACCESS-CONFLICT" } };
    case "retryable":
      return { statusCode: 503, body: { error: "ERR-PLATFORM-ACCESS-RETRYABLE" } };
  }
}

export function createPlatformAccessHttp(coordinator: Coordinator): PlatformAccessHttp {
  return {
    async handle(request) {
      if (request.path !== commandPath || request.method !== "POST") return undefined;
      const jwt = bearer(request.headers);
      if (jwt === null || !object(request.body))
        return { statusCode: 403, body: { error: "ERR-PLATFORM-ACCESS-DENIED" } };
      return response(await coordinator.execute({ jwt, command: request.body }));
    },
  };
}
