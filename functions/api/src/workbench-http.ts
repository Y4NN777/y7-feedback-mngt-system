import { validateWorkbenchFilter } from "@y7-feedback/domain";

import type { WorkbenchCoordinator, WorkbenchOutcome } from "./workbench.js";

export interface WorkbenchHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly query: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface WorkbenchHttpResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface WorkbenchHttp {
  handle(request: WorkbenchHttpRequest): Promise<WorkbenchHttpResponse | undefined>;
}

const inboxPath =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/workbench$/u;
const detailPath =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/workbench\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})$/u;

function header(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return Object.entries(headers).find(
    ([candidate]) => candidate.toLowerCase() === name.toLowerCase(),
  )?.[1];
}

function response(outcome: WorkbenchOutcome): WorkbenchHttpResponse {
  if (outcome.status === "ok") {
    return { statusCode: 200, body: { status: "ok", result: outcome.result } };
  }
  return outcome.status === "denied"
    ? { statusCode: 404, body: { error: "ERR-WORK-DENIED" } }
    : outcome.status === "invalid"
      ? { statusCode: 400, body: { error: "ERR-WORK-COMMAND-INVALID" } }
      : outcome.status === "conflict"
        ? { statusCode: 409, body: { error: "ERR-WORK-CONFLICT" } }
        : { statusCode: 503, body: { error: "ERR-WORK-RETRYABLE" } };
}

export function createWorkbenchHttp(coordinator: WorkbenchCoordinator): WorkbenchHttp {
  return {
    async handle(request) {
      const detail = detailPath.exec(request.path);
      const inbox = inboxPath.exec(request.path);
      const match = detail ?? inbox;
      if (match === null) return undefined;
      const [, workspaceId, projectId, feedbackId] = match;
      const jwt = /^Bearer ([^\s]+)$/u.exec(
        header(request.headers, "authorization") ?? "",
      )?.[1];
      if (
        workspaceId === undefined ||
        projectId === undefined ||
        jwt === undefined ||
        header(request.headers, "x-appwrite-user-id") !== undefined
      ) {
        return { statusCode: 404, body: { error: "ERR-WORK-DENIED" } };
      }
      if (request.method === "POST" && feedbackId !== undefined) {
        return response(
          await coordinator.execute({
            jwt,
            workspaceId,
            projectId,
            feedbackId,
            command: request.body,
          }),
        );
      }
      if (request.method !== "GET") return undefined;
      if (feedbackId !== undefined) {
        return response(
          await coordinator.read({ jwt, workspaceId, projectId, feedbackId }),
        );
      }
      let filter;
      try {
        const list = (value: string | undefined) =>
          value === undefined || value === "" ? [] : value.split(",");
        filter = validateWorkbenchFilter({
          types: list(request.query.type),
          states: list(request.query.state),
          assignment: request.query.assignment ?? "all",
          ...(request.query.acceptedFrom === undefined
            ? {}
            : { acceptedFrom: request.query.acceptedFrom }),
          ...(request.query.acceptedTo === undefined
            ? {}
            : { acceptedTo: request.query.acceptedTo }),
        });
      } catch {
        return { statusCode: 400, body: { error: "ERR-WORK-FILTER-INVALID" } };
      }
      return response(await coordinator.list({ jwt, workspaceId, projectId, filter }));
    },
  };
}
