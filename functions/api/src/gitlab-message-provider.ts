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

function origin(value: string): URL {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("PROVIDER_MESSAGE_CONFIG_INVALID");
  return new URL(parsed.toString().replace(/\/?$/u, "/"));
}

function commentId(value: unknown): string {
  if (!object(value) || (typeof value.id !== "number" && typeof value.id !== "string"))
    throw new ProviderMessageError("retryable");
  return String(value.id);
}

/* v8 ignore start -- Provider HTTP adaptation is covered by the shared contract and deployed Preview verification. */
export function createGitLabMessageProvider(
  providerOrigin: string,
  vault: ProviderGrantVault,
  fetcher: Fetcher = globalThis.fetch,
): ProviderMessageAdapter {
  const base = origin(providerOrigin);
  return {
    provider: "gitlab",
    async inspect(input) {
      try {
        const material = await vault.open("gitlab", input.encryptedGrantRef);
        const response = await fetcher(
          new URL(
            `api/v4/projects/${encodeURIComponent(input.repository.id)}/issues/${encodeURIComponent(input.issueId)}/notes/${encodeURIComponent(input.commentId)}`,
            base,
          ).toString(),
          {
            method: "GET",
            cache: "no-store",
            credentials: "omit",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${material.accessToken}`,
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
          !object(value.author) ||
          (typeof value.author.id !== "string" &&
            typeof value.author.id !== "number") ||
          typeof value.author.username !== "string"
        )
          throw new ProviderMessageError("retryable");
        return {
          status: "found",
          content: value.body,
          authorId: String(value.author.id),
          authorLogin: value.author.username,
          updatedAt: providerMessageInstant(value.updated_at ?? value.created_at),
        };
      } catch (error) {
        if (error instanceof ProviderMessageError) throw error;
        throw new ProviderMessageError("retryable");
      }
    },
    async publish(input) {
      try {
        const material = await vault.open("gitlab", input.encryptedGrantRef);
        const document = messageDocument(input);
        const path = `api/v4/projects/${encodeURIComponent(input.repository.id)}/issues/${encodeURIComponent(input.issueId)}/notes`;
        const headers = {
          accept: "application/json",
          authorization: `Bearer ${material.accessToken}`,
        };
        const listedUrl = new URL(path, base);
        listedUrl.search = new URLSearchParams({ per_page: "100" }).toString();
        const listed = await fetcher(listedUrl.toString(), {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          headers,
        });
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
        const created = await fetcher(new URL(path, base).toString(), {
          method: "POST",
          cache: "no-store",
          credentials: "omit",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ body: document.body }),
        });
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
        const material = await vault.open("gitlab", input.encryptedGrantRef);
        messageDocument({ ...input, content: "removal" });
        const response = await fetcher(
          new URL(
            `api/v4/projects/${encodeURIComponent(input.repository.id)}/issues/${encodeURIComponent(input.issueId)}/notes/${encodeURIComponent(input.commentId)}`,
            base,
          ).toString(),
          {
            method: "DELETE",
            cache: "no-store",
            credentials: "omit",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${material.accessToken}`,
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
