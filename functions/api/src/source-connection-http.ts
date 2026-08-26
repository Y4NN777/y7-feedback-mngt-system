import type { SourceProvider } from "@y7-feedback/domain";

import type { SourceConnectionCoordinator } from "./source-connection-coordinator.js";

export interface SourceConnectionHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly query: Readonly<Record<string, string | undefined>>;
  readonly body: unknown;
}

export interface SourceConnectionHttpResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

const scopedPath =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/source-connections\/(.+)$/u;
const callbackPath = /^\/providers\/(github|gitlab)\/callback$/u;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function header(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
}

function bearer(headers: Readonly<Record<string, string | undefined>>): string {
  const match = /^Bearer ([^\s]+)$/u.exec(header(headers, "authorization") ?? "");
  if (!match?.[1] || match[1].length > 4_096) throw new Error("SOURCE_INPUT_INVALID");
  return match[1];
}

function provider(value: string): SourceProvider | undefined {
  /* v8 ignore next -- route regexes admit only the two exhaustive providers */
  return value === "github" || value === "gitlab" ? value : undefined;
}

function mapped(outcome: { readonly status: string }, successBody?: unknown) {
  if (
    outcome.status === "ok" ||
    outcome.status === "pending_selection" ||
    outcome.status === "active" ||
    outcome.status === "disconnected"
  ) {
    return { statusCode: 200, body: successBody ?? outcome } as const;
  }
  return outcome.status === "retryable"
    ? ({ statusCode: 503, body: { error: "ERR-SOURCE-UNAVAILABLE" } } as const)
    : ({ statusCode: 404, body: { error: "ERR-SOURCE-DENIED" } } as const);
}

function validateCallbacks(callbacks: Readonly<Record<SourceProvider, string>>): void {
  for (const [sourceProvider, value] of Object.entries(callbacks)) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== `/providers/${sourceProvider}/callback`
      ) {
        throw new Error("SOURCE_HTTP_CONFIG_INVALID");
      }
    } catch {
      throw new Error("SOURCE_HTTP_CONFIG_INVALID");
    }
  }
}

export function createSourceConnectionHttp(
  coordinator: SourceConnectionCoordinator,
  callbacks: Readonly<Record<SourceProvider, string>>,
) {
  validateCallbacks(callbacks);
  return {
    async handle(
      request: SourceConnectionHttpRequest,
    ): Promise<SourceConnectionHttpResponse | null> {
      const callback = callbackPath.exec(request.path);
      if (request.method === "GET" && callback) {
        /* v8 ignore next -- callbackPath always captures a provider */
        const sourceProvider = provider(callback[1] ?? "");
        const state = request.query.state;
        const code = request.query.code;
        /* v8 ignore next -- provider absence is excluded by callbackPath */
        if (!sourceProvider || !state || !code) {
          return { statusCode: 404, body: { error: "ERR-SOURCE-DENIED" } };
        }
        return mapped(
          await coordinator.complete({
            provider: sourceProvider,
            state,
            code,
            redirectUri: callbacks[sourceProvider],
          }),
        );
      }

      const scoped = scopedPath.exec(request.path);
      if (request.method !== "POST" || !scoped) return null;
      const workspaceId = scoped[1];
      const projectId = scoped[2];
      const action = scoped[3];
      if (!workspaceId || !projectId || !action || !isObject(request.body)) {
        return { statusCode: 404, body: { error: "ERR-SOURCE-DENIED" } };
      }
      try {
        const jwt = bearer(request.headers);
        const beginMatch = /^(github|gitlab)\/begin$/u.exec(action);
        if (beginMatch) {
          /* v8 ignore next -- beginMatch always captures a provider */
          const sourceProvider = provider(beginMatch[1] ?? "");
          /* v8 ignore next -- provider absence is excluded by beginMatch */
          if (!sourceProvider || typeof request.body.returnPath !== "string") {
            throw new Error("SOURCE_INPUT_INVALID");
          }
          const outcome = await coordinator.begin({
            jwt,
            workspaceId,
            projectId,
            provider: sourceProvider,
            returnPath: request.body.returnPath,
            redirectUri: callbacks[sourceProvider],
          });
          return mapped(
            outcome,
            outcome.status === "ok"
              ? { status: "ok", authorizationUrl: outcome.authorizationUrl }
              : undefined,
          );
        }

        const commandMatch =
          /^([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/(select|disconnect)$/u.exec(action);
        const connectionId = commandMatch?.[1];
        const command = commandMatch?.[2];
        if (!connectionId || !identifier.test(connectionId) || !command) {
          throw new Error("SOURCE_INPUT_INVALID");
        }
        if (command === "select") {
          if (
            !Array.isArray(request.body.repositoryIds) ||
            !request.body.repositoryIds.every((id) => typeof id === "string")
          ) {
            throw new Error("SOURCE_INPUT_INVALID");
          }
          return mapped(
            await coordinator.select({
              jwt,
              workspaceId,
              projectId,
              connectionId,
              repositoryIds: request.body.repositoryIds,
            }),
          );
        }
        return mapped(
          await coordinator.disconnect({
            jwt,
            workspaceId,
            projectId,
            connectionId,
          }),
        );
      } catch {
        return { statusCode: 404, body: { error: "ERR-SOURCE-DENIED" } };
      }
    },
  };
}

export type SourceConnectionHttp = ReturnType<typeof createSourceConnectionHttp>;
