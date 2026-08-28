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
      readonly result: { readonly projectId: string; readonly slug: string };
    }
  | {
      readonly status:
        "invalid" | "denied" | "conflict" | "slug_reserved" | "retryable";
    };

export interface ProjectAdministration {
  create(input: {
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
    async create(input) {
      let command;
      try {
        command = validateProjectAdministrationCommand(input.command);
      } catch {
        return { status: "invalid" };
      }
      if (command.kind !== "create_project") return { status: "invalid" };

      const verification = await principal.verify(input.jwt);
      if (verification.status !== "verified") return verification;
      const authorization = await ownerScope.resolve({
        principalId: verification.principalId,
        workspaceId: command.workspaceId,
      });
      if (authorization.status !== "authorized") return authorization;

      try {
        const result = await store.create({
          command,
          actorId: authorization.principalId,
          auditId: dependencies.createAuditId(),
          occurredAt: dependencies.now(),
          payloadDigest: dependencies.digest(command),
        });
        return {
          status: "ok",
          result: { projectId: result.projectId, slug: result.slug },
        };
      } catch (error: unknown) {
        if (error instanceof AppwriteProjectAdministrationError) {
          if (error.code === "ERR-ADMIN-IDEMPOTENCY-CONFLICT") {
            return { status: "conflict" };
          }
          if (error.code === "ERR-ADMIN-SLUG-RESERVED") {
            return { status: "slug_reserved" };
          }
        }
        return { status: "retryable" };
      }
    },
  };
}
