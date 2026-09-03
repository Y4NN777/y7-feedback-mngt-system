import { describe, expect, it, vi } from "vitest";

import { createProviderMessageAuthorVerifier } from "./provider-message-authority";
import type { ProviderMessageContext } from "./provider-message-event";
import type { ProviderGrantVault } from "./source-provider";

const context: ProviderMessageContext = {
  provider: "github",
  deliveryId: "delivery_1",
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  repositoryId: "123",
  issueId: "41",
  commentId: "91",
  authorId: "7",
  authorLogin: "external-maintainer",
  mutation: "created",
  content: "Visible reply",
  providerUpdatedAt: "2026-09-02T01:00:00.000Z",
  linkId: "link_1",
  feedbackId: "feedback_1",
  encryptedGrantRef: "grant_1",
  repositoryOwner: "owner",
  repositoryName: "repo",
};

const vault: ProviderGrantVault = {
  seal: vi.fn(),
  open: vi.fn().mockResolvedValue({ accessToken: "secret-token" }),
  remove: vi.fn(),
};

describe.each([
  ["admin", { permission: "admin" }, "authorized"],
  ["maintain", { permission: "maintain" }, "authorized"],
  ["write", { permission: "write" }, "authorized"],
  ["triage", { permission: "triage" }, "denied"],
  ["read", { permission: "read" }, "denied"],
] as const)("GitHub author authority: %s", (_label, body, expected) => {
  it(`BDD-SYNC-AUTH-001 returns ${expected}`, async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(
      createProviderMessageAuthorVerifier("https://gitlab.com", vault, fetcher).verify(
        context,
      ),
    ).resolves.toBe(expected);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/collaborators/external-maintainer/permission",
      expect.objectContaining({ method: "GET", credentials: "omit" }),
    );
  });
});

describe.each([
  [40, "authorized"],
  [30, "authorized"],
  [20, "denied"],
] as const)("GitLab author authority level %i", (accessLevel, expected) => {
  it(`BDD-SYNC-AUTH-002 returns ${expected}`, async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_level: accessLevel }), { status: 200 }),
      );
    await expect(
      createProviderMessageAuthorVerifier("https://gitlab.com", vault, fetcher).verify({
        ...context,
        provider: "gitlab",
      }),
    ).resolves.toBe(expected);
    expect(fetcher).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/projects/123/members/all/7",
      expect.objectContaining({ method: "GET", credentials: "omit" }),
    );
  });
});

it.each([401, 403, 408, 429, 500])(
  "BDD-SYNC-AUTH-003 fails closed and retries transient/unverifiable status %i",
  async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
    await expect(
      createProviderMessageAuthorVerifier("https://gitlab.com", vault, fetcher).verify(
        context,
      ),
    ).resolves.toBe("retryable");
  },
);

it("BDD-SYNC-AUTH-004 treats a confirmed missing collaborator as denied", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
  await expect(
    createProviderMessageAuthorVerifier("https://gitlab.com", vault, fetcher).verify(
      context,
    ),
  ).resolves.toBe("denied");
});

it("BDD-SYNC-AUTH-005 never exposes a grant failure as authorization", async () => {
  const failing = { ...vault, open: vi.fn().mockRejectedValue(new Error("secret")) };
  await expect(
    createProviderMessageAuthorVerifier("https://gitlab.com", failing).verify(context),
  ).resolves.toBe("retryable");
});

it("covers alternate permission shapes, malformed bodies and permanent HTTP denials", async () => {
  for (const body of [
    { user: { permissions: { admin: true } } },
    { user: { permissions: { maintain: true } } },
    { user: { permissions: { push: true } } },
  ]) {
    await expect(
      createProviderMessageAuthorVerifier(
        "https://gitlab.com",
        vault,
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
      ).verify(context),
    ).resolves.toBe("authorized");
  }
  for (const body of [null, [], { user: null }, { permission: "read" }]) {
    await expect(
      createProviderMessageAuthorVerifier(
        "https://gitlab.com",
        vault,
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
      ).verify(context),
    ).resolves.toMatch(/denied|retryable/u);
  }
  for (const status of [400, 418]) {
    await expect(
      createProviderMessageAuthorVerifier(
        "https://gitlab.com",
        vault,
        vi.fn().mockResolvedValue(new Response(null, { status })),
      ).verify(context),
    ).resolves.toBe("denied");
  }
  for (const access_level of [30.5, "30", null]) {
    await expect(
      createProviderMessageAuthorVerifier(
        "https://gitlab.com",
        vault,
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ access_level }), { status: 200 }),
          ),
      ).verify({ ...context, provider: "gitlab" }),
    ).resolves.toBe("denied");
  }
});

it("rejects credential-bearing or non-HTTPS GitLab origins", () => {
  for (const origin of [
    "http://gitlab.example",
    "https://user@gitlab.example",
    "https://gitlab.example?token=x",
    "https://gitlab.example#fragment",
  ]) {
    expect(() => createProviderMessageAuthorVerifier(origin, vault)).toThrow(
      "PROVIDER_MESSAGE_AUTHORITY_CONFIG_INVALID",
    );
  }
});

it.each([
  [404, "denied"],
  [409, "retryable"],
  [425, "retryable"],
  [400, "denied"],
] as const)("classifies GitLab HTTP status %i as %s", async (status, expected) => {
  await expect(
    createProviderMessageAuthorVerifier(
      "https://gitlab.com",
      vault,
      vi.fn().mockResolvedValue(new Response(null, { status })),
    ).verify({ ...context, provider: "gitlab" }),
  ).resolves.toBe(expected);
});
