import type { ProjectAdministration } from "./project-administration.js";

export interface ProjectAdministrationHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface ProjectAdministrationHttpResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface ProjectAdministrationHttp {
  handle(
    request: ProjectAdministrationHttpRequest,
  ): Promise<ProjectAdministrationHttpResponse | undefined>;
}

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bearer(headers: Readonly<Record<string, string | undefined>>): string | null {
  const authorization = headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  const jwt = authorization.slice("Bearer ".length).trim();
  return jwt.length > 0 && jwt.length <= 4096 ? jwt : null;
}

export function createProjectAdministrationHttp(
  administration: ProjectAdministration,
): ProjectAdministrationHttp {
  return {
    async handle(request) {
      const createMatch = /^\/v1\/workspaces\/([^/]+)\/projects$/u.exec(request.path);
      const commandMatch =
        /^\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/commands$/u.exec(request.path);
      const match = createMatch ?? commandMatch;
      if (request.method !== "POST" || match === null) return undefined;
      const workspaceId = match[1];
      const projectId = commandMatch?.[2];
      const jwt = bearer(request.headers);
      if (
        workspaceId === undefined ||
        jwt === null ||
        !object(request.body) ||
        request.body.workspaceId !== workspaceId ||
        (projectId !== undefined && request.body.projectId !== projectId) ||
        (projectId === undefined && request.body.kind !== "create_project") ||
        (projectId !== undefined && request.body.kind === "create_project")
      ) {
        return { statusCode: 403, body: { error: "ERR-ADMIN-DENIED" } };
      }

      const outcome = await administration.execute({ jwt, command: request.body });
      switch (outcome.status) {
        case "ok":
          return {
            statusCode: createMatch === null ? 200 : 201,
            body: { status: "ok", project: outcome.result },
          };
        case "invalid":
          return {
            statusCode: 400,
            body: { error: "ERR-ADMIN-COMMAND-INVALID" },
          };
        case "denied":
          return { statusCode: 403, body: { error: "ERR-ADMIN-DENIED" } };
        case "conflict":
          return {
            statusCode: 409,
            body: { error: "ERR-ADMIN-IDEMPOTENCY-CONFLICT" },
          };
        case "slug_reserved":
          return {
            statusCode: 409,
            body: { error: "ERR-ADMIN-SLUG-RESERVED" },
          };
        case "retryable":
          return { statusCode: 503, body: { error: "ERR-ADMIN-RETRYABLE" } };
      }
    },
  };
}
