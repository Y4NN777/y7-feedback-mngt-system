export interface ExternalIssueRepositoryOption {
  readonly connectionId: string;
  readonly provider: "github" | "gitlab";
  readonly repositoryId: string;
  readonly owner: string;
  readonly name: string;
  readonly visibility: "public" | "private" | "internal";
}

export type ExternalIssueGatewayOutcome<T> =
  | { readonly status: "ok"; readonly result: T }
  | { readonly status: "denied" | "conflict" | "retryable" };

export interface ExternalIssueGateway {
  repositories(input: {
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<ExternalIssueGatewayOutcome<readonly ExternalIssueRepositoryOption[]>>;
  link(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
    readonly operationId: string;
    readonly connectionId: string;
    readonly repositoryId: string;
    readonly consentVersion?: number;
  }): Promise<
    ExternalIssueGatewayOutcome<{
      readonly status: "accepted" | "replayed";
      readonly linkId: string;
      readonly synchronizationState: "pending" | "failed" | "synchronized";
    }>
  >;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function status(code: number): "denied" | "conflict" | "retryable" {
  return code === 404 ? "denied" : code === 409 ? "conflict" : "retryable";
}

function repositoryOptions(value: unknown): readonly ExternalIssueRepositoryOption[] {
  if (!object(value) || value.status !== "ok" || !Array.isArray(value.connections)) {
    throw new Error("EXTERNAL_ISSUE_RESPONSE_INVALID");
  }
  const result: ExternalIssueRepositoryOption[] = [];
  for (const connection of value.connections) {
    if (
      !object(connection) ||
      typeof connection.id !== "string" ||
      (connection.provider !== "github" && connection.provider !== "gitlab") ||
      (connection.state !== "active" &&
        connection.state !== "suspended" &&
        connection.state !== "disconnected") ||
      !Array.isArray(connection.selectedRepositories) ||
      !Array.isArray(connection.importedRepositories)
    ) {
      throw new Error("EXTERNAL_ISSUE_RESPONSE_INVALID");
    }
    if (connection.state !== "active") continue;
    const selectedRepositories: readonly unknown[] = connection.selectedRepositories;
    const importedRepositories: readonly unknown[] = connection.importedRepositories;
    for (const selected of selectedRepositories) {
      if (
        !object(selected) ||
        selected.provider !== connection.provider ||
        typeof selected.id !== "string" ||
        selected.id === ""
      ) {
        throw new Error("EXTERNAL_ISSUE_RESPONSE_INVALID");
      }
      const imported: unknown = importedRepositories.find(
        (candidate) =>
          object(candidate) &&
          candidate.provider === connection.provider &&
          candidate.repositoryId === selected.id,
      );
      if (
        !object(imported) ||
        typeof imported.owner !== "string" ||
        typeof imported.name !== "string" ||
        (imported.visibility !== "public" &&
          imported.visibility !== "private" &&
          imported.visibility !== "internal")
      ) {
        throw new Error("EXTERNAL_ISSUE_RESPONSE_INVALID");
      }
      result.push({
        connectionId: connection.id,
        provider: connection.provider,
        repositoryId: selected.id,
        owner: imported.owner,
        name: imported.name,
        visibility: imported.visibility,
      });
    }
  }
  return result;
}

function linkResult(value: unknown) {
  if (
    !object(value) ||
    (value.status !== "accepted" && value.status !== "replayed") ||
    !object(value.result) ||
    value.result.status !== value.status ||
    typeof value.result.linkId !== "string" ||
    (value.result.synchronizationState !== "pending" &&
      value.result.synchronizationState !== "failed" &&
      value.result.synchronizationState !== "synchronized")
  ) {
    throw new Error("EXTERNAL_ISSUE_RESPONSE_INVALID");
  }
  return {
    status: value.status,
    linkId: value.result.linkId,
    synchronizationState: value.result.synchronizationState,
  } as const;
}

export function createHttpExternalIssueGateway(
  apiOrigin: string,
  createJwt: () => Promise<string>,
  fetcher: Fetcher = globalThis.fetch,
): ExternalIssueGateway {
  async function post(path: string, body: unknown) {
    try {
      const jwt = await createJwt();
      const response = await fetcher(new URL(path, apiOrigin).toString(), {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status !== 200 && response.status !== 201) {
        return { status: status(response.status) } as const;
      }
      return { status: "ok" as const, body: (await response.json()) as unknown };
    } catch {
      return { status: "retryable" as const };
    }
  }
  return {
    async repositories(input) {
      const response = await post(
        `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/source-connections/manage/list`,
        {},
      );
      if (response.status !== "ok") return response;
      try {
        return { status: "ok", result: repositoryOptions(response.body) };
      } catch {
        return { status: "retryable" };
      }
    },
    async link(input) {
      const response = await post(
        `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/feedback/${encodeURIComponent(input.feedbackId)}/external-issue-link`,
        {
          operationId: input.operationId,
          connectionId: input.connectionId,
          repositoryId: input.repositoryId,
          ...(input.consentVersion === undefined
            ? {}
            : { consentVersion: input.consentVersion }),
        },
      );
      if (response.status !== "ok") return response;
      try {
        return { status: "ok", result: linkResult(response.body) };
      } catch {
        return { status: "retryable" };
      }
    },
  };
}
