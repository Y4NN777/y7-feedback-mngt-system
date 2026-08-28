import type { WorkbenchFilter } from "@y7-feedback/domain";

import {
  AppwriteWorkbenchError,
  type WorkbenchDetail,
  type WorkbenchStore,
} from "./appwrite-workbench-store.js";
import type { WorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope.js";
import type { AppwritePrincipalVerifier } from "./workspace-attachment-download.js";

export type WorkbenchOutcome =
  | {
      readonly status: "ok";
      readonly result: readonly unknown[] | WorkbenchDetail;
    }
  | { readonly status: "denied" | "retryable" };

export interface WorkbenchCoordinator {
  list(input: {
    readonly jwt: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly filter: WorkbenchFilter;
  }): Promise<WorkbenchOutcome>;
  read(input: {
    readonly jwt: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
  }): Promise<WorkbenchOutcome>;
}

export function createWorkbenchCoordinator(
  principal: AppwritePrincipalVerifier,
  scope: WorkspaceCapabilityScopeResolver,
  store: WorkbenchStore,
): WorkbenchCoordinator {
  async function authorize(input: {
    readonly jwt: string;
    readonly workspaceId: string;
    readonly projectId: string;
  }) {
    const verification = await principal.verify(input.jwt);
    if (verification.status !== "verified") return verification;
    return scope.resolve({
      principalId: verification.principalId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      capability: "feedback.read",
    });
  }

  function failure(error: unknown): WorkbenchOutcome {
    return error instanceof AppwriteWorkbenchError && error.code === "ERR-WORK-DENIED"
      ? { status: "denied" }
      : { status: "retryable" };
  }

  return {
    async list(input) {
      const authorization = await authorize(input);
      if (authorization.status !== "authorized") return authorization;
      try {
        return {
          status: "ok",
          result: await store.list({
            actor: authorization.actor,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            filter: input.filter,
          }),
        };
      } catch (error: unknown) {
        return failure(error);
      }
    },
    async read(input) {
      const authorization = await authorize(input);
      if (authorization.status !== "authorized") return authorization;
      try {
        return {
          status: "ok",
          result: await store.read({
            actor: authorization.actor,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            feedbackId: input.feedbackId,
          }),
        };
      } catch (error: unknown) {
        return failure(error);
      }
    },
  };
}
