import type { ProviderGrantVault } from "./source-provider.js";
import {
  ProviderIssueError,
  classifyProviderStatus,
  issueDocument,
  type ProviderIssueAdapter,
  type ProviderIssueResult,
} from "./provider-issue.js";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const apiOrigin = "https://api.github.com/";
const apiVersion = "2022-11-28";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function result(value: unknown, replayed: boolean): ProviderIssueResult {
  if (
    !object(value) ||
    (typeof value.number !== "number" &&
      typeof value.number !== "string" &&
      typeof value.id !== "number" &&
      typeof value.id !== "string") ||
    typeof value.html_url !== "string"
  ) {
    throw new ProviderIssueError("retryable");
  }
  try {
    const url = new URL(value.html_url);
    if (url.protocol !== "https:" || url.hostname !== "github.com") throw new Error();
    return {
      issueId: String(value.number ?? value.id),
      issueUrl: url.toString(),
      replayed,
    };
  } catch {
    throw new ProviderIssueError("retryable");
  }
}

function existing(value: unknown, marker: string): ProviderIssueResult | undefined {
  if (!object(value) || !Array.isArray(value.items)) {
    throw new ProviderIssueError("retryable");
  }
  const matches = value.items.filter(
    (item) =>
      object(item) && typeof item.body === "string" && item.body.includes(marker),
  );
  if (matches.length > 1) throw new ProviderIssueError("permanent");
  return matches[0] === undefined ? undefined : result(matches[0], true);
}

export function createGitHubIssueProvider(
  vault: ProviderGrantVault,
  fetcher: Fetcher = globalThis.fetch,
): ProviderIssueAdapter {
  return {
    provider: "github",
    async createIssue(input) {
      try {
        const material = await vault.open("github", input.encryptedGrantRef);
        const document = issueDocument(input);
        const headers = {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${material.accessToken}`,
          "content-type": "application/json",
          "x-github-api-version": apiVersion,
        };
        const search = new URL("search/issues", apiOrigin);
        search.search = new URLSearchParams({
          q: `repo:${input.repository.owner}/${input.repository.name} is:issue "${document.marker}"`,
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
        const created = await fetcher(
          new URL(
            `repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.name)}/issues`,
            apiOrigin,
          ).toString(),
          {
            method: "POST",
            cache: "no-store",
            credentials: "omit",
            headers,
            body: JSON.stringify({ title: document.title, body: document.body }),
          },
        );
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
