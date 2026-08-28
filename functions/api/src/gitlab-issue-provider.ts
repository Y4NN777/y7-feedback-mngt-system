import type { ProviderGrantVault } from "./source-provider.js";
import {
  ProviderIssueError,
  classifyProviderStatus,
  issueDocument,
  type ProviderIssueAdapter,
  type ProviderIssueResult,
} from "./provider-issue.js";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function origin(value: string): URL {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error();
    }
    return new URL(parsed.toString().replace(/\/?$/u, "/"));
  } catch {
    throw new Error("SOURCE_PROVIDER_CONFIG_INVALID");
  }
}

function result(value: unknown, replayed: boolean): ProviderIssueResult {
  if (
    !object(value) ||
    (typeof value.id !== "number" && typeof value.id !== "string") ||
    typeof value.web_url !== "string"
  ) {
    throw new ProviderIssueError("retryable");
  }
  try {
    const url = new URL(value.web_url);
    if (url.protocol !== "https:") throw new Error();
    return { issueId: String(value.id), issueUrl: url.toString(), replayed };
  } catch {
    throw new ProviderIssueError("retryable");
  }
}

function existing(value: unknown, marker: string): ProviderIssueResult | undefined {
  if (!Array.isArray(value)) throw new ProviderIssueError("retryable");
  const matches = value.filter(
    (item) =>
      object(item) &&
      typeof item.description === "string" &&
      item.description.includes(marker),
  );
  if (matches.length > 1) throw new ProviderIssueError("permanent");
  return matches[0] === undefined ? undefined : result(matches[0], true);
}

export function createGitLabIssueProvider(
  providerOrigin: string,
  vault: ProviderGrantVault,
  fetcher: Fetcher = globalThis.fetch,
): ProviderIssueAdapter {
  const base = origin(providerOrigin);
  return {
    provider: "gitlab",
    async createIssue(input) {
      try {
        const material = await vault.open("gitlab", input.encryptedGrantRef);
        const document = issueDocument(input);
        const headers = {
          accept: "application/json",
          authorization: `Bearer ${material.accessToken}`,
        };
        const issuePath = `api/v4/projects/${encodeURIComponent(input.repository.id)}/issues`;
        const search = new URL(issuePath, base);
        search.search = new URLSearchParams({
          scope: "all",
          state: "all",
          search: document.marker,
          in: "description",
          per_page: "2",
        }).toString();
        const searched = await fetcher(search.toString(), {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          headers,
        });
        if (searched.status !== 200) {
          throw new ProviderIssueError(classifyProviderStatus(searched.status));
        }
        const replay = existing((await searched.json()) as unknown, document.marker);
        if (replay) return replay;
        const created = await fetcher(new URL(issuePath, base).toString(), {
          method: "POST",
          cache: "no-store",
          credentials: "omit",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ title: document.title, description: document.body }),
        });
        if (created.status !== 201) {
          throw new ProviderIssueError(classifyProviderStatus(created.status));
        }
        return result((await created.json()) as unknown, false);
      } catch (error) {
        if (error instanceof ProviderIssueError) throw error;
        throw new ProviderIssueError("retryable");
      }
    },
  };
}
