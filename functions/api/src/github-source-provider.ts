import type { RepositoryIdentity } from "@y7-feedback/domain";

import type {
  ProviderGrantMaterial,
  ProviderGrantVault,
  SourceProviderAdapter,
} from "./source-provider";

export interface GitHubProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const webOrigin = new URL("https://github.com/");
const apiOrigin = new URL("https://api.github.com/");
const apiVersion = "2026-03-10";

function required(value: unknown, maximum = 10_000): string {
  if (typeof value !== "string") {
    throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
  }
  return normalized;
}

function callback(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new Error("SOURCE_PROVIDER_INPUT_INVALID");
    }
    return url.toString();
  } catch {
    throw new Error("SOURCE_PROVIDER_INPUT_INVALID");
  }
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function grant(value: unknown, now: number): ProviderGrantMaterial {
  if (
    !isObject(value) ||
    typeof value.token_type !== "string" ||
    value.token_type.toLowerCase() !== "bearer"
  ) {
    throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
  }
  const accessToken = required(value.access_token);
  const refreshToken =
    value.refresh_token === undefined ? undefined : required(value.refresh_token);
  const expiresIn = value.expires_in;
  if (
    expiresIn !== undefined &&
    (typeof expiresIn !== "number" ||
      !Number.isSafeInteger(expiresIn) ||
      expiresIn <= 0)
  ) {
    throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
  }
  return {
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresIn === undefined
      ? {}
      : { expiresAt: new Date(now + expiresIn * 1_000).toISOString() }),
  };
}

function positiveIds(value: unknown, field: string): readonly number[] {
  if (!isObject(value) || !Array.isArray(value[field])) {
    throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
  }
  return (value[field] as readonly unknown[]).map((entry) => {
    if (
      !isObject(entry) ||
      typeof entry.id !== "number" ||
      !Number.isSafeInteger(entry.id) ||
      entry.id <= 0
    ) {
      throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
    }
    return entry.id;
  });
}

function headers(token: string): Readonly<Record<string, string>> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": apiVersion,
  };
}

function hasNext(response: Response): boolean {
  return response.headers.get("link")?.includes('rel="next"') === true;
}

function unavailable(): never {
  throw new Error("SOURCE_PROVIDER_UNAVAILABLE");
}

export function createGitHubSourceProvider(
  config: GitHubProviderConfig,
  vault: ProviderGrantVault,
  fetcher: Fetcher = globalThis.fetch,
  now: () => number = Date.now,
  maximumPages = 100,
): SourceProviderAdapter {
  let clientId: string;
  let clientSecret: string;
  try {
    clientId = required(config.clientId, 500);
    clientSecret = required(config.clientSecret, 2_000);
  } catch {
    throw new Error("SOURCE_PROVIDER_CONFIG_INVALID");
  }

  async function requestIds(
    path: string,
    field: string,
    accessToken: string,
  ): Promise<readonly number[]> {
    const ids: number[] = [];
    for (let page = 1; page <= maximumPages; page += 1) {
      const url = new URL(path, apiOrigin);
      url.search = new URLSearchParams({
        per_page: "100",
        page: String(page),
      }).toString();
      const result = await fetcher(url.toString(), {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        headers: headers(accessToken),
      });
      if (result.status !== 200) return unavailable();
      ids.push(...positiveIds((await result.json()) as unknown, field));
      if (!hasNext(result)) return ids;
    }
    return unavailable();
  }

  return {
    provider: "github",
    authorizationUrl(input) {
      const url = new URL("login/oauth/authorize", webOrigin);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callback(input.redirectUri),
        state: required(input.state, 1_000),
      }).toString();
      return url.toString();
    },
    async completeAuthorization(input) {
      try {
        const redirectUri = callback(input.redirectUri);
        const exchange = await fetcher(
          new URL("login/oauth/access_token", webOrigin).toString(),
          {
            method: "POST",
            cache: "no-store",
            credentials: "omit",
            headers: { accept: "application/json" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              code: required(input.code, 2_000),
              redirect_uri: redirectUri,
            }),
          },
        );
        if (exchange.status !== 200) return unavailable();
        const material = grant((await exchange.json()) as unknown, now());
        const installationIds = await requestIds(
          "user/installations",
          "installations",
          material.accessToken,
        );
        const repositories = new Map<string, RepositoryIdentity>();
        for (const installationId of installationIds) {
          const repositoryIds = await requestIds(
            `user/installations/${String(installationId)}/repositories`,
            "repositories",
            material.accessToken,
          );
          for (const repositoryId of repositoryIds) {
            const repository = {
              provider: "github" as const,
              id: String(repositoryId),
            };
            repositories.set(repository.id, repository);
          }
        }
        return {
          encryptedGrantRef: required(await vault.seal("github", material), 1_000),
          authorizedRepositories: [...repositories.values()],
        };
      } catch {
        return unavailable();
      }
    },
    async revokeGrant(encryptedGrantRef) {
      try {
        const material = await vault.open("github", required(encryptedGrantRef, 1_000));
        const result = await fetcher(
          new URL(
            `applications/${encodeURIComponent(clientId)}/grant`,
            apiOrigin,
          ).toString(),
          {
            method: "DELETE",
            cache: "no-store",
            credentials: "omit",
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
              "content-type": "application/json",
              "x-github-api-version": apiVersion,
            },
            body: JSON.stringify({ access_token: required(material.accessToken) }),
          },
        );
        if (result.status !== 204) return unavailable();
        await vault.remove("github", encryptedGrantRef);
      } catch {
        return unavailable();
      }
    },
  };
}
