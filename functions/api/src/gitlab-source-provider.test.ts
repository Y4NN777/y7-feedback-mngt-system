import { describe, expect, it, vi } from "vitest";

import type { ProviderGrantVault } from "./source-provider";
import { createGitLabSourceProvider } from "./gitlab-source-provider";

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function setup(responses: readonly Response[]) {
  const queue = [...responses];
  const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(queue.shift() ?? json(500, {})),
  );
  const seal = vi.fn<ProviderGrantVault["seal"]>(() =>
    Promise.resolve("vault:gitlab:grant-1"),
  );
  const open = vi.fn<ProviderGrantVault["open"]>(() =>
    Promise.resolve({
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      expiresAt: "2026-08-10T16:00:00.000Z",
    }),
  );
  const remove = vi.fn<ProviderGrantVault["remove"]>(() => Promise.resolve());
  const vault: ProviderGrantVault = { seal, open, remove };
  return {
    fetcher,
    open,
    provider: createGitLabSourceProvider(
      {
        origin: "https://gitlab.com",
        clientId: "application-id",
        clientSecret: "application-secret",
      },
      vault,
      fetcher,
      () => 1_786_370_400_000,
    ),
    remove,
    seal,
  };
}

describe("GitLab OAuth source provider adapter", () => {
  it("BDD-SRC-GITLAB-001 creates a bounded authorization URL", () => {
    const { provider } = setup([]);
    expect(
      provider.authorizationUrl({
        state: "opaque-state",
        redirectUri: "https://feedback.example/callback/gitlab",
      }),
    ).toBe(
      "https://gitlab.com/oauth/authorize?client_id=application-id&redirect_uri=https%3A%2F%2Ffeedback.example%2Fcallback%2Fgitlab&response_type=code&state=opaque-state&scope=api",
    );
  });

  it("BDD-SRC-GITLAB-002 exchanges, paginates membership, and seals the grant", async () => {
    const { provider, fetcher, seal } = setup([
      json(200, {
        access_token: "secret-access-token",
        refresh_token: "secret-refresh-token",
        token_type: "Bearer",
        expires_in: 7200,
      }),
      json(
        200,
        [
          { id: 42, path_with_namespace: "group/project" },
          { id: 84, path_with_namespace: "group/second" },
        ],
        { "x-next-page": "2" },
      ),
      json(200, [{ id: 126, path_with_namespace: "group/third" }]),
    ]);

    await expect(
      provider.completeAuthorization({
        code: "one-use-code",
        redirectUri: "https://feedback.example/callback/gitlab",
      }),
    ).resolves.toEqual({
      encryptedGrantRef: "vault:gitlab:grant-1",
      authorizedRepositories: [
        { provider: "gitlab", id: "42" },
        { provider: "gitlab", id: "84" },
        { provider: "gitlab", id: "126" },
      ],
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://gitlab.com/oauth/token",
      expect.objectContaining({
        method: "POST",
        body: new URLSearchParams({
          client_id: "application-id",
          client_secret: "application-secret",
          code: "one-use-code",
          grant_type: "authorization_code",
          redirect_uri: "https://feedback.example/callback/gitlab",
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://gitlab.com/api/v4/projects?membership=true&simple=true&per_page=100&page=1",
      expect.objectContaining({
        headers: { authorization: "Bearer secret-access-token" },
      }),
    );
    expect(seal).toHaveBeenCalledWith("gitlab", {
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      expiresAt: "2026-08-10T16:00:00.000Z",
    });
  });

  it("BDD-SRC-GITLAB-003 revokes remotely before deleting the sealed grant", async () => {
    const { provider, fetcher, open, remove } = setup([json(200, {})]);

    await provider.revokeGrant("vault:gitlab:grant-1");

    expect(open).toHaveBeenCalledWith("gitlab", "vault:gitlab:grant-1");
    expect(fetcher).toHaveBeenCalledWith(
      "https://gitlab.com/oauth/revoke",
      expect.objectContaining({
        method: "POST",
        body: new URLSearchParams({
          client_id: "application-id",
          client_secret: "application-secret",
          token: "secret-access-token",
        }),
      }),
    );
    expect(remove).toHaveBeenCalledWith("gitlab", "vault:gitlab:grant-1");
  });

  it("BDD-SRC-GITLAB-004 imports selected project metadata and paginated releases", async () => {
    const { provider, fetcher, open } = setup([
      json(200, {
        id: 83836910,
        path: "feedback",
        namespace: { full_path: "Y4NN777" },
        visibility: "private",
        web_url: "https://gitlab.com/Y4NN777/feedback",
        default_branch: "main",
      }),
      json(
        200,
        [
          {
            tag_name: "v1.0.0",
            name: "First release",
            released_at: "2026-08-27T12:00:00.000Z",
          },
        ],
        { "x-next-page": "2" },
      ),
      json(200, []),
    ]);

    await expect(
      provider.importRepository({
        encryptedGrantRef: "vault:gitlab:grant-1",
        repositoryId: "83836910",
      }),
    ).resolves.toEqual({
      provider: "gitlab",
      id: "83836910",
      name: "feedback",
      owner: "Y4NN777",
      visibility: "private",
      webUrl: "https://gitlab.com/Y4NN777/feedback",
      defaultBranch: "main",
      releases: [
        {
          id: "v1.0.0",
          tag: "v1.0.0",
          name: "First release",
          publishedAt: "2026-08-27T12:00:00.000Z",
          webUrl: "https://gitlab.com/Y4NN777/feedback/-/releases/v1.0.0",
        },
      ],
    });
    expect(open).toHaveBeenCalledWith("gitlab", "vault:gitlab:grant-1");
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://gitlab.com/api/v4/projects/83836910",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://gitlab.com/api/v4/projects/83836910/releases?per_page=100&page=1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("fails closed when GitLab project metadata, releases or pagination are invalid", async () => {
    const validProject = {
      id: 83836910,
      path: "feedback",
      namespace: { full_path: "Y4NN777" },
      visibility: "public",
      web_url: "https://gitlab.com/Y4NN777/feedback",
      default_branch: "main",
    };
    const validRelease = {
      tag_name: "v1",
      name: "One",
      released_at: "2026-08-27T12:00:00.000Z",
    };
    const cases: readonly (readonly Response[])[] = [
      [json(404, {})],
      [json(200, null)],
      [json(200, { ...validProject, id: "83836910" })],
      [json(200, { ...validProject, id: 1.5 })],
      [json(200, { ...validProject, id: 7 })],
      [json(200, { ...validProject, namespace: null })],
      [json(200, { ...validProject, visibility: "unknown" })],
      [json(200, validProject), json(500, {})],
      [json(200, validProject), json(200, {})],
      [json(200, validProject), json(200, [null])],
      [json(200, validProject), json(200, [{ ...validRelease, name: null }])],
      [json(200, { ...validProject, path: null }), json(200, [])],
      [json(200, validProject), json(200, [], { "x-next-page": "bad" })],
      [json(200, validProject), json(200, [], { "x-next-page": "1" })],
      [json(200, validProject), json(200, [], { "x-next-page": "101" })],
    ];
    for (const responses of cases) {
      await expect(
        setup(responses).provider.importRepository({
          encryptedGrantRef: "vault:gitlab:grant-1",
          repositoryId: "83836910",
        }),
      ).rejects.toThrow("SOURCE_PROVIDER_UNAVAILABLE");
    }
    await expect(
      setup([]).provider.importRepository({
        encryptedGrantRef: "vault:gitlab:grant-1",
        repositoryId: "invalid",
      }),
    ).rejects.toThrow("SOURCE_PROVIDER_UNAVAILABLE");

    const internal = setup([
      json(200, { ...validProject, visibility: "internal" }),
      json(200, []),
    ]);
    await expect(
      internal.provider.importRepository({
        encryptedGrantRef: "vault:gitlab:grant-1",
        repositoryId: "83836910",
      }),
    ).resolves.toMatchObject({ visibility: "internal" });
  });

  it("fails closed without sealing or deleting on malformed provider responses", async () => {
    const exchangeFailure = setup([json(401, { error: "invalid_grant" })]);
    await expect(
      exchangeFailure.provider.completeAuthorization({
        code: "code",
        redirectUri: "https://feedback.example/callback/gitlab",
      }),
    ).rejects.toThrow("SOURCE_PROVIDER_UNAVAILABLE");
    expect(exchangeFailure.seal).not.toHaveBeenCalled();

    const revokeFailure = setup([json(500, { token: "must-not-leak" })]);
    await expect(
      revokeFailure.provider.revokeGrant("vault:gitlab:grant-1"),
    ).rejects.toThrow("SOURCE_PROVIDER_UNAVAILABLE");
    expect(revokeFailure.remove).not.toHaveBeenCalled();

    const malformedCases = [
      [json(200, null)],
      [json(200, { token_type: "Bearer", access_token: 42 })],
      [json(200, { token_type: "Bearer", access_token: " " })],
      [
        json(200, {
          token_type: "Bearer",
          access_token: "token",
          expires_in: 0,
        }),
      ],
      [json(200, { token_type: "Bearer", access_token: "token" }), json(200, {})],
      [json(200, { token_type: "Bearer", access_token: "token" }), json(200, [null])],
      [json(200, { token_type: "Bearer", access_token: "token" }), json(500, {})],
      [
        json(200, { token_type: "Bearer", access_token: "token" }),
        json(200, [], { "x-next-page": "1" }),
      ],
    ] as const;
    for (const responses of malformedCases) {
      const malformed = setup(responses);
      await expect(
        malformed.provider.completeAuthorization({
          code: "code",
          redirectUri: "https://feedback.example/callback/gitlab",
        }),
      ).rejects.toThrow("SOURCE_PROVIDER_UNAVAILABLE");
      expect(malformed.seal).not.toHaveBeenCalled();
    }
  });

  it("supports a non-expiring token without refresh material", async () => {
    const { provider, seal } = setup([
      json(200, { token_type: "Bearer", access_token: "access-only" }),
      json(200, []),
    ]);
    await expect(
      provider.completeAuthorization({
        code: "code",
        redirectUri: "https://feedback.example/callback/gitlab",
      }),
    ).resolves.toEqual({
      encryptedGrantRef: "vault:gitlab:grant-1",
      authorizedRepositories: [],
    });
    expect(seal).toHaveBeenCalledWith("gitlab", { accessToken: "access-only" });
  });

  it("rejects insecure provider configuration", () => {
    const vault = setup([]);
    expect(() =>
      createGitLabSourceProvider(
        {
          origin: "http://gitlab.example",
          clientId: "application-id",
          clientSecret: "application-secret",
        },
        { seal: vault.seal, open: vault.open, remove: vault.remove },
        vault.fetcher,
        Date.now,
      ),
    ).toThrow("SOURCE_PROVIDER_CONFIG_INVALID");
    expect(() =>
      createGitLabSourceProvider(
        {
          origin: "https://gitlab.com",
          clientId: " ",
          clientSecret: "application-secret",
        },
        { seal: vault.seal, open: vault.open, remove: vault.remove },
        vault.fetcher,
        Date.now,
      ),
    ).toThrow("SOURCE_PROVIDER_CONFIG_INVALID");
    expect(() =>
      vault.provider.authorizationUrl({
        state: "state",
        redirectUri: "http://feedback.example/callback/gitlab",
      }),
    ).toThrow("SOURCE_PROVIDER_INPUT_INVALID");
  });
});
