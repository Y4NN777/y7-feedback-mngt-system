import { describe, expect, it, vi } from "vitest";

import { createGitHubMessageProvider } from "./github-message-provider";
import { createGitLabMessageProvider } from "./gitlab-message-provider";
import {
  messageDocument,
  messageMarker,
  providerMessageFailure,
  providerMessageInstant,
  type ProviderMessageAdapter,
} from "./provider-message";
import type { ProviderGrantVault } from "./source-provider";

const vault: ProviderGrantVault = {
  seal: vi.fn(),
  open: vi.fn().mockResolvedValue({ accessToken: "secret" }),
  remove: vi.fn(),
};
const input = {
  encryptedGrantRef: "grant_1",
  operationId: "message_1",
  repository: { id: "123", owner: "owner", name: "repo" },
  issueId: "41",
  content: "Visible answer",
};

function contract(
  label: string,
  create: (
    fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  ) => ProviderMessageAdapter,
  responseBody: Readonly<Record<string, unknown>>,
) {
  describe(label, () => {
    it("BDD-SYNC-OUT-001 publishes an allow-listed marked comment", async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response("[]", { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(responseBody), { status: 201 }),
        );
      await expect(create(fetcher).publish(input)).resolves.toEqual({
        commentId: "91",
        replayed: false,
      });
      const request = fetcher.mock.calls[1]?.[1] as RequestInit;
      expect(typeof request.body).toBe("string");
      const serialized = typeof request.body === "string" ? request.body : "";
      expect(serialized).toContain("Visible answer");
      expect(serialized).toContain("y7-feedback-operation:message_1");
      expect(serialized).not.toMatch(/proof|contact|attachment|internal.note/i);
    });

    it("BDD-SYNC-OUT-002 replays by marker without creating a duplicate", async () => {
      const list = [
        {
          ...responseBody,
          body: "Visible answer\n<!-- y7-feedback-operation:message_1 -->",
        },
      ];
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(list), { status: 200 }));
      await expect(create(fetcher).publish(input)).resolves.toEqual({
        commentId: "91",
        replayed: true,
      });
      expect(fetcher).toHaveBeenCalledOnce();
    });

    it("BDD-SYNC-OUT-003 treats deletion and already-missing cleanup as successful", async () => {
      const deleted = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      await expect(
        create(deleted).remove({ ...input, commentId: "91" }),
      ).resolves.toEqual({ missing: false });
      const missing = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
      await expect(
        create(missing).remove({ ...input, commentId: "91" }),
      ).resolves.toEqual({ missing: true });
    });

    it("BDD-SYNC-OUT-004 classifies provider outage as retryable", async () => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
      await expect(create(fetcher).publish(input)).rejects.toMatchObject({
        failure: "retryable",
      });
    });

    it("BDD-SYNC-OUT-005 inspects provider truth and distinguishes deletion", async () => {
      const foundBody = label.startsWith("GitHub")
        ? {
            body: "Edited",
            updated_at: "2026-09-02T04:00:00Z",
            user: { id: 7, login: "maintainer" },
          }
        : {
            body: "Edited",
            updated_at: "2026-09-02T04:00:00Z",
            author: { id: 7, username: "maintainer" },
          };
      const found = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(foundBody), { status: 200 }));
      await expect(
        create(found).inspect({ ...input, commentId: "91" }),
      ).resolves.toMatchObject({
        status: "found",
        content: "Edited",
        updatedAt: "2026-09-02T04:00:00.000Z",
      });
      const missing = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
      await expect(
        create(missing).inspect({ ...input, commentId: "91" }),
      ).resolves.toEqual({ status: "missing" });
    });
  });
}

contract(
  "GitHub Message adapter",
  (fetcher) => createGitHubMessageProvider(vault, fetcher),
  { id: 91 },
);

it("validates message documents, timestamps and provider failure classes", () => {
  expect(messageMarker("message_1")).toContain("message_1");
  expect(providerMessageInstant("2026-09-02T04:00:00Z")).toBe(
    "2026-09-02T04:00:00.000Z",
  );
  for (const status of [408, 409, 425, 429, 500])
    expect(providerMessageFailure(status)).toBe("retryable");
  expect(providerMessageFailure(400)).toBe("permanent");
  for (const mutation of [
    { operationId: "bad/id" },
    { repository: { ...input.repository, id: "bad/id" } },
    { repository: { ...input.repository, owner: "" } },
    { repository: { ...input.repository, name: "" } },
    { issueId: "bad/id" },
    { content: "" },
    { content: "x".repeat(10_001) },
    { content: "control\u0000" },
  ]) {
    expect(() => messageDocument({ ...input, ...mutation })).toThrow(
      /PROVIDER_MESSAGE_PERMANENT/u,
    );
  }
  expect(() => providerMessageInstant("invalid")).toThrow(
    /PROVIDER_MESSAGE_RETRYABLE/u,
  );
});
contract(
  "GitLab Message adapter",
  (fetcher) => createGitLabMessageProvider("https://gitlab.com", vault, fetcher),
  { id: 91 },
);
