import type { WorkbenchFilter } from "@y7-feedback/domain";

import {
  AppwriteWorkbenchError,
  type WorkbenchDetail,
  type WorkbenchStore,
} from "./appwrite-workbench-store.js";
import type {
  WorkbenchCommand,
  WorkbenchMutationResult,
  WorkbenchMutationStore,
} from "./appwrite-workbench-mutation-store.js";
import type { WorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope.js";
import type { AppwritePrincipalVerifier } from "./workspace-attachment-download.js";

export type WorkbenchOutcome =
  | {
      readonly status: "ok";
      readonly result: readonly unknown[] | WorkbenchDetail | WorkbenchMutationResult;
    }
  | { readonly status: "denied" | "invalid" | "conflict" | "retryable" };

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
  execute(input: {
    readonly jwt: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
    readonly command: unknown;
  }): Promise<WorkbenchOutcome>;
}

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCommand(value: unknown): WorkbenchCommand | undefined {
  if (!object(value) || typeof value.operationId !== "string") return undefined;
  if (value.kind === "classify_feedback" && typeof value.classification === "string") {
    return {
      kind: value.kind,
      operationId: value.operationId,
      classification: value.classification,
    };
  }
  if (value.kind === "assign_feedback" && typeof value.maintainerId === "string") {
    return {
      kind: value.kind,
      operationId: value.operationId,
      maintainerId: value.maintainerId,
    };
  }
  return value.kind === "unassign_feedback" || value.kind === "delete_feedback"
    ? { kind: value.kind, operationId: value.operationId }
    : undefined;
}

export function createWorkbenchCoordinator(
  principal: AppwritePrincipalVerifier,
  scope: WorkspaceCapabilityScopeResolver,
  store: WorkbenchStore,
  mutations: WorkbenchMutationStore,
  dependencies: {
    readonly digest: (value: unknown) => string;
    readonly now: () => string;
    readonly notifyAssignmentCommitted?: (input: {
      readonly feedbackId: string;
      readonly actorId: string;
      readonly eventId: string;
      readonly occurredAt: string;
    }) => Promise<void>;
  },
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
    if (error instanceof AppwriteWorkbenchError) {
      if (error.code === "ERR-WORK-DENIED") return { status: "denied" };
      if (error.code === "ERR-WORK-CONFLICT") return { status: "conflict" };
    }
    return { status: "retryable" };
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
    async execute(input) {
      const command = parseCommand(input.command);
      if (command === undefined) return { status: "invalid" };
      const authorization = await authorize(input);
      if (authorization.status !== "authorized") return authorization;
      try {
        const occurredAt = dependencies.now();
        const result = await mutations.execute({
          actor: authorization.actor,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          feedbackId: input.feedbackId,
          command,
          payloadDigest: dependencies.digest(command),
          occurredAt,
        });
        if (
          command.kind === "assign_feedback" ||
          command.kind === "unassign_feedback"
        ) {
          try {
            await dependencies.notifyAssignmentCommitted?.({
              feedbackId: input.feedbackId,
              actorId: authorization.actor.principalId,
              eventId: command.operationId,
              occurredAt,
            });
          } catch {
            // The assignment fact committed; reconciliation retries independently.
          }
        }
        return {
          status: "ok",
          result,
        };
      } catch (error: unknown) {
        return failure(error);
      }
    },
  };
}
