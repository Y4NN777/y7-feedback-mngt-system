import type {
  ImportedRepositoryMetadata,
  RepositoryIdentity,
  SourceConnectionState,
  SourceProvider,
} from "@y7-feedback/domain";
import { importRepositoryMetadata } from "@y7-feedback/domain";

export interface ManagedSourceConnection {
  readonly id: string;
  readonly provider: SourceProvider;
  readonly state: SourceConnectionState;
  readonly selectedRepositories: readonly RepositoryIdentity[];
  readonly importedRepositories: readonly ImportedRepositoryMetadata[];
  readonly updatedAt: string;
}

export interface PendingSourceSelection {
  readonly id: string;
  readonly provider: SourceProvider;
  readonly authorizedRepositories: readonly RepositoryIdentity[];
  readonly updatedAt: string;
}

export interface SourceManagementView {
  readonly projectSlug: string;
  readonly connections: readonly ManagedSourceConnection[];
  readonly pendingSelections: readonly PendingSourceSelection[];
}

export type SourceManagementOutcome<T = undefined> =
  | { readonly status: "ok"; readonly result: T }
  | { readonly status: "denied" | "retryable" };

export interface SourceManagementGateway {
  list(input: {
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<SourceManagementOutcome<SourceManagementView>>;
  begin(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly provider: SourceProvider;
  }): Promise<SourceManagementOutcome<{ readonly authorizationUrl: string }>>;
  select(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly connectionId: string;
    readonly repositoryIds: readonly string[];
  }): Promise<SourceManagementOutcome>;
  refresh(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly connectionId: string;
    readonly repositoryId: string;
  }): Promise<SourceManagementOutcome>;
  disconnect(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly connectionId: string;
  }): Promise<SourceManagementOutcome>;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function provider(value: unknown): SourceProvider | undefined {
  return value === "github" || value === "gitlab" ? value : undefined;
}

function identities(
  value: unknown,
  expectedProvider: SourceProvider,
): readonly RepositoryIdentity[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    return undefined;
  const result: RepositoryIdentity[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (
      !object(item) ||
      item.provider !== expectedProvider ||
      typeof item.id !== "string" ||
      !item.id ||
      seen.has(item.id)
    )
      return undefined;
    seen.add(item.id);
    result.push({ provider: expectedProvider, id: item.id });
  }
  return result;
}

function imported(value: unknown): readonly ImportedRepositoryMetadata[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: ImportedRepositoryMetadata[] = [];
  try {
    for (const item of value) {
      if (
        !object(item) ||
        typeof item.connectionId !== "string" ||
        typeof item.repositoryId !== "string" ||
        typeof item.name !== "string" ||
        typeof item.owner !== "string" ||
        typeof item.webUrl !== "string" ||
        typeof item.defaultBranch !== "string" ||
        typeof item.observedAt !== "string" ||
        !Array.isArray(item.releases)
      )
        return undefined;
      const sourceProvider = provider(item.provider);
      if (
        !sourceProvider ||
        (item.visibility !== "public" &&
          item.visibility !== "private" &&
          item.visibility !== "internal")
      )
        return undefined;
      result.push(
        importRepositoryMetadata({
          connectionId: item.connectionId,
          observedAt: item.observedAt,
          repository: {
            provider: sourceProvider,
            id: item.repositoryId,
            name: item.name,
            owner: item.owner,
            visibility: item.visibility,
            webUrl: item.webUrl,
            defaultBranch: item.defaultBranch,
            releases: item.releases.map((release) => {
              if (
                !object(release) ||
                typeof release.providerReleaseId !== "string" ||
                typeof release.tag !== "string" ||
                typeof release.name !== "string" ||
                typeof release.publishedAt !== "string" ||
                typeof release.webUrl !== "string"
              )
                throw new Error("SOURCE_IMPORT_INVALID");
              return {
                id: release.providerReleaseId,
                tag: release.tag,
                name: release.name,
                publishedAt: release.publishedAt,
                webUrl: release.webUrl,
              };
            }),
          },
        }),
      );
    }
    return result;
  } catch {
    return undefined;
  }
}

function view(value: unknown): SourceManagementView | undefined {
  if (
    !object(value) ||
    value.status !== "ok" ||
    typeof value.projectSlug !== "string" ||
    !Array.isArray(value.connections) ||
    !Array.isArray(value.pendingSelections)
  )
    return undefined;
  const connections = value.connections.map(
    (item): ManagedSourceConnection | undefined => {
      if (!object(item)) return undefined;
      const sourceProvider = provider(item.provider);
      const selected = sourceProvider
        ? identities(item.selectedRepositories, sourceProvider)
        : undefined;
      const imports = imported(item.importedRepositories);
      return sourceProvider &&
        selected &&
        imports &&
        (item.state === "active" ||
          item.state === "suspended" ||
          item.state === "disconnected") &&
        typeof item.id === "string" &&
        typeof item.updatedAt === "string"
        ? {
            id: item.id,
            provider: sourceProvider,
            state: item.state,
            selectedRepositories: selected,
            importedRepositories: imports,
            updatedAt: item.updatedAt,
          }
        : undefined;
    },
  );
  const pendingSelections = value.pendingSelections.map(
    (item): PendingSourceSelection | undefined => {
      if (!object(item)) return undefined;
      const sourceProvider = provider(item.provider);
      const repositories = sourceProvider
        ? identities(item.authorizedRepositories, sourceProvider)
        : undefined;
      return sourceProvider &&
        repositories &&
        typeof item.id === "string" &&
        typeof item.updatedAt === "string"
        ? {
            id: item.id,
            provider: sourceProvider,
            authorizedRepositories: repositories,
            updatedAt: item.updatedAt,
          }
        : undefined;
    },
  );
  return connections.some((item) => item === undefined) ||
    pendingSelections.some((item) => item === undefined)
    ? undefined
    : {
        projectSlug: value.projectSlug,
        connections: connections as readonly ManagedSourceConnection[],
        pendingSelections: pendingSelections as readonly PendingSourceSelection[],
      };
}

export function createHttpSourceManagementGateway(
  endpoint: string,
  createJwt: () => Promise<string>,
  fetcher: Fetcher = globalThis.fetch,
): SourceManagementGateway {
  const execute = async (
    path: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly response: Response; readonly payload: unknown }> => {
    const response = await fetcher(new URL(path, endpoint).toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${await createJwt()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { response, payload: await response.json() };
  };
  const path = (workspaceId: string, projectId: string, action: string) =>
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/source-connections/${action}`;
  const failure = (status: number) =>
    ({ status: status === 404 ? "denied" : "retryable" }) as const;
  return {
    async list(input) {
      try {
        const result = await execute(
          path(input.workspaceId, input.projectId, "manage/list"),
          {},
        );
        const parsed = result.response.ok ? view(result.payload) : undefined;
        return parsed
          ? { status: "ok", result: parsed }
          : failure(result.response.status);
      } catch {
        return { status: "retryable" };
      }
    },
    async begin(input) {
      try {
        const result = await execute(
          path(input.workspaceId, input.projectId, `${input.provider}/begin`),
          { returnPath: "/manage/sources" },
        );
        return result.response.ok &&
          object(result.payload) &&
          result.payload.status === "ok" &&
          typeof result.payload.authorizationUrl === "string"
          ? {
              status: "ok",
              result: { authorizationUrl: result.payload.authorizationUrl },
            }
          : failure(result.response.status);
      } catch {
        return { status: "retryable" };
      }
    },
    async select(input) {
      const result = await execute(
        path(input.workspaceId, input.projectId, `${input.connectionId}/select`),
        { repositoryIds: input.repositoryIds },
      ).catch(() => undefined);
      return result?.response.ok
        ? { status: "ok", result: undefined }
        : failure(result?.response.status ?? 503);
    },
    async refresh(input) {
      const result = await execute(
        path(input.workspaceId, input.projectId, `${input.connectionId}/refresh`),
        { repositoryId: input.repositoryId },
      ).catch(() => undefined);
      return result?.response.ok
        ? { status: "ok", result: undefined }
        : failure(result?.response.status ?? 503);
    },
    async disconnect(input) {
      const result = await execute(
        path(input.workspaceId, input.projectId, `${input.connectionId}/disconnect`),
        {},
      ).catch(() => undefined);
      return result?.response.ok
        ? { status: "ok", result: undefined }
        : failure(result?.response.status ?? 503);
    },
  };
}
