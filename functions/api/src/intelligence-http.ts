import type {
  createIntelligenceCoordinator,
  IntelligenceOutcome,
} from "./intelligence.js";

export interface IntelligenceHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface IntelligenceHttpResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface IntelligenceHttp {
  handle(
    request: IntelligenceHttpRequest,
  ): Promise<IntelligenceHttpResponse | undefined>;
}

type IntelligenceCoordinator = ReturnType<typeof createIntelligenceCoordinator>;

const analysisPath =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/intelligence$/u;

function header(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return Object.entries(headers).find(
    ([candidate]) => candidate.toLowerCase() === name.toLowerCase(),
  )?.[1];
}

function response(outcome: IntelligenceOutcome): IntelligenceHttpResponse {
  if (outcome.status === "ok") {
    return { statusCode: 200, body: { status: "ok", result: outcome.result } };
  }
  return outcome.status === "denied"
    ? { statusCode: 404, body: { error: "ERR-INTELLIGENCE-DENIED" } }
    : outcome.status === "invalid"
      ? { statusCode: 400, body: { error: "ERR-INTELLIGENCE-INVALID" } }
      : { statusCode: 503, body: { error: "ERR-INTELLIGENCE-RETRYABLE" } };
}

export function createIntelligenceHttp(
  coordinator: IntelligenceCoordinator,
): IntelligenceHttp {
  return {
    async handle(request) {
      const match = analysisPath.exec(request.path);
      if (match === null || request.method !== "POST") return undefined;
      const [, workspaceId, projectId] = match;
      const jwt = /^Bearer ([^\s]+)$/u.exec(
        header(request.headers, "authorization") ?? "",
      )?.[1];
      if (
        workspaceId === undefined ||
        projectId === undefined ||
        jwt === undefined ||
        header(request.headers, "x-appwrite-user-id") !== undefined
      ) {
        return { statusCode: 404, body: { error: "ERR-INTELLIGENCE-DENIED" } };
      }
      return response(
        await coordinator.analyze({
          jwt,
          workspaceId,
          projectId,
          query: request.body,
        }),
      );
    },
  };
}
