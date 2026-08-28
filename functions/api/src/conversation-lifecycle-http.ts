import type {
  ConversationLifecycleCoordinator,
  ConversationLifecycleOutcome,
  ConversationProjectionOutcome,
} from "./conversation-lifecycle.js";

export interface ConversationLifecycleHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface ConversationLifecycleHttpResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface ConversationLifecycleHttp {
  handle(
    request: ConversationLifecycleHttpRequest,
  ): Promise<ConversationLifecycleHttpResponse | undefined>;
}

const workspacePath =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/feedback\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/conversation\/commands$/u;
const reporterPath =
  /^\/v1\/feedback\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/conversation\/commands$/u;
const workspaceProjectionPath =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/feedback\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/conversation$/u;
const reporterProjectionPath =
  /^\/v1\/feedback\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/conversation\/retrieve$/u;

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

function outcome(
  value: ConversationLifecycleOutcome,
): ConversationLifecycleHttpResponse {
  switch (value.status) {
    case "ok":
      return {
        statusCode: value.result.status === "replayed" ? 200 : 201,
        body: { status: value.result.status, result: value.result },
      };
    case "invalid":
      return { statusCode: 400, body: { error: "ERR-CONV-INVALID" } };
    case "denied":
      return { statusCode: 404, body: { error: "ERR-CONV-DENIED" } };
    case "conflict":
      return {
        statusCode: 409,
        body: { error: "ERR-CONV-IDEMPOTENCY-CONFLICT" },
      };
    case "stale":
      return { statusCode: 409, body: { error: "ERR-CONV-STALE" } };
    case "retryable":
      return { statusCode: 503, body: { error: "ERR-CONV-RETRYABLE" } };
  }
}

function projectionOutcome(
  value: ConversationProjectionOutcome,
): ConversationLifecycleHttpResponse {
  return value.status === "ok"
    ? { statusCode: 200, body: { status: "ok", conversation: value.projection } }
    : value.status === "denied"
      ? { statusCode: 404, body: { error: "ERR-CONV-DENIED" } }
      : { statusCode: 503, body: { error: "ERR-CONV-RETRYABLE" } };
}

export function createConversationLifecycleHttp(
  coordinator: ConversationLifecycleCoordinator,
): ConversationLifecycleHttp {
  return {
    async handle(request) {
      const workspaceProjection = workspaceProjectionPath.exec(request.path);
      if (request.method === "GET" && workspaceProjection !== null) {
        const [, workspaceId, projectId, feedbackId] = workspaceProjection;
        const bearer = /^Bearer ([^\s]+)$/u.exec(
          header(request.headers, "authorization") ?? "",
        );
        if (
          workspaceId === undefined ||
          projectId === undefined ||
          feedbackId === undefined ||
          bearer?.[1] === undefined ||
          header(request.headers, "x-appwrite-user-id") !== undefined
        ) {
          return { statusCode: 404, body: { error: "ERR-CONV-DENIED" } };
        }
        return projectionOutcome(
          await coordinator.readWorkspace({
            jwt: bearer[1],
            workspaceId,
            projectId,
            feedbackId,
          }),
        );
      }
      if (request.method !== "POST") return undefined;
      const workspace = workspacePath.exec(request.path);
      if (workspace !== null) {
        const [, workspaceId, projectId, feedbackId] = workspace;
        const bearer = /^Bearer ([^\s]+)$/u.exec(
          header(request.headers, "authorization") ?? "",
        );
        if (
          workspaceId === undefined ||
          projectId === undefined ||
          feedbackId === undefined ||
          bearer?.[1] === undefined ||
          header(request.headers, "x-appwrite-user-id") !== undefined ||
          !object(request.body) ||
          request.body.command === undefined
        ) {
          return { statusCode: 404, body: { error: "ERR-CONV-DENIED" } };
        }
        return outcome(
          await coordinator.executeWorkspace({
            jwt: bearer[1],
            workspaceId,
            projectId,
            feedbackId,
            command: request.body.command,
          }),
        );
      }

      const reporterProjection = reporterProjectionPath.exec(request.path);
      const reporter = reporterPath.exec(request.path);
      const reporterMatch = reporterProjection ?? reporter;
      if (reporterMatch === null) return undefined;
      const feedbackId = reporterMatch[1];
      const proof = /^FeedbackProof ([^\s]+)$/iu.exec(
        header(request.headers, "authorization") ?? "",
      )?.[1];
      if (
        feedbackId === undefined ||
        proof === undefined ||
        !object(request.body) ||
        typeof request.body.reference !== "string" ||
        request.body.reference.length < 1 ||
        request.body.reference.length > 100 ||
        (reporter !== null && request.body.command === undefined)
      ) {
        return { statusCode: 404, body: { error: "ERR-CONV-DENIED" } };
      }
      return reporterProjection !== null
        ? projectionOutcome(
            await coordinator.readReporter({
              reference: request.body.reference,
              proof,
              feedbackId,
            }),
          )
        : outcome(
            await coordinator.executeReporter({
              reference: request.body.reference,
              proof,
              feedbackId,
              command: request.body.command,
            }),
          );
    },
  };
}
