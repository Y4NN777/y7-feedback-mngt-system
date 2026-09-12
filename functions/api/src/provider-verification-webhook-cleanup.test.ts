import { describe, expect, it, vi } from "vitest";

import { removeProviderVerificationWebhooks } from "./provider-verification-webhook-cleanup.js";

describe("provider verification webhook cleanup", () => {
  it.each([
    {
      provider: "github" as const,
      repository: { id: "1", owner: "owner", name: "repo" },
      hook: { id: 12, config: { url: "https://preview.test/hooks/connection" } },
      expectedDelete: "https://api.github.com/repos/owner/repo/hooks/12",
    },
    {
      provider: "gitlab" as const,
      repository: { id: "42", owner: "owner", name: "repo" },
      hook: { id: "13", url: "https://preview.test/hooks/connection" },
      expectedDelete: "https://gitlab.test/api/v4/projects/42/hooks/13",
    },
  ])("removes only the exact $provider verification callback", async (scenario) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            scenario.hook,
            {
              id: 99,
              url: "https://other.test/hook",
              config: { url: "https://other.test/hook" },
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      removeProviderVerificationWebhooks({
        provider: scenario.provider,
        token: "verification-token",
        repository: scenario.repository,
        callbackUrl: "https://preview.test/hooks/connection",
        gitlabOrigin: "https://gitlab.test/",
        fetcher,
      }),
    ).resolves.toBe(1);
    expect(fetcher).toHaveBeenLastCalledWith(
      scenario.expectedDelete,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails cleanup when the provider rejects hook discovery", async () => {
    await expect(
      removeProviderVerificationWebhooks({
        provider: "github",
        token: "verification-token",
        repository: { id: "1", owner: "owner", name: "repo" },
        callbackUrl: "https://preview.test/hooks/connection",
        gitlabOrigin: "https://gitlab.test/",
        fetcher: vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
      }),
    ).rejects.toThrow("PROVIDER_VERIFICATION_WEBHOOK_CLEANUP_FAILED");
  });

  it("rejects a malformed provider hook collection", async () => {
    await expect(
      removeProviderVerificationWebhooks({
        provider: "github",
        token: "verification-token",
        repository: { id: "1", owner: "owner", name: "repo" },
        callbackUrl: "https://preview.test/hooks/connection",
        gitlabOrigin: "https://gitlab.test/",
        fetcher: vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ hooks: [] }), { status: 200 }),
          ),
      }),
    ).rejects.toThrow("PROVIDER_VERIFICATION_WEBHOOK_CLEANUP_FAILED");
  });

  it("ignores malformed and unrelated hooks", async () => {
    await expect(
      removeProviderVerificationWebhooks({
        provider: "github",
        token: "verification-token",
        repository: { id: "1", owner: "owner", name: "repo" },
        callbackUrl: "https://preview.test/hooks/connection",
        gitlabOrigin: "https://gitlab.test/",
        fetcher: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify([
              null,
              [],
              { id: 0, config: { url: "https://preview.test/hooks/connection" } },
              {
                id: Number.MAX_SAFE_INTEGER + 1,
                config: { url: "https://preview.test/hooks/connection" },
              },
              { id: "0", config: { url: "https://preview.test/hooks/connection" } },
              { id: "12", config: { url: "https://other.test/hook" } },
              { id: 14 },
            ]),
            { status: 200 },
          ),
        ),
      }),
    ).resolves.toBe(0);
  });

  it("uses the platform fetcher when no test adapter is supplied", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(
        removeProviderVerificationWebhooks({
          provider: "gitlab",
          token: "verification-token",
          repository: { id: "42", owner: "owner", name: "repo" },
          callbackUrl: "https://preview.test/hooks/connection",
          gitlabOrigin: "https://gitlab.test/",
        }),
      ).resolves.toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
