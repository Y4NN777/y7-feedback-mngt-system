import { describe, expect, it, vi } from "vitest";

import { createPrivacyProviderCleanup } from "./privacy-provider-cleanup";

const candidate = {
  linkId: "link_1",
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  provider: "github" as const,
  repositoryId: "1329343404",
  issueUrl: "https://github.com/Y4NN777/y7-feedback-mngt-system/issues/1",
};

describe("privacy provider cleanup", () => {
  it("BDD-PRIV-047 closes a published issue before marking cleanup complete", async () => {
    const order: string[] = [];
    const store = {
      listPending: vi.fn(() => Promise.resolve([candidate])),
      markCompleted: vi.fn(() => {
        order.push("mark");
        return Promise.resolve();
      }),
    };
    const closer = {
      close: vi.fn(() => {
        order.push("close");
        return Promise.resolve();
      }),
    };
    await expect(
      createPrivacyProviderCleanup(store, closer, {
        limit: 25,
        now: () => "2026-09-03T12:00:00.000Z",
      }).runOnce(),
    ).resolves.toEqual({ inspected: 1, completed: 1, failed: 0 });
    expect(order).toEqual(["close", "mark"]);
  });

  it("BDD-PRIV-048 leaves failed cleanup pending for a later retry", async () => {
    const store = {
      listPending: () => Promise.resolve([candidate]),
      markCompleted: vi.fn(() => Promise.resolve()),
    };
    const worker = createPrivacyProviderCleanup(
      store,
      { close: () => Promise.reject(new Error("provider unavailable")) },
      { limit: 25, now: () => "2026-09-03T12:00:00.000Z" },
    );
    await expect(worker.runOnce()).resolves.toEqual({
      inspected: 1,
      completed: 0,
      failed: 1,
    });
    expect(store.markCompleted).not.toHaveBeenCalled();
  });

  it("BDD-PRIV-049 fails invalid candidates closed and validates configuration", async () => {
    const worker = createPrivacyProviderCleanup(
      {
        listPending: () => Promise.resolve([{ ...candidate, linkId: "bad id" }]),
        markCompleted: vi.fn(() => Promise.resolve()),
      },
      { close: vi.fn(() => Promise.resolve()) },
      { limit: 1, now: () => "2026-09-03T12:00:00.000Z" },
    );
    await expect(worker.runOnce()).resolves.toEqual({
      inspected: 1,
      completed: 0,
      failed: 1,
    });
    expect(() =>
      createPrivacyProviderCleanup(
        { listPending: () => Promise.resolve([]), markCompleted: vi.fn() },
        { close: vi.fn() },
        { limit: 0, now: () => "invalid" },
      ),
    ).toThrow("PRIVACY_PROVIDER_CLEANUP_CONFIGURATION_INVALID");
  });
});
