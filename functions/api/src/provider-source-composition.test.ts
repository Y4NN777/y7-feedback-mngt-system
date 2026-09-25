import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TablesDB } from "node-appwrite";

import type { ServerConfig } from "@y7-feedback/config/server";

const mocks = vi.hoisted(() => ({
  authority: vi.fn(() => ({ authority: true })),
  connectionCoordinator: vi.fn((input: unknown) => ({ input })),
  connectionHttp: vi.fn(
    (connection: unknown, callbacks: unknown, management: unknown) => ({
      callbacks,
      connection,
      management,
    }),
  ),
  connectionStore: vi.fn(() => ({ connectionStore: true })),
  github: vi.fn(
    (
      _config: unknown,
      _vault: unknown,
      _fetch: unknown,
      _now: unknown,
      _limit: unknown,
      diagnostic: unknown,
    ) => ({
      diagnostic,
      provider: "github",
    }),
  ),
  gitlab: vi.fn(() => ({ provider: "gitlab" })),
  managementCoordinator: vi.fn((input: unknown) => ({ input })),
  managementStore: vi.fn(() => ({ managementStore: true })),
  projectSlug: vi.fn((read: unknown) => ({ read })),
  provisioner: vi.fn(
    (
      _config: unknown,
      _vault: unknown,
      _authority: unknown,
      createSecret: unknown,
    ) => ({ createSecret }),
  ),
  vault: vi.fn(() => ({ vault: true })),
}));

vi.mock("./appwrite-provider-webhook-authority-store.js", () => ({
  createAppwriteProviderWebhookAuthorityStore: mocks.authority,
}));
vi.mock("./appwrite-provider-grant-vault.js", () => ({
  createNodeAppwriteProviderGrantVault: mocks.vault,
}));
vi.mock("./appwrite-source-connection-store.js", () => ({
  createNodeAppwriteSourceConnectionStore: mocks.connectionStore,
}));
vi.mock("./appwrite-source-management-store.js", () => ({
  createAppwriteSourceProjectSlugPort: mocks.projectSlug,
  createNodeAppwriteSourceManagementStore: mocks.managementStore,
}));
vi.mock("./github-source-provider.js", () => ({
  createGitHubSourceProvider: mocks.github,
}));
vi.mock("./gitlab-source-provider.js", () => ({
  createGitLabSourceProvider: mocks.gitlab,
}));
vi.mock("./provider-webhook-provisioner.js", () => ({
  createProviderWebhookProvisioner: mocks.provisioner,
}));
vi.mock("./source-connection-coordinator.js", () => ({
  createSourceConnectionCoordinator: mocks.connectionCoordinator,
}));
vi.mock("./source-connection-http.js", () => ({
  createSourceConnectionHttp: mocks.connectionHttp,
}));
vi.mock("./source-management.js", () => ({
  createSourceManagementCoordinator: mocks.managementCoordinator,
}));

import { createProviderSourceHttp } from "./provider-source-composition.js";

const config = {
  appwriteSchema: {
    databaseId: "database",
    projectsTableId: "projects",
    providerGrantsTableId: "provider_grants",
    sourceConnectionsTableId: "source_connections",
  },
  providerGrantEnvelopeKey: Buffer.alloc(32, 7).toString("base64url"),
  providers: {
    github: {
      callbackUrl: "https://api.example.test/providers/github/callback",
      clientId: "github-client",
      clientSecret: "github-secret",
    },
    gitlab: {
      callbackUrl: "https://api.example.test/providers/gitlab/callback",
      clientId: "gitlab-client",
      clientSecret: "gitlab-secret",
      origin: "https://gitlab.example.test",
    },
  },
} as ServerConfig & { readonly providers: NonNullable<ServerConfig["providers"]> };

function composition(overrides: Readonly<Record<string, unknown>> = {}) {
  const getRow = vi.fn(() => Promise.resolve({}));
  const providerDiagnostic = vi.fn();
  return {
    getRow,
    input: {
      config,
      principalVerifier: { verify: vi.fn() },
      runtime: {
        tables: { getRow } as unknown as TablesDB,
        createId: () => "state-id",
        nowIso: () => "2026-09-25T00:00:00.000Z",
        nowMs: () => 42,
        providerDiagnostic,
        ...overrides,
      },
      scopeResolver: { resolve: vi.fn() },
      sensitive: {
        environment: "preview",
        protector: { open: vi.fn(), seal: vi.fn() },
      },
    },
    providerDiagnostic,
  };
}

describe("provider source composition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("wires provider authority, callback origins, stores, and injected entropy", async () => {
    const createProviderNonce = vi.fn(() => "provider-nonce");
    const digestProviderNonce = vi.fn(() => "nonce-digest");
    const target = composition({ createProviderNonce, digestProviderNonce });

    const result = createProviderSourceHttp(target.input);
    const coordinator = mocks.connectionCoordinator.mock.calls[0]?.[0] as {
      createNonce: () => string;
      digestNonce: (nonce: string) => string;
    };
    const githubDiagnostic = mocks.github.mock.calls[0]?.[5] as (event: {
      readonly stage: "metadata";
      readonly status: number;
    }) => void;
    const projectRead = (
      mocks.projectSlug.mock.results[0]?.value as {
        read: (input: unknown) => Promise<unknown>;
      }
    ).read;

    expect(result).toEqual(
      expect.objectContaining({
        callbacks: {
          github: config.providers.github.callbackUrl,
          gitlab: config.providers.gitlab.callbackUrl,
        },
      }),
    );
    expect(mocks.provisioner).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackBaseUrls: {
          github: "https://api.example.test/providers/github/webhooks/",
          gitlab: "https://api.example.test/providers/gitlab/webhooks/",
        },
      }),
      expect.anything(),
      expect.anything(),
      expect.any(Function),
    );
    const createWebhookSecret = mocks.provisioner.mock.calls[0]?.[3] as () => string;
    expect(createWebhookSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(coordinator.createNonce()).toBe("provider-nonce");
    expect(coordinator.digestNonce("nonce")).toBe("nonce-digest");
    githubDiagnostic({ stage: "metadata", status: 200 });
    expect(target.providerDiagnostic).toHaveBeenCalledWith({
      provider: "github",
      stage: "metadata",
      status: 200,
    });
    await projectRead({ rowId: "project" });
    expect(target.getRow).toHaveBeenCalledWith({ rowId: "project" });
  });

  it("provides secure nonce and digest defaults without a diagnostic observer", () => {
    const target = composition({ providerDiagnostic: undefined });
    createProviderSourceHttp(target.input);
    const coordinator = mocks.connectionCoordinator.mock.calls[0]?.[0] as {
      createNonce: () => string;
      digestNonce: (nonce: string) => string;
    };
    const githubDiagnostic = mocks.github.mock.calls[0]?.[5] as (event: {
      readonly stage: "metadata";
      readonly status: number;
    }) => void;

    expect(coordinator.createNonce()).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(coordinator.digestNonce("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(() => {
      githubDiagnostic({ stage: "metadata", status: 200 });
    }).not.toThrow();
  });
});
