import { validateProjectAdministrationCommand } from "@y7-feedback/domain";

import {
  AppwriteProjectAdministrationError,
  type AppwriteProjectAdministrationStore,
} from "./appwrite-project-administration-store.js";
import type { WorkspaceOwnerScopeResolver } from "./appwrite-workspace-owner-scope.js";
import type { AppwritePrincipalVerifier } from "./workspace-attachment-download.js";

export type ProjectAdministrationOutcome =
  | {
      readonly status: "ok";
      readonly result: {
        readonly projectId: string;
        readonly slug?: string;
        readonly action?: string;
        readonly active?: boolean;
        readonly maintainerId?: string;
      };
    }
  | {
      readonly status:
        "invalid" | "denied" | "conflict" | "slug_reserved" | "retryable";
    };

export interface ProjectAdministration {
  execute(input: {
    readonly jwt: string;
    readonly command: unknown;
  }): Promise<ProjectAdministrationOutcome>;
}

export interface ProjectAdministrationDependencies {
  readonly createAuditId: () => string;
  readonly digest: (value: unknown) => string;
  readonly now: () => string;
}

export function createProjectAdministration(
  principal: AppwritePrincipalVerifier,
  ownerScope: WorkspaceOwnerScopeResolver,
  store: AppwriteProjectAdministrationStore,
  dependencies: ProjectAdministrationDependencies,
): ProjectAdministration {
  return {
    async execute(input) {
      let command;
      try {
        command = validateProjectAdministrationCommand(input.command);
      } catch {
        return { status: "invalid" };
      }
      const verification = await principal.verify(input.jwt);
      if (verification.status !== "verified") return verification;
      const authorization = await ownerScope.resolve({
        principalId: verification.principalId,
        workspaceId: command.workspaceId,
      });
      if (authorization.status !== "authorized") return authorization;

      try {
        const common = {
          actorId: authorization.principalId,
          auditId: dependencies.createAuditId(),
          occurredAt: dependencies.now(),
          payloadDigest: dependencies.digest(command),
        };
        const result =
          command.kind === "create_project"
            ? await store.create({ command, ...common })
            : await store.mutate({ command, ...common });
        const publicResult = Object.fromEntries(
          Object.entries(result).filter(([key]) => key !== "status"),
        ) as Extract<ProjectAdministrationOutcome, { status: "ok" }>["result"];
        return {
          status: "ok",
          result: publicResult,
        };
      } catch (error: unknown) {
        if (error instanceof AppwriteProjectAdministrationError) {
          if (error.code === "ERR-ADMIN-IDEMPOTENCY-CONFLICT") {
            return { status: "conflict" };
          }
          if (error.code === "ERR-ADMIN-SLUG-RESERVED") {
            return { status: "slug_reserved" };
          }
          if (error.code === "ERR-ADMIN-DENIED") return { status: "denied" };
          if (error.code === "ERR-ADMIN-MUTATION-INVALID") {
            return { status: "invalid" };
          }
        }
        return { status: "retryable" };
      }
    },
  };
}
