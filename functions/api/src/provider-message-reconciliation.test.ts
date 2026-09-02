import { expect, it, vi } from "vitest";
import { createProviderMessageReconciliation } from "./provider-message-reconciliation";

const observation = {
  provider: "gitlab" as const,
  deliveryId: "delivery_1",
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  repositoryId: "repo_1",
  issueId: "41",
  commentId: "91",
  authorId: "7",
  authorLogin: "maintainer",
  mutation: "created" as const,
  content: "Original",
  providerUpdatedAt: "2026-09-02T04:00:00.000Z",
};
function target(
  inspected: unknown,
  authority: "authorized" | "denied" | "retryable" = "authorized",
) {
  const context = {
    ...observation,
    linkId: "link_1",
    feedbackId: "feedback_1",
    encryptedGrantRef: "grant_1",
    repositoryOwner: "owner",
    repositoryName: "repo",
  };
  const facts = { apply: vi.fn().mockResolvedValue("applied") };
  const gitlab = {
    provider: "gitlab" as const,
    inspect: vi.fn().mockResolvedValue(inspected),
    publish: vi.fn(),
    remove: vi.fn(),
  };
  const github = { ...gitlab, provider: "github" as const, inspect: vi.fn() };
  return {
    facts,
    worker: createProviderMessageReconciliation({
      reader: { list: () => Promise.resolve([{ observation }]) },
      contexts: { resolve: () => Promise.resolve({ status: "resolved", context }) },
      authors: { verify: () => Promise.resolve(authority) },
      facts,
      providers: [github, gitlab],
      now: () => "2026-09-02T05:00:00.000Z",
    }),
  };
}
it("BDD-SYNC-RECON-001 appends a tombstone when GitLab no longer returns a comment", async () => {
  const x = target({ status: "missing" });
  await expect(x.worker.runOnce()).resolves.toMatchObject({ tombstoned: 1 });
  expect(x.facts.apply).toHaveBeenCalledWith(
    expect.objectContaining({ mutation: "tombstoned", content: undefined }),
  );
});
it("BDD-SYNC-RECON-002 imports a missed edit only after fresh author verification", async () => {
  const x = target({
    status: "found",
    content: "Edited",
    authorId: "7",
    authorLogin: "maintainer",
    updatedAt: "2026-09-02T04:30:00.000Z",
  });
  await expect(x.worker.runOnce()).resolves.toMatchObject({ revised: 1 });
  expect(x.facts.apply).toHaveBeenCalledWith(
    expect.objectContaining({ mutation: "revised", content: "Edited" }),
  );
});
it("BDD-SYNC-RECON-003 ignores outsider edits and preserves prior visible history", async () => {
  const x = target(
    {
      status: "found",
      content: "Outsider edit",
      authorId: "9",
      authorLogin: "outsider",
      updatedAt: "2026-09-02T04:30:00.000Z",
    },
    "denied",
  );
  await expect(x.worker.runOnce()).resolves.toMatchObject({ denied: 1 });
  expect(x.facts.apply).not.toHaveBeenCalled();
});

it("covers unchanged, ignored and retryable reconciliation outcomes", async () => {
  const unchanged = target({
    status: "found",
    content: "Original",
    authorId: "7",
    authorLogin: "maintainer",
    updatedAt: observation.providerUpdatedAt,
  });
  await expect(unchanged.worker.runOnce()).resolves.toMatchObject({ unchanged: 1 });
  expect(unchanged.facts.apply).not.toHaveBeenCalled();

  const tombstoneReplay = target({ status: "missing" });
  tombstoneReplay.facts.apply.mockResolvedValue("ignored");
  await expect(tombstoneReplay.worker.runOnce()).resolves.toMatchObject({
    tombstoned: 0,
    unchanged: 1,
  });

  const revisionReplay = target({
    status: "found",
    content: "Edited",
    authorId: "7",
    authorLogin: "maintainer",
    updatedAt: "2026-09-02T04:30:00.000Z",
  });
  revisionReplay.facts.apply.mockResolvedValue("ignored");
  await expect(revisionReplay.worker.runOnce()).resolves.toMatchObject({
    revised: 0,
    unchanged: 1,
  });

  const retryAuthority = target(
    {
      status: "found",
      content: "Edited",
      authorId: "7",
      authorLogin: "maintainer",
      updatedAt: "2026-09-02T04:30:00.000Z",
    },
    "retryable",
  );
  await expect(retryAuthority.worker.runOnce()).rejects.toThrow(
    "PROVIDER_MESSAGE_RECONCILIATION_RETRYABLE",
  );
});

it("fails closed for unresolved authority, unknown providers and invalid composition", async () => {
  const context = {
    ...observation,
    linkId: "link_1",
    feedbackId: "feedback_1",
    encryptedGrantRef: "grant_1",
    repositoryOwner: "owner",
    repositoryName: "repo",
  };
  const adapter = {
    provider: "gitlab" as const,
    inspect: vi.fn().mockResolvedValue({ status: "missing" }),
    publish: vi.fn(),
    remove: vi.fn(),
  };
  const make = (resolve: () => Promise<unknown>, observed = observation) =>
    createProviderMessageReconciliation({
      reader: { list: () => Promise.resolve([{ observation: observed }]) },
      contexts: { resolve } as never,
      authors: { verify: vi.fn() },
      facts: { apply: vi.fn() },
      providers: [{ ...adapter, provider: "github" }, adapter],
      now: () => "2026-09-02T05:00:00.000Z",
    });
  for (const status of ["ignored", "permanent"] as const) {
    await expect(
      make(() => Promise.resolve({ status })).runOnce(),
    ).resolves.toMatchObject({ unchanged: 1 });
  }
  await expect(
    make(() => Promise.resolve({ status: "retryable" })).runOnce(),
  ).rejects.toThrow("PROVIDER_MESSAGE_RECONCILIATION_RETRYABLE");
  await expect(
    make(() => Promise.resolve({ status: "resolved", context }), {
      ...observation,
      provider: "unknown" as never,
    }).runOnce(),
  ).rejects.toThrow("PROVIDER_MESSAGE_RECONCILIATION_CONFIG_INVALID");
  expect(() =>
    createProviderMessageReconciliation({
      reader: { list: vi.fn() },
      contexts: { resolve: vi.fn() },
      authors: { verify: vi.fn() },
      facts: { apply: vi.fn() },
      providers: [adapter],
      now: vi.fn(),
    }),
  ).toThrow("PROVIDER_MESSAGE_RECONCILIATION_CONFIG_INVALID");
});
