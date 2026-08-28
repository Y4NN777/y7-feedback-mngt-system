import { describe, expect, it, vi } from "vitest";

import { createGitLabIssueProvider } from "./gitlab-issue-provider";
import { ProviderIssueError } from "./provider-issue";
import type { ProviderGrantVault } from "./source-provider";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const input = {
  encryptedGrantRef: "grant_1",
  operationId: "operation_1",
  repository: { id: "83836910", owner: "group/subgroup", name: "feedback" },
  payload: {
    reference: "Y7-ABC123",
    protectedWorkspaceUrl: "https://feedback.example/workbench?feedbackId=feedback_1",
    feedbackType: "suggestion" as const,
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

describe("GitLab issue provider", () => {
  it("BDD-ISSUE-GITLAB-001 searches then creates a minimal issue", async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(response(200, []))
      .mockResolvedValueOnce(
        response(201, {
          id: 51,
          web_url: "https://gitlab.com/group/feedback/-/issues/1",
        }),
      );
    await expect(
      createGitLabIssueProvider("https://gitlab.com", vault(), fetcher).createIssue(
        input,
      ),
    ).resolves.toEqual({
      issueId: "51",
      issueUrl: "https://gitlab.com/group/feedback/-/issues/1",
      replayed: false,
    });
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("POST");
    const requestBody = fetcher.mock.calls[1]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") throw new Error("expected JSON body");
    expect(requestBody).toContain("y7-feedback-operation:operation_1");
  });

  it("BDD-ISSUE-GITLAB-002 replays a unique existing issue", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response(200, [
        {
          id: "51",
          web_url: "https://gitlab.com/group/feedback/-/issues/1",
          description: "<!-- y7-feedback-operation:operation_1 -->",
        },
      ]),
    );
    await expect(
      createGitLabIssueProvider("https://gitlab.com/", vault(), fetcher).createIssue(
        input,
      ),
    ).resolves.toMatchObject({ replayed: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, "retryable"],
    [403, "permanent"],
  ] as const)("BDD-ISSUE-GITLAB-003 classifies search %i", async (status, failure) => {
    await expect(
      createGitLabIssueProvider(
        "https://gitlab.com",
        vault(),
        vi.fn().mockResolvedValue(response(status, {})),
      ).createIssue(input),
    ).rejects.toEqual(new ProviderIssueError(failure));
  });

  it.each([
    [500, "retryable"],
    [400, "permanent"],
  ] as const)("BDD-ISSUE-GITLAB-004 classifies create %i", async (status, failure) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(200, []))
      .mockResolvedValueOnce(response(status, {}));
    await expect(
      createGitLabIssueProvider("https://gitlab.com", vault(), fetcher).createIssue(
        input,
      ),
    ).rejects.toEqual(new ProviderIssueError(failure));
  });

  it.each([
    {},
    [
      {
        id: 1,
        web_url: "https://gitlab.com/a",
        description: "<!-- y7-feedback-operation:operation_1 -->",
      },
      {
        id: 2,
        web_url: "https://gitlab.com/b",
        description: "<!-- y7-feedback-operation:operation_1 -->",
      },
    ],
    [
      {
        id: 1,
        web_url: "http://bad",
        description: "<!-- y7-feedback-operation:operation_1 -->",
      },
    ],
  ])("BDD-ISSUE-GITLAB-005 rejects malformed or ambiguous replay %#", async (body) => {
    await expect(
      createGitLabIssueProvider(
        "https://gitlab.com",
        vault(),
        vi.fn().mockResolvedValue(response(200, body)),
      ).createIssue(input),
    ).rejects.toBeInstanceOf(ProviderIssueError);
  });

  it("BDD-ISSUE-GITLAB-006 rejects unsafe config and retries timeout/malformed create", async () => {
    expect(() => createGitLabIssueProvider("http://gitlab.test", vault())).toThrow(
      "SOURCE_PROVIDER_CONFIG_INVALID",
    );
    expect(() => createGitLabIssueProvider("https://user@gitlab.com", vault())).toThrow(
      "SOURCE_PROVIDER_CONFIG_INVALID",
    );
    await expect(
      createGitLabIssueProvider(
        "https://gitlab.com",
        vault(),
        vi.fn().mockRejectedValue(new Error("timeout")),
      ).createIssue(input),
    ).rejects.toEqual(new ProviderIssueError("retryable"));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(200, []))
      .mockResolvedValueOnce(response(201, { id: 1, web_url: "not-a-url" }));
    await expect(
      createGitLabIssueProvider("https://gitlab.com", vault(), fetcher).createIssue(
        input,
      ),
    ).rejects.toEqual(new ProviderIssueError("retryable"));
    const missing = vi
      .fn()
      .mockResolvedValueOnce(response(200, []))
      .mockResolvedValueOnce(response(201, {}));
    await expect(
      createGitLabIssueProvider("https://gitlab.com", vault(), missing).createIssue(
        input,
      ),
    ).rejects.toEqual(new ProviderIssueError("retryable"));
  });
});
