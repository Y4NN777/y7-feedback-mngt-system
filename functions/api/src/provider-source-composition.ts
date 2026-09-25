import type { TablesDB } from "node-appwrite";
import { createHash, randomBytes } from "node:crypto";

import type { ServerConfig } from "@y7-feedback/config/server";

import { createAppwriteProviderWebhookAuthorityStore } from "./appwrite-provider-webhook-authority-store.js";
import { createNodeAppwriteProviderGrantVault } from "./appwrite-provider-grant-vault.js";
import { createNodeAppwriteSourceConnectionStore } from "./appwrite-source-connection-store.js";
import {
  createAppwriteSourceProjectSlugPort,
  createNodeAppwriteSourceManagementStore,
} from "./appwrite-source-management-store.js";
import { createGitHubSourceProvider } from "./github-source-provider.js";
import { createGitLabSourceProvider } from "./gitlab-source-provider.js";
import { createProviderWebhookProvisioner } from "./provider-webhook-provisioner.js";
import {
  createSourceConnectionCoordinator,
  type SourcePrincipalVerifier,
  type SourceScopeResolver,
} from "./source-connection-coordinator.js";
import { createSourceConnectionHttp } from "./source-connection-http.js";
import { createSourceManagementCoordinator } from "./source-management.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

interface ProviderSourceRuntime {
  readonly tables: TablesDB;
  readonly createId: () => string;
  readonly nowIso: () => string;
  readonly nowMs: () => number;
  readonly createProviderNonce?: () => string;
  readonly digestProviderNonce?: (nonce: string) => string;
  readonly providerDiagnostic?: (event: {
    readonly provider: "github";
    readonly stage:
      "token_exchange" | "installations" | "repositories" | "metadata" | "releases";
    readonly status: number;
  }) => void;
}

export interface ProviderSourceComposition {
  readonly config: ServerConfig & {
    readonly providers: NonNullable<ServerConfig["providers"]>;
  };
  readonly runtime: ProviderSourceRuntime;
  readonly principalVerifier: SourcePrincipalVerifier;
  readonly scopeResolver: SourceScopeResolver;
  readonly sensitive: AppwriteSensitivePersistence;
}

function webhookBase(callbackUrl: string, provider: "github" | "gitlab"): string {
  return `${new URL(callbackUrl).origin}/providers/${provider}/webhooks/`;
}

export function createProviderSourceHttp(input: ProviderSourceComposition) {
  const { config, runtime } = input;
  const vault = createNodeAppwriteProviderGrantVault(
    runtime.tables,
    {
      databaseId: config.appwriteSchema.databaseId,
      providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
    },
    Buffer.from(config.providerGrantEnvelopeKey, "base64url"),
  );
  const providers = [
    createGitHubSourceProvider(
      config.providers.github,
      vault,
      globalThis.fetch,
      Date.now,
      100,
      (event) => runtime.providerDiagnostic?.({ provider: "github", ...event }),
    ),
    createGitLabSourceProvider(config.providers.gitlab, vault),
  ] as const;
  const webhookAuthority = createAppwriteProviderWebhookAuthorityStore(
    runtime.tables,
    {
      databaseId: config.appwriteSchema.databaseId,
      sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
      providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
    },
    input.sensitive,
  );

  return createSourceConnectionHttp(
    createSourceConnectionCoordinator({
      principalVerifier: input.principalVerifier,
      scopeResolver: input.scopeResolver,
      store: createNodeAppwriteSourceConnectionStore(runtime.tables, {
        databaseId: config.appwriteSchema.databaseId,
        sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
      }),
      providers,
      webhooks: createProviderWebhookProvisioner(
        {
          githubApiOrigin: "https://api.github.com/",
          gitlabOrigin: config.providers.gitlab.origin,
          callbackBaseUrls: {
            github: webhookBase(config.providers.github.callbackUrl, "github"),
            gitlab: webhookBase(config.providers.gitlab.callbackUrl, "gitlab"),
          },
        },
        vault,
        webhookAuthority,
        () => randomBytes(32).toString("base64url"),
      ),
      createStateId: runtime.createId,
      createNonce:
        runtime.createProviderNonce ?? (() => randomBytes(24).toString("base64url")),
      digestNonce:
        runtime.digestProviderNonce ??
        ((nonce) => createHash("sha256").update(nonce).digest("base64url")),
      now: runtime.nowMs,
      nowIso: runtime.nowIso,
      ttlMs: 5 * 60 * 1_000,
    }),
    {
      github: config.providers.github.callbackUrl,
      gitlab: config.providers.gitlab.callbackUrl,
    },
    createSourceManagementCoordinator({
      principalVerifier: input.principalVerifier,
      scopeResolver: input.scopeResolver,
      store: createNodeAppwriteSourceManagementStore(runtime.tables, {
        databaseId: config.appwriteSchema.databaseId,
        sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
      }),
      providers,
      projectSlug: createAppwriteSourceProjectSlugPort(
        (request) => runtime.tables.getRow(request),
        {
          databaseId: config.appwriteSchema.databaseId,
          projectsTableId: config.appwriteSchema.projectsTableId,
        },
      ),
      nowIso: runtime.nowIso,
    }),
  );
}
