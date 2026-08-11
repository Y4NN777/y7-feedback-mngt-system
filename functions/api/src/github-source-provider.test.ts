import { describe, expect, it, vi } from "vitest";

import type { ProviderGrantVault } from "./source-provider";
import { createGitHubSourceProvider } from "./github-source-provider";

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
    Promise.resolve("vault:github:grant-1"),
  );
  const open = vi.fn<ProviderGrantVault["open"]>(() =>
    Promise.resolve({
      accessToken: "secret-user-token",
      refreshToken: "secret-refresh-token",
      expiresAt: "2026-08-10T22:00:00.000Z",
    }),
  );
  const remove = vi.fn<ProviderGrantVault["remove"]>(() => Promise.resolve());
  const vault: ProviderGrantVault = { seal, open, remove };
  return {
    fetcher,
    open,
    provider: createGitHubSourceProvider(
      {
        clientId: "github-client-id",
        clientSecret: "github-client-secret",
      },
      vault,
      fetcher,
      () => Date.parse("2026-08-10T14:00:00.000Z"),
    ),
    remove,
    seal,
  };
}

describe("GitHub App user authorization source adapter", () => {
  it("BDD-SRC-GITHUB-001 creates a bounded GitHub App authorization URL", () => {
    expect(
      setup([]).provider.authorizationUrl({
        state: "opaque-state",
        redirectUri: "https://feedback.example/callback/github",
      }),
    ).toBe(
      "https://github.com/login/oauth/authorize?client_id=github-client-id&redirect_uri=https%3A%2F%2Ffeedback.example%2Fcallback%2Fgithub&state=opaque-state",
    );
  });

  it("BDD-SRC-GITHUB-002 exchanges and lists repositories across installations", async () => {
    const { provider, fetcher, seal } = setup([
      json(200, {
        access_token: "secret-user-token",
        token_type: "bearer",
        expires_in: 28_800,
        refresh_token: "secret-refresh-token",
      }),
      json(200, { installations: [{ id: 10 }] }, { link: '<next>; rel="next"' }),
      json(200, { installations: [{ id: 20 }] }),
      json(200, { repositories: [{ id: 101 }, { id: 102 }] }),
      json(200, { repositories: [{ id: 201 }] }),
    ]);

    await expect(
      provider.completeAuthorization({
        code: "one-use-code",
        redirectUri: "https://feedback.example/callback/github",
      }),
    ).resolves.toEqual({
      encryptedGrantRef: "vault:github:grant-1",
      authorizedRepositories: [
        { provider: "github", id: "101" },
        { provider: "github", id: "102" },
        { provider: "github", id: "201" },
      ],
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({
        method: "POST",
        body: new URLSearchParams({
          client_id: "github-client-id",
          client_secret: "github-client-secret",
          code: "one-use-code",
          redirect_uri: "https://feedback.example/callback/github",
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/user/installations?per_page=100&page=1",
      expect.objectContaining({
        headers: {
          accept: "application/vnd.github+json",
          authorization: "Bearer secret-user-token",
          "x-github-api-version": "2026-03-10",
        },
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/user/installations?per_page=100&page=2",
      expect.any(Object),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      "https://api.github.com/user/installations/10/repositories?per_page=100&page=1",
      expect.any(Object),
    );
    expect(seal).toHaveBeenCalledWith("github", {
      accessToken: "secret-user-token",
      refreshToken: "secret-refresh-token",
      expiresAt: "2026-08-10T22:00:00.000Z",
    });
  });

  it("BDD-SRC-GITHUB-003 revokes the app grant before removing vault material", async () => {
    const { provider, fetcher, open, remove } = setup([
      new Response(null, { status: 204 }),
    ]);

    await provider.revokeGrant("vault:github:grant-1");

    expect(open).toHaveBeenCalledWith("github", "vault:github:grant-1");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/applications/github-client-id/grant",
      {
        method: "DELETE",
        cache: "no-store",
        credentials: "omit",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Basic ${Buffer.from("github-client-id:github-client-secret").toString("base64")}`,
          "content-type": "application/json",
          "x-github-api-version": "2026-03-10",
        },
        body: JSON.stringify({ access_token: "secret-user-token" }),
      },
    );
    expect(remove).toHaveBeenCalledWith("github", "vault:github:grant-1");
  });

  it("fails closed without persisting or removing after provider failure", async () => {
    const exchangeFailure = setup([json(401, { error: "bad_verification_code" })]);
    await expect(
      exchangeFailure.provider.completeAuthorization({
        code: "code",
        redirectUri: "https://feedback.example/callback/github",
      }),
    ).rejects.toThrow("SOURCE_PROVIDER_UNAVAILABLE");
    expect(exchangeFailure.seal).not.toHaveBeenCalled();

    const revokeFailure = setup([json(500, { token: "must-not-leak" })]);
    await expect(
      revokeFailure.provider.revokeGrant("vault:github:grant-1"),
    ).rejects.toThrow("SOURCE_PROVIDER_UNAVAILABLE");
    expect(revokeFailure.remove).not.toHaveBeenCalled();

    const malformedCases = [
      [json(200, null)],
      [json(200, { token_type: "bearer", access_token: 42 })],
      [
        json(200, {
          token_type: "bearer",
          access_token: "token",
          expires_in: 0,
        }),
      ],
      [json(200, { token_type: "bearer", access_token: "token" }), json(200, {})],
      [
        json(200, { token_type: "bearer", access_token: "token" }),
        json(200, { installations: [null] }),
      ],
      [json(200, { token_type: "bearer", access_token: "token" }), json(500, {})],
    ] as const;
    for (const responses of malformedCases) {
      const malformed = setup(responses);
      await expect(
        malformed.provider.completeAuthorization({
          code: "code",
          redirectUri: "https://feedback.example/callback/github",
        }),
      ).rejects.toThrow("SOURCE_PROVIDER_UNAVAILABLE");
      expect(malformed.seal).not.toHaveBeenCalled();
    }
  });

  it("supports a non-expiring grant and rejects pagination beyond its bound", async () => {
    const accessOnly = setup([
      json(200, { token_type: "Bearer", access_token: "access-only" }),
      json(200, { installations: [] }),
    ]);
    await expect(
      accessOnly.provider.completeAuthorization({
        code: "code",
        redirectUri: "https://feedback.example/callback/github",
      }),
    ).resolves.toEqual({
      encryptedGrantRef: "vault:github:grant-1",
      authorizedRepositories: [],
    });
    expect(accessOnly.seal).toHaveBeenCalledWith("github", {
      accessToken: "access-only",
    });

    const queue = [
      json(200, { token_type: "bearer", access_token: "token" }),
      json(200, { installations: [] }, { link: '<next>; rel="next"' }),
    ];
    const bounded = createGitHubSourceProvider(
      { clientId: "client", clientSecret: "secret" },
      { seal: vi.fn(), open: vi.fn(), remove: vi.fn() },
      () => Promise.resolve(queue.shift() ?? json(500, {})),
      Date.now,
      1,
    );
    await expect(
      bounded.completeAuthorization({
        code: "code",
        redirectUri: "https://feedback.example/callback/github",
      }),
    ).rejects.toThrow("SOURCE_PROVIDER_UNAVAILABLE");
  });

  it("rejects invalid callback and provider configuration", () => {
    const { provider } = setup([]);
    expect(() =>
      provider.authorizationUrl({
        state: "state",
        redirectUri: "http://feedback.example/callback/github",
      }),
    ).toThrow("SOURCE_PROVIDER_INPUT_INVALID");
    expect(() =>
      createGitHubSourceProvider(
        { clientId: " ", clientSecret: "secret" },
        { seal: vi.fn(), open: vi.fn(), remove: vi.fn() },
        vi.fn(),
        Date.now,
      ),
    ).toThrow("SOURCE_PROVIDER_CONFIG_INVALID");
  });
});
