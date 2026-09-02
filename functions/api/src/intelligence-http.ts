import type {
  createIntelligenceCoordinator,
  IntelligenceOutcome,
} from "./intelligence.js";
import type {
  createIntelligenceProvenanceCoordinator,
  IntelligenceProvenanceOutcome,
} from "./intelligence-provenance.js";

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
type IntelligenceProvenanceCoordinator = ReturnType<
  typeof createIntelligenceProvenanceCoordinator
>;

const analysisPath =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/intelligence$/u;
const provenancePath =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/intelligence\/provenance$/u;

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

function provenanceResponse(
  outcome: IntelligenceProvenanceOutcome,
): IntelligenceHttpResponse {
  if (outcome.status === "ok")
    return { statusCode: 200, body: { status: "ok", result: outcome.result } };
  if (outcome.status === "denied")
    return { statusCode: 404, body: { error: "ERR-INTELLIGENCE-DENIED" } };
  if (outcome.status === "invalid")
    return { statusCode: 400, body: { error: "ERR-INTELLIGENCE-INVALID" } };
  if (outcome.status === "conflict")
    return { statusCode: 409, body: { error: "ERR-INTELLIGENCE-CONFLICT" } };
  return { statusCode: 503, body: { error: "ERR-INTELLIGENCE-RETRYABLE" } };
}

export function createIntelligenceHttp(
  coordinator: IntelligenceCoordinator,
  provenance?: IntelligenceProvenanceCoordinator,
): IntelligenceHttp {
  return {
    async handle(request) {
      const provenanceMatch = provenancePath.exec(request.path);
      const match = provenanceMatch ?? analysisPath.exec(request.path);
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
      if (provenanceMatch !== null) {
        if (provenance === undefined)
          return { statusCode: 503, body: { error: "ERR-INTELLIGENCE-RETRYABLE" } };
        return provenanceResponse(
          await provenance.execute({
            jwt,
            workspaceId,
            projectId,
            command: request.body,
          }),
        );
      }
      return response(
        await coordinator.analyze({ jwt, workspaceId, projectId, query: request.body }),
      );
    },
  };
}
