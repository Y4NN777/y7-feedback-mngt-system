import type { SourceProvider } from "@y7-feedback/domain";

import type { ProviderWebhookCredentialWriter } from "./appwrite-provider-webhook-authority-store.js";
import type {
  ActiveSourceGrant,
  SourceWebhookProvisioner,
} from "./source-connection-coordinator.js";
import type { ProviderGrantVault } from "./source-provider.js";
import type { ProviderWebhookAuthorityStore } from "./provider-webhook-ingress.js";

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export class ProviderWebhookAuthorityDeniedError extends Error {
  constructor() {
    super("PROVIDER_WEBHOOK_AUTHORITY_DENIED");
    this.name = "ProviderWebhookAuthorityDeniedError";
  }
}

export interface ProviderWebhookProvisionerConfig {
  readonly githubApiOrigin: string;
  readonly gitlabOrigin: string;
  readonly callbackBaseUrls: Readonly<Record<SourceProvider, string>>;
}

const githubVersion = "2026-03-10";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function required(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value || value.length > maximum)
    throw new Error("PROVIDER_WEBHOOK_PROVISION_INVALID");
  return value;
}

function endpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("PROVIDER_WEBHOOK_PROVISION_CONFIG_INVALID");
  return url;
}

async function json(response: Response): Promise<unknown> {
  if ([401, 403, 404].includes(response.status))
    throw new ProviderWebhookAuthorityDeniedError();
  if (response.status < 200 || response.status >= 300)
    throw new Error("PROVIDER_WEBHOOK_PROVISION_UNAVAILABLE");
  return response.status === 204 ? null : ((await response.json()) as unknown);
}

function githubRepository(value: unknown): {
  readonly owner: string;
  readonly name: string;
} {
  if (!object(value) || !object(value.owner))
    throw new Error("PROVIDER_WEBHOOK_PROVISION_INVALID");
  return { owner: required(value.owner.login, 500), name: required(value.name, 500) };
}

function hookId(value: Readonly<Record<string, unknown>>): number {
  if (typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id <= 0)
    throw new Error("PROVIDER_WEBHOOK_PROVISION_INVALID");
  return value.id;
}

export function createProviderWebhookProvisioner(
  config: ProviderWebhookProvisionerConfig,
  vault: ProviderGrantVault,
  authority: ProviderWebhookAuthorityStore & ProviderWebhookCredentialWriter,
  createSecret: () => string,
  fetcher: Fetcher = globalThis.fetch,
): SourceWebhookProvisioner {
  const githubApi = endpoint(config.githubApiOrigin);
  const gitlab = endpoint(config.gitlabOrigin);
  const callbackBases = {
    github: endpoint(config.callbackBaseUrls.github),
    gitlab: endpoint(config.callbackBaseUrls.gitlab),
  } as const;
  const callback = (provider: SourceProvider, connectionId: string) =>
    new URL(encodeURIComponent(connectionId), callbackBases[provider]).toString();

  async function credential(input: ActiveSourceGrant) {
    const existing = await authority.resolve({
      provider: input.provider,
      connectionId: input.id,
    });
    if (existing) return existing.credential;
    const secret = required(createSecret(), 512);
    if (secret.length < 32) throw new Error("PROVIDER_WEBHOOK_PROVISION_INVALID");
    const created =
      input.provider === "github"
        ? ({ kind: "github_hmac", secret } as const)
        : ({ kind: "gitlab_legacy", secret } as const);
    await authority.save({
      provider: input.provider,
      encryptedGrantRef: input.encryptedGrantRef,
      credential: created,
    });
    return created;
  }

  async function githubCoordinates(repositoryId: string, token: string) {
    return githubRepository(
      await json(
        await fetcher(new URL(`repositories/${repositoryId}`, githubApi).toString(), {
          method: "GET",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "x-github-api-version": githubVersion,
          },
        }),
      ),
    );
  }

  const githubHeaders = (token: string) => ({
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": githubVersion,
  });

  async function githubEnsure(input: ActiveSourceGrant, token: string, secret: string) {
    const callbackUrl = callback("github", input.id);
    for (const repository of input.selectedRepositories) {
      const coordinates = await githubCoordinates(repository.id, token);
      const base = new URL(
        `repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.name)}/hooks`,
        githubApi,
      );
      const listed = await json(
        await fetcher(base.toString(), {
          method: "GET",
          headers: githubHeaders(token),
        }),
      );
      if (!Array.isArray(listed)) throw new Error("PROVIDER_WEBHOOK_PROVISION_INVALID");
      const hooks: readonly unknown[] = listed;
      const matching = hooks.find(
        (value): value is Readonly<Record<string, unknown>> =>
          object(value) && object(value.config) && value.config.url === callbackUrl,
      );
      const body = JSON.stringify({
        active: true,
        events: ["issues", "issue_comment"],
        config: { url: callbackUrl, content_type: "json", insecure_ssl: "0", secret },
      });
      await json(
        await fetcher(
          matching
            ? new URL(String(hookId(matching)), `${base.toString()}/`).toString()
            : base.toString(),
          { method: matching ? "PATCH" : "POST", headers: githubHeaders(token), body },
        ),
      );
    }
  }

  async function gitlabEnsure(input: ActiveSourceGrant, token: string, secret: string) {
    const callbackUrl = callback("gitlab", input.id);
    for (const repository of input.selectedRepositories) {
      const base = new URL(`api/v4/projects/${repository.id}/hooks`, gitlab);
      const headers = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      };
      const listed = await json(
        await fetcher(base.toString(), { method: "GET", headers }),
      );
      if (!Array.isArray(listed)) throw new Error("PROVIDER_WEBHOOK_PROVISION_INVALID");
      const hooks: readonly unknown[] = listed;
      const matching = hooks.find(
        (value): value is Readonly<Record<string, unknown>> =>
          object(value) && value.url === callbackUrl,
      );
      const body = JSON.stringify({
        url: callbackUrl,
        token: secret,
        issues_events: true,
        note_events: true,
        push_events: true,
        enable_ssl_verification: true,
      });
      await json(
        await fetcher(
          matching
            ? new URL(String(hookId(matching)), `${base.toString()}/`).toString()
            : base.toString(),
          { method: matching ? "PUT" : "POST", headers, body },
        ),
      );
    }
  }

  async function remove(input: ActiveSourceGrant): Promise<void> {
    const material = await vault.open(input.provider, input.encryptedGrantRef);
    const token = required(material.accessToken, 10_000);
    for (const repository of input.selectedRepositories) {
      if (input.provider === "github") {
        const callbackUrl = callback("github", input.id);
        const coordinates = await githubCoordinates(repository.id, token);
        const base = new URL(
          `repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.name)}/hooks`,
          githubApi,
        );
        const listed = await json(
          await fetcher(base.toString(), {
            method: "GET",
            headers: githubHeaders(token),
          }),
        );
        if (!Array.isArray(listed))
          throw new Error("PROVIDER_WEBHOOK_PROVISION_INVALID");
        for (const value of listed) {
          if (object(value) && object(value.config) && value.config.url === callbackUrl)
            await json(
              await fetcher(
                new URL(String(hookId(value)), `${base.toString()}/`).toString(),
                {
                  method: "DELETE",
                  headers: githubHeaders(token),
                },
              ),
            );
        }
      } else {
        const callbackUrl = callback("gitlab", input.id);
        const base = new URL(`api/v4/projects/${repository.id}/hooks`, gitlab);
        const headers = { authorization: `Bearer ${token}` };
        const listed = await json(
          await fetcher(base.toString(), { method: "GET", headers }),
        );
        if (!Array.isArray(listed))
          throw new Error("PROVIDER_WEBHOOK_PROVISION_INVALID");
        for (const value of listed) {
          if (object(value) && value.url === callbackUrl)
            await json(
              await fetcher(
                new URL(String(hookId(value)), `${base.toString()}/`).toString(),
                {
                  method: "DELETE",
                  headers,
                },
              ),
            );
        }
      }
    }
  }

  return {
    async ensure(input) {
      const material = await vault.open(input.provider, input.encryptedGrantRef);
      const token = required(material.accessToken, 10_000);
      const verified = await credential(input);
      if (input.provider === "github") {
        if (verified.kind !== "github_hmac")
          throw new Error("PROVIDER_WEBHOOK_PROVISION_INVALID");
        await githubEnsure(input, token, verified.secret);
      } else {
        if (verified.kind !== "gitlab_legacy")
          throw new Error("PROVIDER_WEBHOOK_PROVISION_INVALID");
        await gitlabEnsure(input, token, verified.secret);
      }
    },
    remove,
  };
}
