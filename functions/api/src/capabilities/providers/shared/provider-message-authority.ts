import type { ProviderGrantVault } from "./source-provider.js";
import type {
  ProviderMessageAuthorVerifier,
  ProviderMessageContext,
} from "./provider-message-event.js";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function retryable(status: number): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

async function github(
  context: ProviderMessageContext,
  accessToken: string,
  fetcher: Fetcher,
): Promise<"authorized" | "denied" | "retryable"> {
  const response = await fetcher(
    `https://api.github.com/repos/${encodeURIComponent(context.repositoryOwner)}/${encodeURIComponent(context.repositoryName)}/collaborators/${encodeURIComponent(context.authorLogin)}/permission`,
    {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (response.status === 404) return "denied";
  if (response.status !== 200)
    return retryable(response.status) ? "retryable" : "denied";
  const body: unknown = await response.json();
  if (!object(body)) return "retryable";
  const permission = body.permission;
  const permissions =
    object(body.user) && object(body.user.permissions)
      ? body.user.permissions
      : undefined;
  return permission === "admin" ||
    permission === "maintain" ||
    permission === "write" ||
    permissions?.admin === true ||
    permissions?.maintain === true ||
    permissions?.push === true
    ? "authorized"
    : "denied";
}

async function gitlab(
  origin: URL,
  context: ProviderMessageContext,
  accessToken: string,
  fetcher: Fetcher,
): Promise<"authorized" | "denied" | "retryable"> {
  const response = await fetcher(
    new URL(
      `api/v4/projects/${encodeURIComponent(context.repositoryId)}/members/all/${encodeURIComponent(context.authorId)}`,
      origin,
    ).toString(),
    {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    },
  );
  if (response.status === 404) return "denied";
  if (response.status !== 200)
    return retryable(response.status) ? "retryable" : "denied";
  const body: unknown = await response.json();
  return object(body) &&
    typeof body.access_level === "number" &&
    Number.isSafeInteger(body.access_level) &&
    body.access_level >= 30
    ? "authorized"
    : "denied";
}

function providerOrigin(value: string): URL {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("PROVIDER_MESSAGE_AUTHORITY_CONFIG_INVALID");
  return new URL(parsed.toString().replace(/\/?$/u, "/"));
}

export function createProviderMessageAuthorVerifier(
  gitlabOrigin: string,
  vault: ProviderGrantVault,
  fetcher: Fetcher = globalThis.fetch,
): ProviderMessageAuthorVerifier {
  const origin = providerOrigin(gitlabOrigin);
  return {
    async verify(context) {
      try {
        const material = await vault.open(context.provider, context.encryptedGrantRef);
        return context.provider === "github"
          ? await github(context, material.accessToken, fetcher)
          : await gitlab(origin, context, material.accessToken, fetcher);
      } catch {
        return "retryable";
      }
    },
  };
}
