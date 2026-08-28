import type {
  ProviderReleaseMetadata,
  ProviderRepositoryMetadata,
  RepositoryIdentity,
  RepositoryVisibility,
} from "@y7-feedback/domain";

import type {
  ProviderGrantMaterial,
  ProviderGrantVault,
  SourceProviderAdapter,
} from "./source-provider.js";

export interface GitLabProviderConfig {
  readonly origin: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

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

function providerOrigin(value: string): URL {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("SOURCE_PROVIDER_CONFIG_INVALID");
    }
    return url;
  } catch {
    throw new Error("SOURCE_PROVIDER_CONFIG_INVALID");
  }
}

function redirectUri(value: string): string {
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

function token(value: unknown, now: number): ProviderGrantMaterial {
  if (!isObject(value) || value.token_type !== "Bearer") {
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

function repositories(value: unknown): readonly RepositoryIdentity[] {
  if (!Array.isArray(value)) {
    throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
  }
  return (value as readonly unknown[]).map((item) => {
    if (
      !isObject(item) ||
      typeof item.id !== "number" ||
      !Number.isSafeInteger(item.id) ||
      item.id <= 0
    ) {
      throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
    }
    return { provider: "gitlab" as const, id: String(item.id) };
  });
}

function repositoryMetadata(
  value: unknown,
  expectedId: string,
): ProviderRepositoryMetadata {
  if (
    !isObject(value) ||
    typeof value.id !== "number" ||
    !Number.isSafeInteger(value.id) ||
    String(value.id) !== expectedId ||
    !isObject(value.namespace)
  ) {
    throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
  }
  const visibility = value.visibility;
  if (
    visibility !== "public" &&
    visibility !== "private" &&
    visibility !== "internal"
  ) {
    throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
  }
  return {
    provider: "gitlab",
    id: expectedId,
    name: required(value.path, 500),
    owner: required(value.namespace.full_path, 500),
    visibility: visibility as RepositoryVisibility,
    webUrl: required(value.web_url, 2_000),
    defaultBranch: required(value.default_branch, 200),
    releases: [],
  };
}

function releaseMetadata(
  value: unknown,
  repositoryWebUrl: string,
): ProviderReleaseMetadata {
  if (!isObject(value)) throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
  const tag = required(value.tag_name, 200);
  return {
    id: tag,
    tag,
    name: required(value.name, 500),
    publishedAt: required(value.released_at, 40),
    webUrl: `${repositoryWebUrl}/-/releases/${encodeURIComponent(tag)}`,
  };
}

function unavailable(): never {
  throw new Error("SOURCE_PROVIDER_UNAVAILABLE");
}

export function createGitLabSourceProvider(
  config: GitLabProviderConfig,
  vault: ProviderGrantVault,
  fetcher: Fetcher = globalThis.fetch,
  now: () => number = Date.now,
): SourceProviderAdapter {
  const origin = providerOrigin(config.origin);
  let clientId: string;
  let clientSecret: string;
  try {
    clientId = required(config.clientId, 500);
    clientSecret = required(config.clientSecret, 2_000);
  } catch {
    throw new Error("SOURCE_PROVIDER_CONFIG_INVALID");
  }

  return {
    provider: "gitlab",
    authorizationUrl(input) {
      const url = new URL("oauth/authorize", origin);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri(input.redirectUri),
        response_type: "code",
        state: required(input.state, 1_000),
        scope: "api",
      }).toString();
      return url.toString();
    },
    async completeAuthorization(input) {
      try {
        const callback = redirectUri(input.redirectUri);
        const exchange = await fetcher(new URL("oauth/token", origin).toString(), {
          method: "POST",
          cache: "no-store",
          credentials: "omit",
          headers: { accept: "application/json" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: required(input.code, 2_000),
            grant_type: "authorization_code",
            redirect_uri: callback,
          }),
        });
        if (exchange.status !== 200) return unavailable();
        const grant = token((await exchange.json()) as unknown, now());
        const authorized = new Map<string, RepositoryIdentity>();
        let page = 1;
        for (;;) {
          const url = new URL("api/v4/projects", origin);
          url.search = new URLSearchParams({
            membership: "true",
            simple: "true",
            per_page: "100",
            page: String(page),
          }).toString();
          const result = await fetcher(url.toString(), {
            method: "GET",
            cache: "no-store",
            credentials: "omit",
            headers: { authorization: `Bearer ${grant.accessToken}` },
          });
          if (result.status !== 200) return unavailable();
          for (const repository of repositories((await result.json()) as unknown)) {
            authorized.set(repository.id, repository);
          }
          const next = result.headers.get("x-next-page");
          if (!next) break;
          const nextPage = Number(next);
          if (!Number.isSafeInteger(nextPage) || nextPage <= page || nextPage > 100) {
            throw new Error("SOURCE_PROVIDER_RESPONSE_INVALID");
          }
          page = nextPage;
        }
        return {
          encryptedGrantRef: required(await vault.seal("gitlab", grant), 1_000),
          authorizedRepositories: [...authorized.values()],
        };
      } catch {
        return unavailable();
      }
    },
    async importRepository(input) {
      try {
        const repositoryId = required(input.repositoryId, 36);
        if (!/^[1-9][0-9]{0,35}$/u.test(repositoryId)) return unavailable();
        const grant = await vault.open(
          "gitlab",
          required(input.encryptedGrantRef, 1_000),
        );
        const requestHeaders = {
          authorization: `Bearer ${required(grant.accessToken)}`,
        };
        const metadataResult = await fetcher(
          new URL(`api/v4/projects/${repositoryId}`, origin).toString(),
          {
            method: "GET",
            cache: "no-store",
            credentials: "omit",
            headers: requestHeaders,
          },
        );
        if (metadataResult.status !== 200) return unavailable();
        const metadata = repositoryMetadata(
          (await metadataResult.json()) as unknown,
          repositoryId,
        );
        const releases: ProviderReleaseMetadata[] = [];
        let page = 1;
        for (;;) {
          const url = new URL(`api/v4/projects/${repositoryId}/releases`, origin);
          url.search = new URLSearchParams({
            per_page: "100",
            page: String(page),
          }).toString();
          const result = await fetcher(url.toString(), {
            method: "GET",
            cache: "no-store",
            credentials: "omit",
            headers: requestHeaders,
          });
          if (result.status !== 200) return unavailable();
          const payload: unknown = await result.json();
          if (!Array.isArray(payload)) return unavailable();
          releases.push(
            ...payload.map((value) => releaseMetadata(value, metadata.webUrl)),
          );
          const next = result.headers.get("x-next-page");
          if (!next) return { ...metadata, releases };
          const nextPage = Number(next);
          if (!Number.isSafeInteger(nextPage) || nextPage <= page || nextPage > 100) {
            return unavailable();
          }
          page = nextPage;
        }
      } catch {
        return unavailable();
      }
    },
    async revokeGrant(encryptedGrantRef) {
      try {
        const grant = await vault.open("gitlab", required(encryptedGrantRef, 1_000));
        const result = await fetcher(new URL("oauth/revoke", origin).toString(), {
          method: "POST",
          cache: "no-store",
          credentials: "omit",
          headers: { accept: "application/json" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            token: required(grant.accessToken),
          }),
        });
        if (result.status !== 200) return unavailable();
        await vault.remove("gitlab", encryptedGrantRef);
      } catch {
        return unavailable();
      }
    },
  };
}
