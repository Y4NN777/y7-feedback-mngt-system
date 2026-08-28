import {
  importRepositoryMetadata,
  type ImportedRepositoryMetadata,
  type RepositoryIdentity,
  type SourceConnectionState,
  type SourceProvider,
} from "@y7-feedback/domain";

import type {
  SourcePrincipalVerifier,
  SourceScopeResolver,
} from "./source-connection-coordinator.js";
import type { SourceProviderAdapter } from "./source-provider.js";

export interface SourceManagementConnection {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly provider: SourceProvider;
  readonly state: SourceConnectionState;
  readonly selectedRepositories: readonly RepositoryIdentity[];
  readonly importedRepositories: readonly ImportedRepositoryMetadata[];
  readonly updatedAt: string;
}

export interface ActiveSourceManagementConnection extends SourceManagementConnection {
  readonly ownerUserId: string;
  readonly encryptedGrantRef: string;
}

export interface PendingSourceSelection {
  readonly id: string;
  readonly provider: SourceProvider;
  readonly authorizedRepositories: readonly RepositoryIdentity[];
  readonly updatedAt: string;
}

export interface SourceManagementStore {
  list(input: {
    readonly ownerUserId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<readonly SourceManagementConnection[]>;
  pending(input: {
    readonly ownerUserId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<readonly PendingSourceSelection[]>;
  active(input: {
    readonly connectionId: string;
    readonly ownerUserId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<ActiveSourceManagementConnection | null>;
  saveImport(input: {
    readonly connectionId: string;
    readonly ownerUserId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly repository: ImportedRepositoryMetadata;
    readonly updatedAt: string;
  }): Promise<SourceManagementConnection>;
}

export interface SourceProjectSlugPort {
  current(input: {
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<string>;
}

export interface SourceManagementDependencies {
  readonly principalVerifier: SourcePrincipalVerifier;
  readonly scopeResolver: SourceScopeResolver;
  readonly store: SourceManagementStore;
  readonly providers: readonly SourceProviderAdapter[];
  readonly projectSlug: SourceProjectSlugPort;
  readonly nowIso: () => string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const slug = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function createSourceManagementCoordinator(
  dependencies: SourceManagementDependencies,
) {
  const providers = new Map(
    dependencies.providers.map((provider) => [provider.provider, provider] as const),
  );
  if (
    providers.size !== dependencies.providers.length ||
    !providers.has("github") ||
    !providers.has("gitlab")
  ) {
    throw new Error("SOURCE_MANAGEMENT_CONFIG_INVALID");
  }

  async function scope(input: {
    readonly jwt: string;
    readonly workspaceId: string;
    readonly projectId: string;
  }) {
    if (
      input.jwt.length > 4_096 ||
      !identifier.test(input.workspaceId) ||
      !identifier.test(input.projectId)
    ) {
      return { status: "denied" as const };
    }
    const principal = await dependencies.principalVerifier.verify(input.jwt);
    if (principal.status !== "verified") return principal;
    const resolved = await dependencies.scopeResolver.resolve({
      principalId: principal.principalId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      capability: "project.manage",
    });
    if (
      resolved.status !== "authorized" ||
      resolved.actor.responsibility !== "workspace_owner" ||
      resolved.actor.principalId !== principal.principalId
    ) {
      return resolved.status === "retryable"
        ? { status: "retryable" as const }
        : { status: "denied" as const };
    }
    return { status: "authorized" as const, principalId: principal.principalId };
  }

  return {
    async list(input: {
      readonly jwt: string;
      readonly workspaceId: string;
      readonly projectId: string;
    }) {
      try {
        const scoped = await scope(input);
        if (scoped.status !== "authorized") return { status: scoped.status } as const;
        const [connections, pendingSelections, projectSlug] = await Promise.all([
          dependencies.store.list({
            ownerUserId: scoped.principalId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
          }),
          dependencies.store.pending({
            ownerUserId: scoped.principalId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
          }),
          dependencies.projectSlug.current({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
          }),
        ]);
        if (!slug.test(projectSlug)) return { status: "retryable" } as const;
        return {
          status: "ok",
          projectSlug,
          connections,
          pendingSelections,
        } as const;
      } catch {
        return { status: "retryable" } as const;
      }
    },

    async refresh(input: {
      readonly jwt: string;
      readonly workspaceId: string;
      readonly projectId: string;
      readonly connectionId: string;
      readonly repositoryId: string;
    }) {
      try {
        const scoped = await scope(input);
        if (scoped.status !== "authorized") return { status: scoped.status } as const;
        if (
          !identifier.test(input.connectionId) ||
          !identifier.test(input.repositoryId)
        ) {
          return { status: "denied" } as const;
        }
        const connection = await dependencies.store.active({
          connectionId: input.connectionId,
          ownerUserId: scoped.principalId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
        });
        if (
          !connection ||
          connection.state !== "active" ||
          !connection.selectedRepositories.some(
            (repository) => repository.id === input.repositoryId,
          )
        ) {
          return { status: "denied" } as const;
        }
        const provider = providers.get(connection.provider);
        if (!provider) return { status: "retryable" } as const;
        const observedAt = dependencies.nowIso();
        const imported = importRepositoryMetadata({
          connectionId: connection.id,
          repository: await provider.importRepository({
            encryptedGrantRef: connection.encryptedGrantRef,
            repositoryId: input.repositoryId,
          }),
          observedAt,
        });
        const updated = await dependencies.store.saveImport({
          connectionId: connection.id,
          ownerUserId: scoped.principalId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          repository: imported,
          updatedAt: observedAt,
        });
        return { status: "ok", connection: updated } as const;
      } catch {
        return { status: "retryable" } as const;
      }
    },
  };
}

export type SourceManagementCoordinator = ReturnType<
  typeof createSourceManagementCoordinator
>;
