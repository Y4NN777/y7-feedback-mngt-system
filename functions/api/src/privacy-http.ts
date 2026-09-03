import type { createPrivacyCoordinator, PrivacyOutcome } from "./privacy.js";

export interface PrivacyHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface PrivacyHttpResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface PrivacyHttp {
  handle(request: PrivacyHttpRequest): Promise<PrivacyHttpResponse | undefined>;
}

type Coordinator = ReturnType<typeof createPrivacyCoordinator>;
const pathPattern =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/privacy$/u;
const accountlessPath = "/v1/feedback/privacy";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function header(headers: Readonly<Record<string, string | undefined>>, name: string) {
  return Object.entries(headers).find(
    ([candidate]) => candidate.toLowerCase() === name.toLowerCase(),
  )?.[1];
}

function response(outcome: PrivacyOutcome): PrivacyHttpResponse {
  if (outcome.status === "ok")
    return { statusCode: 200, body: { status: "ok", result: outcome.result } };
  if (outcome.status === "denied")
    return { statusCode: 404, body: { error: "ERR-PRIVACY-DENIED" } };
  if (outcome.status === "invalid")
    return { statusCode: 400, body: { error: "ERR-PRIVACY-INVALID" } };
  if (outcome.status === "conflict")
    return { statusCode: 409, body: { error: "ERR-PRIVACY-CONFLICT" } };
  if (outcome.status === "expired")
    return { statusCode: 410, body: { error: "ERR-PRIVACY-EXPIRED" } };
  return { statusCode: 503, body: { error: "ERR-PRIVACY-RETRYABLE" } };
}

export function createPrivacyHttp(coordinator: Coordinator): PrivacyHttp {
  return {
    async handle(request) {
      const match = pathPattern.exec(request.path);
      const accountless = request.path === accountlessPath;
      if ((!match && !accountless) || request.method !== "POST") return undefined;
      const [, workspaceId, projectId] = match ?? [];
      if (
        !object(request.body) ||
        header(request.headers, "x-appwrite-user-id") !== undefined
      )
        return { statusCode: 404, body: { error: "ERR-PRIVACY-DENIED" } };
      const jwt = /^Bearer ([^\s]+)$/u.exec(
        header(request.headers, "authorization") ?? "",
      )?.[1];
      const authority = jwt
        ? ({ kind: "principal", jwt } as const)
        : typeof request.body.reference === "string" &&
            typeof request.body.proof === "string"
          ? ({
              kind: "access_proof",
              reference: request.body.reference,
              proof: request.body.proof,
            } as const)
          : undefined;
      if (!authority) return { statusCode: 404, body: { error: "ERR-PRIVACY-DENIED" } };
      if (accountless && authority.kind !== "access_proof")
        return { statusCode: 404, body: { error: "ERR-PRIVACY-DENIED" } };
      return response(
        await coordinator.execute({
          ...(workspaceId === undefined ? {} : { workspaceId }),
          ...(projectId === undefined ? {} : { projectId }),
          authority,
          command: request.body.command,
        }),
      );
    },
  };
}
