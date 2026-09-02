import { describe, expect, it, vi } from "vitest";

import type { ActiveSourceGrant } from "./source-connection-coordinator.js";
import { createProviderWebhookReconciliation } from "./provider-webhook-reconciliation.js";

const github: ActiveSourceGrant = {
  id: "connection_github",
  workspaceId: "workspace_1",
  projectId: "project_1",
  ownerUserId: "owner_1",
  provider: "github",
  encryptedGrantRef: "grant_github",
  selectedRepositories: [{ provider: "github", id: "repository_1" }],
};

const gitlab: ActiveSourceGrant = {
  ...github,
  id: "connection_gitlab",
  provider: "gitlab",
  encryptedGrantRef: "grant_gitlab",
  selectedRepositories: [{ provider: "gitlab", id: "repository_2" }],
};

describe("provider webhook reconciliation", () => {
  it("BDD-SYNC-060 repairs every bounded active provider connection", async () => {
    const list = vi.fn(() => Promise.resolve([github, gitlab]));
    const ensure = vi.fn(() => Promise.resolve());
    const reconcile = createProviderWebhookReconciliation(
      { list },
      { ensure, remove: vi.fn() },
      25,
    );

    await expect(reconcile.runOnce()).resolves.toEqual({
      status: "reconciled",
      inspected: 2,
      repaired: 2,
    });
    expect(list).toHaveBeenCalledWith(25);
    expect(ensure).toHaveBeenNthCalledWith(1, github);
    expect(ensure).toHaveBeenNthCalledWith(2, gitlab);
  });

  it("BDD-SYNC-061 attempts the full batch and exposes outage for scheduled retry", async () => {
    const ensure = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(undefined);
    const reconcile = createProviderWebhookReconciliation(
      { list: vi.fn(() => Promise.resolve([github, gitlab])) },
      { ensure, remove: vi.fn() },
      25,
    );

    await expect(reconcile.runOnce()).rejects.toThrow(
      "PROVIDER_WEBHOOK_RECONCILIATION_RETRYABLE",
    );
    expect(ensure).toHaveBeenCalledTimes(2);
    await expect(reconcile.runOnce()).resolves.toEqual({
      status: "reconciled",
      inspected: 2,
      repaired: 2,
    });
  });

  it("BDD-SYNC-062 rejects unsafe batch configuration", () => {
    expect(() =>
      createProviderWebhookReconciliation(
        { list: vi.fn() },
        { ensure: vi.fn(), remove: vi.fn() },
        0,
      ),
    ).toThrow("PROVIDER_WEBHOOK_RECONCILIATION_CONFIG_INVALID");
  });
});
