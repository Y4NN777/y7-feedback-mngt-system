import type {
  ExternalIssueCoordinator,
  ExternalIssueOutcome,
} from "./external-issue-coordination.js";

export interface ExternalIssueHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface ExternalIssueHttpResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface ExternalIssueHttp {
  handle(
    request: ExternalIssueHttpRequest,
  ): Promise<ExternalIssueHttpResponse | undefined>;
}

const workspacePath =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/feedback\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/external-issue-link$/u;
const grantPath = "/v1/feedback/publication-consent/grant";
const revokePath = "/v1/feedback/publication-consent/revoke";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function header(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return Object.entries(headers).find(
    ([candidate]) => candidate.toLowerCase() === name.toLowerCase(),
  )?.[1];
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function failure(status: Exclude<ExternalIssueOutcome["status"], "ok">) {
  return status === "denied"
    ? { statusCode: 404, body: { error: "ERR-ISSUE-DENIED" } }
    : status === "conflict"
      ? { statusCode: 409, body: { error: "ERR-ISSUE-CONFLICT" } }
      : { statusCode: 503, body: { error: "ERR-ISSUE-RETRYABLE" } };
}

export function createExternalIssueHttp(
  coordinator: ExternalIssueCoordinator,
): ExternalIssueHttp {
  return {
    async handle(request) {
      const workspace = workspacePath.exec(request.path);
      const reporter = request.path === grantPath || request.path === revokePath;
      if (workspace === null && !reporter) return undefined;
      if (request.method !== "POST" || !object(request.body)) {
        return { statusCode: 404, body: { error: "ERR-ISSUE-DENIED" } };
      }
      if (workspace !== null) {
        const [, workspaceId, projectId, feedbackId] = workspace;
        const jwt = /^Bearer ([^\s]+)$/u.exec(
          header(request.headers, "authorization") ?? "",
        )?.[1];
        if (
          workspaceId === undefined ||
          projectId === undefined ||
          feedbackId === undefined ||
          jwt === undefined ||
          header(request.headers, "x-appwrite-user-id") !== undefined ||
          !exactKeys(
            request.body,
            ["operationId", "connectionId", "repositoryId"],
            ["consentVersion"],
          ) ||
          typeof request.body.operationId !== "string" ||
          typeof request.body.connectionId !== "string" ||
          typeof request.body.repositoryId !== "string" ||
          (request.body.consentVersion !== undefined &&
            typeof request.body.consentVersion !== "number")
        ) {
          return { statusCode: 404, body: { error: "ERR-ISSUE-DENIED" } };
        }
        const outcome = await coordinator.requestLink({
          jwt,
          workspaceId,
          projectId,
          feedbackId,
          command: {
            operationId: request.body.operationId,
            connectionId: request.body.connectionId,
            repositoryId: request.body.repositoryId,
            ...(request.body.consentVersion === undefined
              ? {}
              : { consentVersion: request.body.consentVersion }),
          },
        });
        return outcome.status === "ok"
          ? {
              statusCode: outcome.result.status === "accepted" ? 201 : 200,
              body: { status: outcome.result.status, result: outcome.result },
            }
          : failure(outcome.status);
      }

      const proof = /^FeedbackProof ([^\s]+)$/iu.exec(
        header(request.headers, "authorization") ?? "",
      )?.[1];
      const granting = request.path === grantPath;
      const required = granting
        ? ["operationId", "reference", "disclosureVersion", "audience"]
        : ["operationId", "reference"];
      if (
        proof === undefined ||
        !exactKeys(request.body, required) ||
        typeof request.body.operationId !== "string" ||
        typeof request.body.reference !== "string" ||
        (granting &&
          (typeof request.body.disclosureVersion !== "string" ||
            typeof request.body.audience !== "string"))
      ) {
        return { statusCode: 404, body: { error: "ERR-ISSUE-DENIED" } };
      }
      const outcome = granting
        ? await coordinator.grantConsent({
            operationId: request.body.operationId,
            reference: request.body.reference,
            proof,
            disclosureVersion: request.body.disclosureVersion as string,
            audience: request.body.audience as string,
          })
        : await coordinator.revokeConsent({
            operationId: request.body.operationId,
            reference: request.body.reference,
            proof,
          });
      return outcome.status === "ok"
        ? {
            statusCode: granting ? 201 : 200,
            body: { status: "ok", consent: outcome.consent },
          }
        : failure(outcome.status);
    },
  };
}
