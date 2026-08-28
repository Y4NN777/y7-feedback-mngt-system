import { describe, expect, it, vi } from "vitest";

import { createHttpExternalIssueGateway } from "./ExternalIssueGateway";

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function response(status: number, body: unknown): Response {
  return { status, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

describe("HTTP external issue gateway", () => {
  it("BDD-ISSUE-WEB-001 lists only active selected repositories with imported metadata", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      response(200, {
        status: "ok",
        connections: [
          {
            id: "connection_1",
            provider: "github",
            state: "active",
            selectedRepositories: [{ provider: "github", id: "123" }],
            importedRepositories: [
              {
                provider: "github",
                repositoryId: "123",
                owner: "Y4NN777",
                name: "feedback",
                visibility: "private",
              },
            ],
          },
          {
            id: "connection_2",
            provider: "gitlab",
            state: "disconnected",
            selectedRepositories: [],
            importedRepositories: [],
          },
        ],
      }),
    );
    await expect(
      createHttpExternalIssueGateway(
        "https://api.example/",
        () => Promise.resolve("jwt"),
        fetcher,
      ).repositories({ workspaceId: "workspace 1", projectId: "project/1" }),
    ).resolves.toEqual({
      status: "ok",
      result: [
        {
          connectionId: "connection_1",
          provider: "github",
          repositoryId: "123",
          owner: "Y4NN777",
          name: "feedback",
          visibility: "private",
        },
      ],
    });
    expect(fetcher.mock.calls[0]?.[0]).toContain("workspace%201");
    expect(fetcher.mock.calls[0]?.[0]).toContain("project%2F1");
  });

  it("BDD-ISSUE-WEB-002 submits the minimal link command and parses replay", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      response(200, {
        status: "replayed",
        result: {
          status: "replayed",
          linkId: "link_1",
          synchronizationState: "synchronized",
        },
      }),
    );
    await expect(
      createHttpExternalIssueGateway(
        "https://api.example/",
        () => Promise.resolve("jwt"),
        fetcher,
      ).link({
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        operationId: "operation_1",
        connectionId: "connection_1",
        repositoryId: "123",
      }),
    ).resolves.toMatchObject({ status: "ok", result: { status: "replayed" } });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        operationId: "operation_1",
        connectionId: "connection_1",
        repositoryId: "123",
      }),
    );
  });

  it.each([
    [404, "denied"],
    [409, "conflict"],
    [503, "retryable"],
  ] as const)("BDD-ISSUE-WEB-003 maps HTTP %i", async (code, status) => {
    await expect(
      createHttpExternalIssueGateway(
        "https://api.example/",
        () => Promise.resolve("jwt"),
        vi.fn<Fetcher>().mockResolvedValue(response(code, {})),
      ).link({
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        operationId: "operation_1",
        connectionId: "connection_1",
        repositoryId: "123",
        consentVersion: 2,
      }),
    ).resolves.toEqual({ status });
  });

  it.each([
    {},
    { status: "ok", connections: [null] },
    {
      status: "ok",
      connections: [
        {
          id: "connection_1",
          provider: "github",
          state: "active",
          selectedRepositories: [null],
          importedRepositories: [],
        },
      ],
    },
  ])(
    "BDD-ISSUE-WEB-004 fails closed for malformed repository response %#",
    async (body) => {
      const result = await createHttpExternalIssueGateway(
        "https://api.example/",
        () => Promise.resolve("jwt"),
        vi.fn<Fetcher>().mockResolvedValue(response(200, body)),
      ).repositories({ workspaceId: "workspace_1", projectId: "project_1" });
      expect(result.status).toBe("retryable");
    },
  );

  it("BDD-ISSUE-WEB-005 maps malformed link response and network failure", async () => {
    const malformed = createHttpExternalIssueGateway(
      "https://api.example/",
      () => Promise.resolve("jwt"),
      vi
        .fn<Fetcher>()
        .mockResolvedValue(response(201, { status: "accepted", result: {} })),
    );
    await expect(
      malformed.link({
        workspaceId: "w",
        projectId: "p",
        feedbackId: "f",
        operationId: "o",
        connectionId: "c",
        repositoryId: "r",
      }),
    ).resolves.toEqual({ status: "retryable" });
    const unavailable = createHttpExternalIssueGateway("https://api.example/", () =>
      Promise.reject(new Error("session unavailable")),
    );
    await expect(
      unavailable.repositories({ workspaceId: "w", projectId: "p" }),
    ).resolves.toEqual({ status: "retryable" });
  });
});
