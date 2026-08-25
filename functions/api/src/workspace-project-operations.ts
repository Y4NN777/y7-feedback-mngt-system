import type { ProjectCapability } from "@y7-feedback/domain";

import type { WorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope.js";
import type { AppwritePrincipalVerifier } from "./workspace-attachment-download.js";

export interface WorkspaceProjectRequest {
  readonly jwt: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

export interface ScopedProjectIdentity {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly principalId: string;
}

export interface WorkspaceFeedbackPort {
  create(
    scope: ScopedProjectIdentity,
    command: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  read(scope: ScopedProjectIdentity, feedbackId: string): Promise<unknown>;
  update(
    scope: ScopedProjectIdentity,
    feedbackId: string,
    command: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  delete(scope: ScopedProjectIdentity, feedbackId: string): Promise<void>;
  search(scope: ScopedProjectIdentity, query: string): Promise<unknown>;
  aggregate(scope: ScopedProjectIdentity): Promise<unknown>;
}

export interface WorkspaceNotificationPort {
  list(scope: ScopedProjectIdentity): Promise<unknown>;
}

export interface WorkspaceRealtimePort {
  authorize(scope: ScopedProjectIdentity): Promise<unknown>;
}

export interface WorkspaceProjectOperationPorts {
  readonly feedback: WorkspaceFeedbackPort;
  readonly notifications: WorkspaceNotificationPort;
  readonly realtime: WorkspaceRealtimePort;
}

export type WorkspaceOperationOutcome =
  | { readonly status: "ok"; readonly data?: unknown }
  | { readonly status: "denied" | "retryable" };

export interface WorkspaceProjectOperations {
  createFeedback(
    request: WorkspaceProjectRequest & {
      readonly command: Readonly<Record<string, unknown>>;
    },
  ): Promise<WorkspaceOperationOutcome>;
  readFeedback(
    request: WorkspaceProjectRequest & { readonly feedbackId: string },
  ): Promise<WorkspaceOperationOutcome>;
  updateFeedback(
    request: WorkspaceProjectRequest & {
      readonly feedbackId: string;
      readonly command: Readonly<Record<string, unknown>>;
    },
  ): Promise<WorkspaceOperationOutcome>;
  deleteFeedback(
    request: WorkspaceProjectRequest & { readonly feedbackId: string },
  ): Promise<WorkspaceOperationOutcome>;
  searchFeedback(
    request: WorkspaceProjectRequest & { readonly query: string },
  ): Promise<WorkspaceOperationOutcome>;
  aggregateFeedback(
    request: WorkspaceProjectRequest,
  ): Promise<WorkspaceOperationOutcome>;
  listNotifications(
    request: WorkspaceProjectRequest,
  ): Promise<WorkspaceOperationOutcome>;
  authorizeRealtime(
    request: WorkspaceProjectRequest,
  ): Promise<WorkspaceOperationOutcome>;
}

type Execute = (scope: ScopedProjectIdentity) => Promise<unknown>;

export function createWorkspaceProjectOperations(
  principal: AppwritePrincipalVerifier,
  scopeResolver: WorkspaceCapabilityScopeResolver,
  ports: WorkspaceProjectOperationPorts,
): WorkspaceProjectOperations {
  async function execute(
    request: WorkspaceProjectRequest,
    capability: ProjectCapability,
    operation: Execute,
  ): Promise<WorkspaceOperationOutcome> {
    const verification = await principal.verify(request.jwt);
    if (verification.status !== "verified") return verification;
    const authorization = await scopeResolver.resolve({
      principalId: verification.principalId,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      capability,
    });
    if (authorization.status !== "authorized") return authorization;
    try {
      const data = await operation({
        principalId: verification.principalId,
        workspaceId: authorization.project.workspaceId,
        projectId: authorization.project.id,
      });
      return data === undefined ? { status: "ok" } : { status: "ok", data };
    } catch {
      return { status: "retryable" };
    }
  }

  return {
    createFeedback: (request) =>
      execute(request, "feedback.write", (scope) =>
        ports.feedback.create(scope, request.command),
      ),
    readFeedback: (request) =>
      execute(request, "feedback.read", (scope) =>
        ports.feedback.read(scope, request.feedbackId),
      ),
    updateFeedback: (request) =>
      execute(request, "feedback.write", (scope) =>
        ports.feedback.update(scope, request.feedbackId, request.command),
      ),
    deleteFeedback: (request) =>
      execute(request, "feedback.write", (scope) =>
        ports.feedback.delete(scope, request.feedbackId),
      ),
    searchFeedback: (request) =>
      execute(request, "feedback.search", (scope) =>
        ports.feedback.search(scope, request.query),
      ),
    aggregateFeedback: (request) =>
      execute(request, "feedback.aggregate", (scope) =>
        ports.feedback.aggregate(scope),
      ),
    listNotifications: (request) =>
      execute(request, "notification.read", (scope) => ports.notifications.list(scope)),
    authorizeRealtime: (request) =>
      execute(request, "realtime.subscribe", (scope) =>
        ports.realtime.authorize(scope),
      ),
  };
}
