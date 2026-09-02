import { describe, expect, it, vi } from "vitest";

import { createProviderWebhookProvisioner } from "./provider-webhook-provisioner.js";
import type { ProviderWebhookCredentialWriter } from "./appwrite-provider-webhook-authority-store.js";

const input = {
  id: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  ownerUserId: "owner_1",
  provider: "github" as const,
  encryptedGrantRef: "grant_1",
  selectedRepositories: [{ provider: "github" as const, id: "1329343404" }],
};

function response(status: number, value?: unknown): Response {
  return new Response(value === undefined ? null : JSON.stringify(value), {
    status,
    headers: value === undefined ? {} : { "content-type": "application/json" },
  });
}

function harness(
  responses: readonly Response[],
  resolved: unknown = null,
  options: {
    readonly accessToken?: unknown;
    readonly secret?: unknown;
  } = {},
) {
  const queue = [...responses];
  const fetcher = vi.fn((_input: string, _init: RequestInit) => {
    void _input;
    void _init;
    const next = queue.shift();
    return next
      ? Promise.resolve(next)
      : Promise.reject(new Error("unexpected provider request"));
  });
  const vault = {
    seal: vi.fn(() => Promise.reject(new Error("unused"))),
    open: vi.fn(() =>
      Promise.resolve({
        accessToken: options.accessToken ?? "provider-token",
      } as { accessToken: string }),
    ),
    remove: vi.fn(() => Promise.reject(new Error("unused"))),
  };
  const authority = {
    resolve: vi.fn(() => Promise.resolve(resolved as never)),
    save: vi.fn((_input: Parameters<ProviderWebhookCredentialWriter["save"]>[0]) => {
      void _input;
      return Promise.resolve();
    }),
  };
  const provisioner = createProviderWebhookProvisioner(
    {
      githubApiOrigin: "https://api.github.test/",
      gitlabOrigin: "https://gitlab.test/",
      callbackBaseUrls: {
        github: "https://api.test/providers/github/webhooks/",
        gitlab: "https://api.test/providers/gitlab/webhooks/",
      },
    },
    vault,
    authority,
    () =>
      (options.secret === undefined
        ? "generated-webhook-secret-with-at-least-32-bytes"
        : options.secret) as string,
    fetcher,
  );
  return { provisioner, fetcher, authority, vault };
}

describe("provider webhook provisioner", () => {
  it("BDD-SYNC-034 creates and then reconciles a GitHub webhook", async () => {
    const created = harness([
      response(200, { name: "repo", owner: { login: "owner" } }),
      response(200, []),
      response(201, { id: 10 }),
    ]);
    await created.provisioner.ensure(input);
    expect(created.authority.save.mock.calls[0]?.[0]).toMatchObject({
      provider: "github",
      encryptedGrantRef: "grant_1",
      credential: { kind: "github_hmac" },
    });
    const createCall = created.fetcher.mock.calls.at(-1);
    expect(createCall?.[0]).toBe("https://api.github.test/repos/owner/repo/hooks");
    expect(createCall?.[1].method).toBe("POST");
    const createBody = createCall?.[1].body;
    if (typeof createBody !== "string") throw new Error("expected JSON request body");
    expect(createBody).toContain(
      "https://api.test/providers/github/webhooks/connection_1",
    );

    const reconciled = harness(
      [
        response(200, { name: "repo", owner: { login: "owner" } }),
        response(200, [
          {
            id: 10,
            config: {
              url: "https://api.test/providers/github/webhooks/connection_1",
            },
          },
        ]),
        response(200, { id: 10 }),
      ],
      {
        ...input,
        repositoryId: "1329343404",
        credential: { kind: "github_hmac", secret: "existing-secret" },
        active: true,
      },
    );
    await reconciled.provisioner.ensure(input);
    expect(reconciled.authority.save).not.toHaveBeenCalled();
    expect(reconciled.fetcher).toHaveBeenLastCalledWith(
      "https://api.github.test/repos/owner/repo/hooks/10",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("BDD-SYNC-035 creates and reconciles a GitLab webhook", async () => {
    const gitlab = {
      ...input,
      provider: "gitlab" as const,
      selectedRepositories: [{ provider: "gitlab" as const, id: "83836910" }],
    };
    const created = harness([response(200, []), response(201, { id: 20 })]);
    await created.provisioner.ensure(gitlab);
    expect(created.fetcher).toHaveBeenLastCalledWith(
      "https://gitlab.test/api/v4/projects/83836910/hooks",
      expect.objectContaining({ method: "POST" }),
    );

    const reconciled = harness(
      [
        response(200, [
          {
            id: 20,
            url: "https://api.test/providers/gitlab/webhooks/connection_1",
          },
        ]),
        response(200, { id: 20 }),
      ],
      {
        ...gitlab,
        repositoryId: "83836910",
        credential: {
          kind: "gitlab_legacy",
          secret: "existing-gitlab-secret-with-at-least-32-bytes",
        },
        active: true,
      },
    );
    await reconciled.provisioner.ensure(gitlab);
    expect(reconciled.fetcher).toHaveBeenLastCalledWith(
      "https://gitlab.test/api/v4/projects/83836910/hooks/20",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("BDD-SYNC-036 removes only Y7-owned GitHub and GitLab webhooks", async () => {
    const github = harness([
      response(200, { name: "repo", owner: { login: "owner" } }),
      response(200, [
        {
          id: 10,
          config: { url: "https://api.test/providers/github/webhooks/connection_1" },
        },
        { id: 11, config: { url: "https://elsewhere.test/hook" } },
      ]),
      response(204),
    ]);
    await github.provisioner.remove(input);
    expect(github.fetcher).toHaveBeenLastCalledWith(
      "https://api.github.test/repos/owner/repo/hooks/10",
      expect.objectContaining({ method: "DELETE" }),
    );

    const gitlabInput = {
      ...input,
      provider: "gitlab" as const,
      selectedRepositories: [{ provider: "gitlab" as const, id: "83836910" }],
    };
    const gitlab = harness([
      response(200, [
        {
          id: 20,
          url: "https://api.test/providers/gitlab/webhooks/connection_1",
        },
        { id: 21, url: "https://elsewhere.test/hook" },
      ]),
      response(204),
    ]);
    await gitlab.provisioner.remove(gitlabInput);
    expect(gitlab.fetcher).toHaveBeenLastCalledWith(
      "https://gitlab.test/api/v4/projects/83836910/hooks/20",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("BDD-SYNC-037 rejects unsafe configuration, tokens and generated credentials", async () => {
    const baseConfig = {
      githubApiOrigin: "https://api.github.test/",
      gitlabOrigin: "https://gitlab.test/",
      callbackBaseUrls: {
        github: "https://api.test/providers/github/webhooks/",
        gitlab: "https://api.test/providers/gitlab/webhooks/",
      },
    };
    const unused = harness([]);
    for (const githubApiOrigin of [
      "http://api.github.test/",
      "https://user@api.github.test/",
      "https://api.github.test/#fragment",
    ]) {
      expect(() =>
        createProviderWebhookProvisioner(
          { ...baseConfig, githubApiOrigin },
          unused.vault,
          unused.authority,
          () => "long-enough-generated-secret-value",
          unused.fetcher,
        ),
      ).toThrow("PROVIDER_WEBHOOK_PROVISION_CONFIG_INVALID");
    }
    for (const accessToken of [undefined, "", "x".repeat(10_001)]) {
      const invalid = harness([], null, { accessToken });
      if (accessToken === undefined)
        invalid.vault.open.mockResolvedValueOnce({ accessToken: undefined as never });
      await expect(invalid.provisioner.ensure(input)).rejects.toThrow(
        "PROVIDER_WEBHOOK_PROVISION_INVALID",
      );
    }
    for (const secret of [null, "short", "x".repeat(513)]) {
      const invalid = harness([], null, { secret });
      await expect(invalid.provisioner.ensure(input)).rejects.toThrow(
        "PROVIDER_WEBHOOK_PROVISION_INVALID",
      );
    }
  });

  it("BDD-SYNC-038 fails closed on malformed provider responses", async () => {
    for (const repository of [
      null,
      {},
      { owner: null },
      { owner: { login: "" }, name: "repo" },
    ]) {
      const invalid = harness([response(200, repository)]);
      await expect(invalid.provisioner.ensure(input)).rejects.toThrow(
        "PROVIDER_WEBHOOK_PROVISION_INVALID",
      );
    }
    const unavailable = harness([response(503, { error: "unavailable" })]);
    await expect(unavailable.provisioner.ensure(input)).rejects.toThrow(
      "PROVIDER_WEBHOOK_PROVISION_UNAVAILABLE",
    );
    const githubList = harness([
      response(200, { name: "repo", owner: { login: "owner" } }),
      response(200, {}),
    ]);
    await expect(githubList.provisioner.ensure(input)).rejects.toThrow(
      "PROVIDER_WEBHOOK_PROVISION_INVALID",
    );
    const gitlabInput = {
      ...input,
      provider: "gitlab" as const,
      selectedRepositories: [{ provider: "gitlab" as const, id: "83836910" }],
    };
    const gitlabList = harness([response(200, {})]);
    await expect(gitlabList.provisioner.ensure(gitlabInput)).rejects.toThrow(
      "PROVIDER_WEBHOOK_PROVISION_INVALID",
    );
    for (const badHook of [null, {}, { id: "1" }, { id: 1.5 }, { id: 0 }]) {
      const invalid = harness(
        [
          response(200, { name: "repo", owner: { login: "owner" } }),
          response(200, [
            {
              ...(typeof badHook === "object" && badHook ? badHook : {}),
              config: {
                url: "https://api.test/providers/github/webhooks/connection_1",
              },
            },
          ]),
        ],
        {
          ...input,
          repositoryId: "1329343404",
          credential: { kind: "github_hmac", secret: "existing-secret" },
          active: true,
        },
      );
      await expect(invalid.provisioner.ensure(input)).rejects.toThrow(
        "PROVIDER_WEBHOOK_PROVISION_INVALID",
      );
    }
  });

  it("BDD-SYNC-039 rejects mismatched credentials and malformed removal lists", async () => {
    const wrongGitHub = harness([], {
      ...input,
      credential: {
        kind: "gitlab_legacy",
        secret: "existing-gitlab-secret-with-at-least-32-bytes",
      },
      active: true,
    });
    await expect(wrongGitHub.provisioner.ensure(input)).rejects.toThrow(
      "PROVIDER_WEBHOOK_PROVISION_INVALID",
    );
    const gitlabInput = {
      ...input,
      provider: "gitlab" as const,
      selectedRepositories: [{ provider: "gitlab" as const, id: "83836910" }],
    };
    const wrongGitLab = harness([], {
      ...gitlabInput,
      credential: { kind: "github_hmac", secret: "existing-secret" },
      active: true,
    });
    await expect(wrongGitLab.provisioner.ensure(gitlabInput)).rejects.toThrow(
      "PROVIDER_WEBHOOK_PROVISION_INVALID",
    );
    const githubRemoval = harness([
      response(200, { name: "repo", owner: { login: "owner" } }),
      response(200, {}),
    ]);
    await expect(githubRemoval.provisioner.remove(input)).rejects.toThrow(
      "PROVIDER_WEBHOOK_PROVISION_INVALID",
    );
    const gitlabRemoval = harness([response(200, {})]);
    await expect(gitlabRemoval.provisioner.remove(gitlabInput)).rejects.toThrow(
      "PROVIDER_WEBHOOK_PROVISION_INVALID",
    );
  });
});
