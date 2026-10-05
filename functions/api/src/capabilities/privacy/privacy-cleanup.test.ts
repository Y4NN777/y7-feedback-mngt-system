import { describe, expect, it, vi } from "vitest";

import {
  createPrivacyPurgeWorker,
  type PrivacyCleanupPort,
  type PrivacyPurgeCandidate,
  type PrivacyPurgeRepository,
} from "./privacy-cleanup";

const candidates: readonly PrivacyPurgeCandidate[] = [
  {
    deletionId: "deletion_1",
    feedbackId: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    revision: 1,
    purgeEligibleAt: "2026-10-02T00:00:00.000Z",
  },
  {
    deletionId: "deletion_2",
    feedbackId: "feedback_2",
    workspaceId: "workspace_1",
    projectId: "project_1",
    revision: 2,
    purgeEligibleAt: "2026-10-02T00:00:00.000Z",
  },
];

function setup(
  rows: readonly PrivacyPurgeCandidate[] = candidates,
  outcomes: readonly ("purged" | "replayed" | "stale")[] = ["purged", "replayed"],
) {
  const claimDue = vi.fn<PrivacyPurgeRepository["claimDue"]>(() =>
    Promise.resolve(rows),
  );
  const markPurged = vi.fn<PrivacyPurgeRepository["markPurged"]>();
  for (const outcome of outcomes) markPurged.mockResolvedValueOnce(outcome);
  const cleanup = vi.fn<PrivacyCleanupPort["cleanup"]>(() => Promise.resolve());
  const worker = createPrivacyPurgeWorker(
    { claimDue, markPurged },
    [{ cleanup }, { cleanup }],
    {
      createOperationId: (deletionId) => `purge_${deletionId}`,
      now: () => "2026-10-02T00:00:00.000Z",
      workerId: "privacy_worker_1",
      batchSize: 25,
    },
  );
  return { worker, claimDue, markPurged, cleanup };
}

describe("privacy purge worker", () => {
  it("BDD-PRIV-016 cleans every boundary before marking purge", async () => {
    const { worker, claimDue, markPurged, cleanup } = setup();
    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 2,
      purged: 1,
      replayed: 1,
      stale: 0,
      failed: 0,
    });
    expect(claimDue).toHaveBeenCalledWith({
      now: "2026-10-02T00:00:00.000Z",
      limit: 25,
      workerId: "privacy_worker_1",
    });
    expect(cleanup).toHaveBeenCalledTimes(4);
    expect(markPurged).toHaveBeenNthCalledWith(1, {
      deletionId: "deletion_1",
      expectedRevision: 1,
      operationId: "purge_deletion_1",
      purgedAt: "2026-10-02T00:00:00.000Z",
      workerId: "privacy_worker_1",
    });
  });

  it("BDD-PRIV-017 retries partial failures without claiming physical purge", async () => {
    const { worker, cleanup, markPurged } = setup(
      [candidates[0] as PrivacyPurgeCandidate],
      [],
    );
    cleanup.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 1,
      purged: 0,
      replayed: 0,
      stale: 0,
      failed: 1,
    });
    expect(markPurged).not.toHaveBeenCalled();
  });

  it("BDD-PRIV-018 reports stale claims and isolates one candidate failure", async () => {
    const { worker, cleanup } = setup(candidates, ["stale"]);
    cleanup.mockRejectedValueOnce(new Error("first failed"));
    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 2,
      purged: 0,
      replayed: 0,
      stale: 1,
      failed: 1,
    });
  });

  it("BDD-PRIV-019 rejects unsafe worker configuration", () => {
    const repository: PrivacyPurgeRepository = {
      claimDue: vi.fn(),
      markPurged: vi.fn(),
    };
    for (const [workerId, batchSize, ports] of [
      ["bad id", 1, [{ cleanup: vi.fn() }]],
      ["worker", 0, [{ cleanup: vi.fn() }]],
      ["worker", 101, [{ cleanup: vi.fn() }]],
      ["worker", 1, []],
    ] as const)
      expect(() =>
        createPrivacyPurgeWorker(repository, ports, {
          createOperationId: () => "operation",
          now: () => "2026-10-02T00:00:00.000Z",
          workerId,
          batchSize,
        }),
      ).toThrow("PRIVACY_PURGE_CONFIGURATION_INVALID");
  });
});
