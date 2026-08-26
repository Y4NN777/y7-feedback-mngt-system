import type {
  ActorAccess,
  Project,
  RepositoryIdentity,
  SourceProvider,
} from "@y7-feedback/domain";

import type { SourceProviderAdapter } from "./source-provider.js";

export interface SourcePrincipalVerifier {
  verify(
    jwt: string,
  ): Promise<
    | { readonly status: "verified"; readonly principalId: string }
    | { readonly status: "denied" | "retryable" }
  >;
}

export interface SourceScopeResolver {
  resolve(input: {
    readonly principalId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly capability: "project.manage";
  }): Promise<
    | {
        readonly status: "authorized";
        readonly actor: ActorAccess;
        readonly project: Project;
      }
    | { readonly status: "denied" | "retryable" }
  >;
}

export interface PendingSourceConnection {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly provider: SourceProvider;
  readonly ownerUserId: string;
  readonly nonceDigest: string;
  readonly expiresAt: number;
  readonly returnPath: string;
  readonly createdAt: string;
}

export interface AuthorizedSourceConnection extends PendingSourceConnection {
  readonly encryptedGrantRef: string;
  readonly authorizedRepositories: readonly RepositoryIdentity[];
}

export interface ActiveSourceGrant {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly provider: SourceProvider;
  readonly encryptedGrantRef: string;
}

export interface SourceConnectionStore {
  begin(connection: PendingSourceConnection): Promise<void>;
  claim(input: {
    readonly stateId: string;
    readonly provider: SourceProvider;
    readonly nonceDigest: string;
    readonly now: number;
  }): Promise<PendingSourceConnection | null>;
  authorize(connection: AuthorizedSourceConnection): Promise<void>;
  select(input: {
    readonly connectionId: string;
    readonly ownerUserId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly repositoryIds: readonly string[];
    readonly updatedAt: string;
  }): Promise<{
    readonly id: string;
    readonly provider: SourceProvider;
    readonly selectedRepositories: readonly RepositoryIdentity[];
  } | null>;
  active(input: {
    readonly connectionId: string;
    readonly ownerUserId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<ActiveSourceGrant | null>;
  disconnected(connectionId: string): Promise<void>;
}

export interface SourceConnectionCoordinatorDependencies {
  readonly principalVerifier: SourcePrincipalVerifier;
  readonly scopeResolver: SourceScopeResolver;
  readonly store: SourceConnectionStore;
  readonly providers: readonly SourceProviderAdapter[];
  readonly createStateId: () => string;
  readonly createNonce: () => string;
  readonly digestNonce: (nonce: string) => string;
  readonly now: () => number;
  readonly nowIso: () => string;
  readonly ttlMs: number;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const nonce = /^[A-Za-z0-9_-]{6,200}$/u;

function safeReturnPath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    value.length <= 500
  );
}

function uniqueRepositoryIds(values: readonly string[]): boolean {
  return (
    values.length > 0 &&
    values.length <= 100 &&
    values.every((value) => identifier.test(value)) &&
    new Set(values).size === values.length
  );
}

export function createSourceConnectionCoordinator(
  dependencies: SourceConnectionCoordinatorDependencies,
) {
  const providers = new Map(
    dependencies.providers.map((provider) => [provider.provider, provider] as const),
  );
  if (
    providers.size !== dependencies.providers.length ||
    !providers.has("github") ||
    !providers.has("gitlab") ||
    dependencies.ttlMs <= 0 ||
    dependencies.ttlMs > 15 * 60 * 1_000
  ) {
    throw new Error("SOURCE_CONNECTION_CONFIG_INVALID");
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
    return {
      status: "authorized" as const,
      principalId: principal.principalId,
    };
  }

  return {
    async begin(input: {
      readonly jwt: string;
      readonly workspaceId: string;
      readonly projectId: string;
      readonly provider: SourceProvider;
      readonly returnPath: string;
      readonly redirectUri: string;
    }) {
      try {
        const scoped = await scope(input);
        if (scoped.status !== "authorized") return { status: scoped.status } as const;
        if (!safeReturnPath(input.returnPath)) return { status: "denied" } as const;
        const provider = providers.get(input.provider);
        if (!provider) return { status: "denied" } as const;
        const stateId = dependencies.createStateId();
        const rawNonce = dependencies.createNonce();
        if (!identifier.test(stateId) || !nonce.test(rawNonce)) {
          return { status: "retryable" } as const;
        }
        await dependencies.store.begin({
          id: stateId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          provider: input.provider,
          ownerUserId: scoped.principalId,
          nonceDigest: dependencies.digestNonce(rawNonce),
          expiresAt: dependencies.now() + dependencies.ttlMs,
          returnPath: input.returnPath,
          createdAt: dependencies.nowIso(),
        });
        return {
          status: "ok",
          authorizationUrl: provider.authorizationUrl({
            state: `${stateId}.${rawNonce}`,
            redirectUri: input.redirectUri,
          }),
        } as const;
      } catch {
        return { status: "retryable" } as const;
      }
    },

    async complete(input: {
      readonly provider: SourceProvider;
      readonly state: string;
      readonly code: string;
      readonly redirectUri: string;
    }) {
      try {
        const parts = input.state.split(".");
        const stateId = parts[0];
        const rawNonce = parts[1];
        if (
          parts.length !== 2 ||
          !stateId ||
          !rawNonce ||
          !identifier.test(stateId) ||
          !nonce.test(rawNonce) ||
          !input.code ||
          input.code.length > 2_000
        ) {
          return { status: "denied" } as const;
        }
        const provider = providers.get(input.provider);
        if (!provider) return { status: "denied" } as const;
        const pending = await dependencies.store.claim({
          stateId,
          provider: input.provider,
          nonceDigest: dependencies.digestNonce(rawNonce),
          now: dependencies.now(),
        });
        if (!pending) return { status: "denied" } as const;
        const grant = await provider.completeAuthorization({
          code: input.code,
          redirectUri: input.redirectUri,
        });
        await dependencies.store.authorize({
          ...pending,
          encryptedGrantRef: grant.encryptedGrantRef,
          authorizedRepositories: grant.authorizedRepositories,
        });
        return {
          status: "pending_selection",
          connectionId: pending.id,
          authorizedRepositories: grant.authorizedRepositories,
          returnPath: pending.returnPath,
        } as const;
      } catch {
        return { status: "retryable" } as const;
      }
    },

    async select(input: {
      readonly jwt: string;
      readonly workspaceId: string;
      readonly projectId: string;
      readonly connectionId: string;
      readonly repositoryIds: readonly string[];
    }) {
      try {
        const scoped = await scope(input);
        if (scoped.status !== "authorized") return { status: scoped.status } as const;
        if (
          !identifier.test(input.connectionId) ||
          !uniqueRepositoryIds(input.repositoryIds)
        ) {
          return { status: "denied" } as const;
        }
        const connection = await dependencies.store.select({
          connectionId: input.connectionId,
          ownerUserId: scoped.principalId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          repositoryIds: input.repositoryIds,
          updatedAt: dependencies.nowIso(),
        });
        return connection
          ? ({ status: "active", connection } as const)
          : ({ status: "denied" } as const);
      } catch {
        return { status: "retryable" } as const;
      }
    },

    async disconnect(input: {
      readonly jwt: string;
      readonly workspaceId: string;
      readonly projectId: string;
      readonly connectionId: string;
    }) {
      try {
        const scoped = await scope(input);
        if (scoped.status !== "authorized") return { status: scoped.status } as const;
        if (!identifier.test(input.connectionId)) return { status: "denied" } as const;
        const active = await dependencies.store.active({
          connectionId: input.connectionId,
          ownerUserId: scoped.principalId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
        });
        if (!active) return { status: "denied" } as const;
        const provider = providers.get(active.provider);
        if (!provider) return { status: "retryable" } as const;
        await provider.revokeGrant(active.encryptedGrantRef);
        await dependencies.store.disconnected(active.id);
        return { status: "disconnected" } as const;
      } catch {
        return { status: "retryable" } as const;
      }
    },
  };
}

export type SourceConnectionCoordinator = ReturnType<
  typeof createSourceConnectionCoordinator
>;
