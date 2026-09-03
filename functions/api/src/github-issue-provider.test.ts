import { describe, expect, it, vi } from "vitest";

import { createGitHubIssueProvider } from "./github-issue-provider";
import { ProviderIssueError } from "./provider-issue";
import type { ProviderGrantVault } from "./source-provider";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const input = {
  encryptedGrantRef: "grant_1",
  operationId: "operation_1",
  repository: { id: "123", owner: "Y4NN777", name: "feedback" },
  payload: {
    reference: "Y7-ABC123",
    protectedWorkspaceUrl: "https://feedback.example/workbench?feedbackId=feedback_1",
    feedbackType: "bug" as const,
    origin: "y7-feedback" as const,
  },
};

function response(status: number, body: unknown): Response {
  return { status, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

function vault(): ProviderGrantVault {
  return {
    seal: vi.fn(),
    open: vi.fn().mockResolvedValue({ accessToken: "token" }),
    remove: vi.fn(),
  };
}

describe("GitHub issue provider", () => {
  it("BDD-ISSUE-GITHUB-001 searches by operation marker then creates once", async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(response(200, { items: [] }))
      .mockResolvedValueOnce(
        response(201, {
          id: 42,
          number: 1,
          html_url: "https://github.com/Y4NN777/feedback/issues/1",
        }),
      );
    await expect(
      createGitHubIssueProvider(vault(), fetcher).createIssue(input),
    ).resolves.toEqual({
      issueId: "1",
      issueUrl: "https://github.com/Y4NN777/feedback/issues/1",
      replayed: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(fetcher.mock.calls[0]?.[0] ?? "").searchParams.get("q")).toBe(
      'repo:Y4NN777/feedback is:issue "<!-- y7-feedback-operation:operation_1 -->"',
    );
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("POST");
    const requestBody = fetcher.mock.calls[1]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") throw new Error("expected JSON body");
    expect(requestBody).toContain("y7-feedback-operation:operation_1");
  });

  it("BDD-ISSUE-GITHUB-002 replays the unique existing marker without POST", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response(200, {
        items: [
          {
            id: "42",
            html_url: "https://github.com/Y4NN777/feedback/issues/1",
            body: "<!-- y7-feedback-operation:operation_1 -->",
          },
        ],
      }),
    );
    await expect(
      createGitHubIssueProvider(vault(), fetcher).createIssue(input),
    ).resolves.toMatchObject({ replayed: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, "retryable"],
    [401, "permanent"],
  ] as const)("BDD-ISSUE-GITHUB-003 classifies search %i", async (status, failure) => {
    await expect(
      createGitHubIssueProvider(
        vault(),
        vi.fn().mockResolvedValue(response(status, {})),
      ).createIssue(input),
    ).rejects.toEqual(new ProviderIssueError(failure));
  });

  it.each([
    [503, "retryable"],
    [422, "permanent"],
  ] as const)("BDD-ISSUE-GITHUB-004 classifies create %i", async (status, failure) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(200, { items: [] }))
      .mockResolvedValueOnce(response(status, {}));
    await expect(
      createGitHubIssueProvider(vault(), fetcher).createIssue(input),
    ).rejects.toEqual(new ProviderIssueError(failure));
  });

  it.each([
    { items: {} },
    {
      items: [
        {
          id: 1,
          html_url: "https://github.com/Y4NN777/feedback/issues/1",
          body: "<!-- y7-feedback-operation:operation_1 -->",
        },
        {
          id: 2,
          html_url: "https://github.com/Y4NN777/feedback/issues/2",
          body: "<!-- y7-feedback-operation:operation_1 -->",
        },
      ],
    },
    {
      items: [
        {
          id: 1,
          body: "<!-- y7-feedback-operation:operation_1 -->",
          html_url: "http://bad",
        },
      ],
    },
  ])("BDD-ISSUE-GITHUB-005 rejects ambiguous or malformed replay %#", async (body) => {
    await expect(
      createGitHubIssueProvider(
        vault(),
        vi.fn().mockResolvedValue(response(200, body)),
      ).createIssue(input),
    ).rejects.toBeInstanceOf(ProviderIssueError);
  });

  it("BDD-ISSUE-GITHUB-006 maps timeout and malformed create response to retry", async () => {
    await expect(
      createGitHubIssueProvider(
        vault(),
        vi.fn().mockRejectedValue(new Error("timeout")),
      ).createIssue(input),
    ).rejects.toEqual(new ProviderIssueError("retryable"));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(200, { items: [] }))
      .mockResolvedValueOnce(
        response(201, { id: 1, html_url: "https://example.com/issue" }),
      );
    await expect(
      createGitHubIssueProvider(vault(), fetcher).createIssue(input),
    ).rejects.toEqual(new ProviderIssueError("retryable"));
    const missing = vi
      .fn()
      .mockResolvedValueOnce(response(200, { items: [] }))
      .mockResolvedValueOnce(response(201, {}));
    await expect(
      createGitHubIssueProvider(vault(), missing).createIssue(input),
    ).rejects.toEqual(new ProviderIssueError("retryable"));
  });
});
