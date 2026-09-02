import { describe, expect, it, vi } from "vitest";

import { createProviderMaintenance } from "./provider-maintenance.js";

describe("scheduled provider maintenance", () => {
  it("BDD-SYNC-063 runs inbox, outbox and webhook reconciliation", async () => {
    const inbox = vi.fn(() => Promise.resolve({ status: "processed" }));
    const outbox = vi.fn(() => Promise.resolve({ status: "delivered" }));
    const webhooks = vi.fn(() =>
      Promise.resolve({ status: "reconciled", inspected: 2, repaired: 2 }),
    );
    const maintenance = createProviderMaintenance({
      inbox: { runOnce: inbox },
      outbox: { runOnce: outbox },
      webhooks: { runOnce: webhooks },
      privacy: { runOnce: () => Promise.resolve({ status: "idle" }) },
    });

    await expect(maintenance.runOnce()).resolves.toEqual({
      status: "completed",
      inbox: "processed",
      outbox: "delivered",
      webhooks: "reconciled",
      privacy: "idle",
    });
    expect(inbox).toHaveBeenCalledOnce();
    expect(outbox).toHaveBeenCalledOnce();
    expect(webhooks).toHaveBeenCalledOnce();
  });

  it("BDD-SYNC-064 waits for every capability and fails the scheduled execution", async () => {
    const inbox = vi.fn(() => Promise.reject(new Error("database outage")));
    const outbox = vi.fn(() => Promise.resolve({ status: "idle" }));
    const webhooks = vi.fn(() => Promise.resolve({ status: "reconciled" }));
    const maintenance = createProviderMaintenance({
      inbox: { runOnce: inbox },
      outbox: { runOnce: outbox },
      webhooks: { runOnce: webhooks },
    });

    await expect(maintenance.runOnce()).rejects.toThrow(
      "PROVIDER_MAINTENANCE_RETRYABLE",
    );
    expect(outbox).toHaveBeenCalledOnce();
    expect(webhooks).toHaveBeenCalledOnce();
  });

  it("BDD-SYNC-069 uses a stable result when a capability has no status field", async () => {
    const maintenance = createProviderMaintenance({
      inbox: { runOnce: () => Promise.resolve({}) },
      outbox: { runOnce: () => Promise.resolve({ status: "idle" }) },
      webhooks: { runOnce: () => Promise.resolve({ status: "reconciled" }) },
    });
    await expect(maintenance.runOnce()).resolves.toMatchObject({
      inbox: "completed",
    });
  });

  it("BDD-PRIV-044 supports privacy-only schedules and rejects an empty schedule", async () => {
    const privacy = vi.fn(() => Promise.resolve({ purged: 1 }));
    await expect(
      createProviderMaintenance({ privacy: { runOnce: privacy } }).runOnce(),
    ).resolves.toEqual({ status: "completed", privacy: "completed" });
    expect(privacy).toHaveBeenCalledOnce();
    expect(() => createProviderMaintenance({})).toThrow(
      "PROVIDER_MAINTENANCE_CONFIGURATION_INVALID",
    );
  });
});
