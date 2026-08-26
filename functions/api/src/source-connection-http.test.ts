import { describe, expect, it, vi } from "vitest";

import { createSourceConnectionHttp } from "./source-connection-http";

function fixture() {
  const coordinator = {
    begin: vi.fn(() =>
      Promise.resolve({
        status: "ok" as const,
        authorizationUrl: "https://provider.example/authorize",
      }),
    ),
    complete: vi.fn(() =>
      Promise.resolve({
        status: "pending_selection" as const,
        connectionId: "connection_1",
        authorizedRepositories: [{ provider: "github" as const, id: "repo_1" }],
        returnPath: "/settings/sources",
      }),
    ),
    select: vi.fn(() =>
      Promise.resolve({
        status: "active" as const,
        connection: {
          id: "connection_1",
          provider: "github" as const,
          selectedRepositories: [{ provider: "github" as const, id: "repo_1" }],
        },
      }),
    ),
    disconnect: vi.fn(() => Promise.resolve({ status: "disconnected" as const })),
  };
  return {
    coordinator,
    http: createSourceConnectionHttp(coordinator, {
      github:
        "https://y7-feedback-api-preview.appwrite.network/providers/github/callback",
      gitlab:
        "https://y7-feedback-api-preview.appwrite.network/providers/gitlab/callback",
    }),
  };
}

describe("source connection HTTP boundary", () => {
  it("BDD-SRC-REAL-001 accepts only a bearer-authenticated begin command", async () => {
    const { http, coordinator } = fixture();

    await expect(
      http.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/source-connections/github/begin",
        headers: { authorization: "Bearer valid.jwt.value" },
        query: {},
        body: { returnPath: "/settings/sources" },
      }),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        status: "ok",
        authorizationUrl: "https://provider.example/authorize",
      },
    });
    expect(coordinator.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        jwt: "valid.jwt.value",
        provider: "github",
      }),
    );
  });

  it("BDD-SRC-REAL-002 maps a provider callback without reflecting code or state", async () => {
    const { http } = fixture();
    const response = await http.handle({
      method: "GET",
      path: "/providers/github/callback",
      headers: {},
      query: { state: "opaque.state", code: "provider-secret-code" },
      body: undefined,
    });

    expect(response).toEqual({
      statusCode: 200,
      body: {
        status: "pending_selection",
        connectionId: "connection_1",
        authorizedRepositories: [{ provider: "github", id: "repo_1" }],
        returnPath: "/settings/sources",
      },
    });
    expect(JSON.stringify(response)).not.toContain("provider-secret-code");
    expect(JSON.stringify(response)).not.toContain("opaque.state");
  });

  it("BDD-SRC-REAL-003 validates selection input at the boundary", async () => {
    const { http } = fixture();
    await expect(
      http.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/source-connections/connection_1/select",
        headers: { authorization: "Bearer valid.jwt.value" },
        query: {},
        body: { repositoryIds: ["repo_1"] },
      }),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        status: "active",
        connection: {
          id: "connection_1",
          provider: "github",
          selectedRepositories: [{ provider: "github", id: "repo_1" }],
        },
      },
    });
  });

  it("BDD-SRC-REAL-004 exposes a stable disconnected result", async () => {
    const { http } = fixture();
    await expect(
      http.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/source-connections/connection_1/disconnect",
        headers: { authorization: "Bearer valid.jwt.value" },
        query: {},
        body: {},
      }),
    ).resolves.toEqual({
      statusCode: 200,
      body: { status: "disconnected" },
    });
  });

  it("BDD-SRC-REAL-005 returns indistinguishable denial for malformed authority", async () => {
    const { http, coordinator } = fixture();
    coordinator.begin.mockResolvedValueOnce({ status: "denied" } as never);

    await expect(
      http.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/source-connections/github/begin",
        headers: {},
        query: {},
        body: { returnPath: "/settings/sources" },
      }),
    ).resolves.toEqual({
      statusCode: 404,
      body: { error: "ERR-SOURCE-DENIED" },
    });
    coordinator.begin.mockResolvedValueOnce({ status: "denied" } as never);
    await expect(
      http.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/source-connections/github/begin",
        headers: { authorization: "Bearer valid.jwt.value" },
        query: {},
        body: { returnPath: "/settings/sources" },
      }),
    ).resolves.toEqual({
      statusCode: 404,
      body: { error: "ERR-SOURCE-DENIED" },
    });
  });

  it("BDD-SRC-REAL-005 fails closed for malformed transport shapes", async () => {
    const { http, coordinator } = fixture();
    const denied = { statusCode: 404, body: { error: "ERR-SOURCE-DENIED" } };
    await expect(
      http.handle({
        method: "GET",
        path: "/providers/github/callback",
        headers: {},
        query: {},
        body: undefined,
      }),
    ).resolves.toEqual(denied);
    await expect(
      http.handle({
        method: "GET",
        path: "/unrelated",
        headers: {},
        query: {},
        body: {},
      }),
    ).resolves.toBeNull();
    await expect(
      http.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/source-connections/github/begin",
        headers: { authorization: "Bearer valid.jwt.value" },
        query: {},
        body: null,
      }),
    ).resolves.toEqual(denied);
    for (const [path, body] of [
      [
        "/v1/workspaces/workspace_1/projects/project_1/source-connections/github/begin",
        {},
      ],
      [
        "/v1/workspaces/workspace_1/projects/project_1/source-connections/not-an-action",
        {},
      ],
      [
        "/v1/workspaces/workspace_1/projects/project_1/source-connections/connection_1/select",
        { repositoryIds: [1] },
      ],
    ] as const) {
      await expect(
        http.handle({
          method: "POST",
          path,
          headers: { authorization: "Bearer valid.jwt.value" },
          query: {},
          body,
        }),
      ).resolves.toEqual(denied);
    }
    coordinator.complete.mockResolvedValueOnce({ status: "retryable" } as never);
    await expect(
      http.handle({
        method: "GET",
        path: "/providers/gitlab/callback",
        headers: {},
        query: { state: "opaque.state", code: "one-use-code" },
        body: undefined,
      }),
    ).resolves.toEqual({ statusCode: 503, body: { error: "ERR-SOURCE-UNAVAILABLE" } });
  });

  it("BDD-SRC-REAL-005 rejects unsafe callback configuration", () => {
    const { coordinator } = fixture();
    for (const github of [
      "not-a-url",
      "http://example.test/providers/github/callback",
      "https://user@example.test/providers/github/callback",
      "https://example.test/providers/github/callback?query=1",
      "https://example.test/providers/github/callback#fragment",
      "https://example.test/wrong",
    ]) {
      expect(() =>
        createSourceConnectionHttp(coordinator, {
          github,
          gitlab: "https://example.test/providers/gitlab/callback",
        }),
      ).toThrow(new Error("SOURCE_HTTP_CONFIG_INVALID"));
    }
  });
});
