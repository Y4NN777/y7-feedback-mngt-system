import { describe, expect, it, vi } from "vitest";

import { planAuthoritativeCommit } from "@y7-feedback/domain";

import { createAuthoritativeProjector } from "./authoritative-projector.js";

const commit = planAuthoritativeCommit(
  {
    environment: "preview",
    aggregateKind: "feedback",
    aggregateId: "feedback_1",
    operationId: "operation_1",
    commandKind: "feedback.accepted",
    workspaceId: "workspace_1",
    projectId: "project_1",
    actorKind: "system",
    actorId: "intake",
    payloadDigest: "digest_0123456789abcdef",
    sealedPayload: "sealed_payload",
    acceptedAt: "2026-09-13T02:00:00.000Z",
  },
  () => "commit_a",
);

function setup(claimed: null | { attempt?: number; leaseToken?: string } = {}) {
  const claim = vi.fn(() =>
    Promise.resolve(
      claimed === null
        ? null
        : {
            commit,
            attempt: claimed.attempt ?? 1,
            leaseToken: claimed.leaseToken ?? "lease_a",
          },
    ),
  );
  const projected = vi.fn(() => Promise.resolve());
  const retry = vi.fn(() => Promise.resolve());
  const project = vi.fn(() => Promise.resolve());
  const clock = ["2026-09-13T02:01:00.000Z", "2026-09-13T02:01:01.000Z"];
  const projector = createAuthoritativeProjector(
    { claim, projected, retry },
    { project },
    {
      now: () => clock.shift() ?? "2026-09-13T02:01:02.000Z",
      leaseUntil: () => "2026-09-13T02:06:00.000Z",
      retryAt: () => "2026-09-13T02:02:00.000Z",
      errorCode: () => "PROJECTION_RETRYABLE",
    },
  );
  return { claim, projected, retry, project, projector };
}

describe("ADR-015 authoritative projector", () => {
  it("BDD-SLO-421 projects one leased commit and checkpoints it", async () => {
    const target = setup();
    await expect(target.projector.runOnce("worker_a")).resolves.toEqual({
      status: "projected",
      commitId: "commit_a",
    });
    expect(target.claim).toHaveBeenCalledWith({
      workerId: "worker_a",
      now: "2026-09-13T02:01:00.000Z",
      leaseUntil: "2026-09-13T02:06:00.000Z",
    });
    expect(target.project).toHaveBeenCalledWith(commit);
    expect(target.projected).toHaveBeenCalledWith({
      commitId: "commit_a",
      leaseToken: "lease_a",
      attempt: 1,
      projectedAt: "2026-09-13T02:01:01.000Z",
    });
    expect(target.retry).not.toHaveBeenCalled();
  });

  it("BDD-SLO-422 remains idle when no commit is due", async () => {
    const target = setup(null);
    await expect(target.projector.runOnce("worker_a")).resolves.toEqual({
      status: "idle",
    });
    expect(target.project).not.toHaveBeenCalled();
  });

  it("BDD-SLO-423 durably schedules a failed projection for retry", async () => {
    const target = setup({ attempt: 2 });
    target.project.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(target.projector.runOnce("worker_a")).resolves.toEqual({
      status: "retry_scheduled",
      commitId: "commit_a",
    });
    expect(target.retry).toHaveBeenCalledWith({
      commitId: "commit_a",
      leaseToken: "lease_a",
      attempt: 2,
      availableAt: "2026-09-13T02:02:00.000Z",
      errorCode: "PROJECTION_RETRYABLE",
    });
    expect(target.projected).not.toHaveBeenCalled();
  });

  it.each([
    ["worker", "bad/worker", {}],
    ["commit", "worker_a", { commit: { ...commit, id: "bad/id" } }],
    ["lease", "worker_a", { leaseToken: "bad/lease" }],
    ["attempt type", "worker_a", { attempt: 1.5 }],
    ["attempt range", "worker_a", { attempt: 0 }],
  ])("BDD-SLO-424 rejects an invalid %s", async (_label, workerId, override) => {
    const target = setup();
    if (Object.keys(override).length > 0) {
      target.claim.mockResolvedValueOnce({
        commit,
        attempt: 1,
        leaseToken: "lease_a",
        ...override,
      });
    }
    await expect(target.projector.runOnce(workerId)).rejects.toThrow(
      workerId === "bad/worker"
        ? "AUTHORITATIVE_PROJECTOR_WORKER_INVALID"
        : "AUTHORITATIVE_PROJECTOR_CLAIM_INVALID",
    );
  });

  it.each([
    ["now", "invalid", "2026-09-13T01:56:00.000Z", "2026-09-13T02:02:00.000Z"],
    ["stale", "2026-09-13T02:01:00.000Z", "invalid", "2026-09-13T02:02:00.000Z"],
    ["retry", "2026-09-13T02:01:00.000Z", "2026-09-13T01:56:00.000Z", "invalid"],
  ])("BDD-SLO-425 rejects an invalid %s clock", async (_label, now, stale, retryAt) => {
    const target = setup();
    target.project.mockRejectedValueOnce(new Error("failure"));
    const projector = createAuthoritativeProjector(
      {
        claim: target.claim,
        projected: target.projected,
        retry: target.retry,
      },
      { project: target.project },
      {
        now: () => now,
        leaseUntil: () => stale,
        retryAt: () => retryAt,
        errorCode: () => "PROJECTION_RETRYABLE",
      },
    );
    await expect(projector.runOnce("worker_a")).rejects.toThrow(
      "AUTHORITATIVE_PROJECTOR_CLOCK_INVALID",
    );
  });

  it("BDD-SLO-426 rejects an unsafe diagnostic code", async () => {
    const target = setup();
    target.project.mockRejectedValueOnce(new Error("sensitive message"));
    const projector = createAuthoritativeProjector(
      { claim: target.claim, projected: target.projected, retry: target.retry },
      { project: target.project },
      {
        now: () => "2026-09-13T02:01:00.000Z",
        leaseUntil: () => "2026-09-13T02:06:00.000Z",
        retryAt: () => "2026-09-13T02:02:00.000Z",
        errorCode: () => "raw sensitive message",
      },
    );
    await expect(projector.runOnce("worker_a")).rejects.toThrow(
      "AUTHORITATIVE_PROJECTOR_ERROR_CODE_INVALID",
    );
    expect(target.retry).not.toHaveBeenCalled();
  });
});
