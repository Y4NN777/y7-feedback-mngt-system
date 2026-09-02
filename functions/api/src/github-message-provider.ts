/* v8 ignore file */
// Provider HTTP adaptation is covered by the shared contract and deployed Preview verification.
import type { ProviderGrantVault } from "./source-provider.js";
import {
  ProviderMessageError,
  messageDocument,
  providerMessageFailure,
  providerMessageInstant,
  type ProviderMessageAdapter,
} from "./provider-message.js";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commentId(value: unknown): string {
  if (!object(value) || (typeof value.id !== "number" && typeof value.id !== "string"))
    throw new ProviderMessageError("retryable");
  return String(value.id);
}

/* v8 ignore start -- Provider HTTP adaptation is covered by the shared contract and deployed Preview verification. */
export function createGitHubMessageProvider(
  vault: ProviderGrantVault,
  fetcher: Fetcher = globalThis.fetch,
): ProviderMessageAdapter {
  return {
    provider: "github",
    async inspect(input) {
      try {
        const material = await vault.open("github", input.encryptedGrantRef);
        const response = await fetcher(
          `https://api.github.com/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.name)}/issues/comments/${encodeURIComponent(input.commentId)}`,
          {
            method: "GET",
            cache: "no-store",
            credentials: "omit",
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${material.accessToken}`,
              "x-github-api-version": "2022-11-28",
            },
          },
        );
        if (response.status === 404) return { status: "missing" };
        if (response.status !== 200)
          throw new ProviderMessageError(providerMessageFailure(response.status));
        const value: unknown = await response.json();
        if (
          !object(value) ||
          typeof value.body !== "string" ||
          !object(value.user) ||
          (typeof value.user.id !== "string" && typeof value.user.id !== "number") ||
          typeof value.user.login !== "string"
        )
          throw new ProviderMessageError("retryable");
        return {
          status: "found",
          content: value.body,
          authorId: String(value.user.id),
          authorLogin: value.user.login,
          updatedAt: providerMessageInstant(value.updated_at ?? value.created_at),
        };
      } catch (error) {
        if (error instanceof ProviderMessageError) throw error;
        throw new ProviderMessageError("retryable");
      }
    },
    async publish(input) {
      try {
        const material = await vault.open("github", input.encryptedGrantRef);
        const document = messageDocument(input);
        const base = `https://api.github.com/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.name)}`;
        const headers = {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${material.accessToken}`,
          "x-github-api-version": "2022-11-28",
        };
        const listed = await fetcher(
          `${base}/issues/${encodeURIComponent(input.issueId)}/comments?per_page=100`,
          { method: "GET", cache: "no-store", credentials: "omit", headers },
        );
        if (listed.status !== 200)
          throw new ProviderMessageError(providerMessageFailure(listed.status));
        const body: unknown = await listed.json();
        if (!Array.isArray(body)) throw new ProviderMessageError("retryable");
        const matches = body.filter(
          (entry) =>
            object(entry) &&
            typeof entry.body === "string" &&
            entry.body.includes(document.marker),
        );
        if (matches.length > 1) throw new ProviderMessageError("permanent");
        if (matches[0] !== undefined)
          return { commentId: commentId(matches[0]), replayed: true };
        const created = await fetcher(
          `${base}/issues/${encodeURIComponent(input.issueId)}/comments`,
          {
            method: "POST",
            cache: "no-store",
            credentials: "omit",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ body: document.body }),
          },
        );
        if (created.status !== 201)
          throw new ProviderMessageError(providerMessageFailure(created.status));
        return {
          commentId: commentId((await created.json()) as unknown),
          replayed: false,
        };
      } catch (error) {
        if (error instanceof ProviderMessageError) throw error;
        throw new ProviderMessageError("retryable");
      }
    },
    async remove(input) {
      try {
        const material = await vault.open("github", input.encryptedGrantRef);
        messageDocument({ ...input, content: "removal" });
        const response = await fetcher(
          `https://api.github.com/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.name)}/issues/comments/${encodeURIComponent(input.commentId)}`,
          {
            method: "DELETE",
            cache: "no-store",
            credentials: "omit",
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${material.accessToken}`,
              "x-github-api-version": "2022-11-28",
            },
          },
        );
        if (response.status === 204) return { missing: false };
        if (response.status === 404) return { missing: true };
        throw new ProviderMessageError(providerMessageFailure(response.status));
      } catch (error) {
        if (error instanceof ProviderMessageError) throw error;
        throw new ProviderMessageError("retryable");
      }
    },
  };
}
/* v8 ignore stop */
