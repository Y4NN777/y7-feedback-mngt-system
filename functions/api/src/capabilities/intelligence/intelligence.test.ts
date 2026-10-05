import { describe, expect, it, vi } from "vitest";

import type { ActorAccess, IntelligenceFeedback } from "@y7-feedback/domain";

import { createIntelligenceCoordinator, type IntelligenceStore } from "./intelligence";

const actor: ActorAccess = {
  principalId: "owner_1",
  responsibility: "workspace_owner",
  workspaceIds: ["workspace_1"],
  projectIds: [],
};

function feedback(
  feedbackId: string,
  createdAt: string,
  input: Partial<IntelligenceFeedback> = {},
): IntelligenceFeedback {
  return {
    feedbackId,
    workspaceId: "workspace_1",
    projectId: "project_1",
    type: "bug",
    state: "received",
    createdAt,
    reporterKind: "unidentified",
    context: [],
    ...input,
  };
}

function authorized(list: IntelligenceStore["list"]) {
  return createIntelligenceCoordinator(
    {
      verify: vi.fn().mockResolvedValue({ status: "verified", principalId: "owner_1" }),
    },
    {
      resolve: vi.fn().mockResolvedValue({
        status: "authorized",
        actor,
        project: { id: "project_1", workspaceId: "workspace_1", active: true },
      }),
    },
    { list },
  );
}

describe("Intelligence coordinator", () => {
  it("BDD-INT-101 verifies aggregate authority before reading scoped records", async () => {
    const list = vi.fn<IntelligenceStore["list"]>().mockResolvedValue([]);
    const verify = vi.fn().mockResolvedValue({
      status: "verified",
      principalId: "owner_1",
    });
    const resolve = vi.fn().mockResolvedValue({
      status: "authorized",
      actor,
      project: { id: "project_1", workspaceId: "workspace_1", active: true },
    });
    const coordinator = createIntelligenceCoordinator(
      { verify },
      { resolve },
      { list },
    );
    await expect(
      coordinator.analyze({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        query: {},
      }),
    ).resolves.toMatchObject({ status: "ok", result: { ids: [], nextCursor: null } });
    expect(verify).toHaveBeenCalledWith("jwt_1");
    expect(resolve).toHaveBeenCalledWith({
      principalId: "owner_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      capability: "feedback.aggregate",
    });
    expect(list).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      projectId: "project_1",
    });
  });

  it("BDD-INT-102 returns one denial and performs no read for invalid authority", async () => {
    const list = vi.fn<IntelligenceStore["list"]>();
    const deniedIdentity = createIntelligenceCoordinator(
      { verify: vi.fn().mockResolvedValue({ status: "denied" }) },
      { resolve: vi.fn() },
      { list },
    );
    await expect(
      deniedIdentity.analyze({
        jwt: "forged",
        workspaceId: "workspace_1",
        projectId: "project_1",
        query: {},
      }),
    ).resolves.toEqual({ status: "denied" });

    const deniedScope = createIntelligenceCoordinator(
      {
        verify: vi
          .fn()
          .mockResolvedValue({ status: "verified", principalId: "outsider" }),
      },
      { resolve: vi.fn().mockResolvedValue({ status: "denied" }) },
      { list },
    );
    await expect(
      deniedScope.analyze({
        jwt: "jwt_outsider",
        workspaceId: "workspace_1",
        projectId: "project_1",
        query: {},
      }),
    ).resolves.toEqual({ status: "denied" });
    expect(list).not.toHaveBeenCalled();
  });

  it("BDD-INT-103 returns bounded deterministic pages, aggregates and trend", async () => {
    const records = [
      feedback("feedback_3", "2026-08-10T12:00:00.000Z"),
      feedback("feedback_2", "2026-08-09T12:00:00.000Z"),
      feedback("feedback_1", "2026-08-03T12:00:00.000Z"),
      feedback("feedback_other", "2026-08-10T12:00:00.000Z", {
        workspaceId: "workspace_2",
      }),
    ];
    const coordinator = authorized(
      vi.fn<IntelligenceStore["list"]>().mockResolvedValue(records),
    );
    const query = {
      pageSize: 2,
      filter: { types: ["bug"] },
      trendWindow: {
        baseline: {
          from: "2026-08-01T00:00:00.000Z",
          to: "2026-08-08T00:00:00.000Z",
        },
        current: {
          from: "2026-08-08T00:00:00.000Z",
          to: "2026-08-15T00:00:00.000Z",
        },
      },
    };
    const first = await coordinator.analyze({
      jwt: "jwt_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      query,
    });
    expect(first).toMatchObject({
      status: "ok",
      result: {
        ids: ["feedback_3", "feedback_2"],
        nextCursor: "feedback_2",
        aggregate: { total: 3 },
        trend: { currentCount: 2, baselineCount: 1, direction: "up" },
      },
    });
    await expect(
      coordinator.analyze({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        query: { ...query, cursor: "feedback_2" },
      }),
    ).resolves.toMatchObject({
      status: "ok",
      result: { ids: ["feedback_1"], nextCursor: null },
    });
  });

  it("BDD-INT-104 rejects malformed queries, cursors and domain windows", async () => {
    const coordinator = authorized(
      vi
        .fn<IntelligenceStore["list"]>()
        .mockResolvedValue([feedback("feedback_1", "2026-08-10T00:00:00.000Z")]),
    );
    for (const query of [
      null,
      [],
      { filter: [] },
      { pageSize: 0 },
      { pageSize: 101 },
      { pageSize: 1.5 },
      { pageSize: "2" },
      { cursor: 2 },
      { filter: { types: "bug" } },
      { filter: { states: "received" } },
      { filter: { reporterKinds: "contact" } },
      { filter: { versions: "2" } },
      { filter: { places: "dashboard" } },
      { filter: { features: "balance" } },
      { filter: { reviewedContext: [] } },
      { filter: { from: 1 } },
      { filter: { to: 1 } },
      { trendWindow: null },
      { trendWindow: { current: null, baseline: {} } },
      { trendWindow: { current: {}, baseline: null } },
      { trendWindow: { current: {}, baseline: {} } },
      {
        trendWindow: {
          current: { from: 1, to: "2026-08-15T00:00:00.000Z" },
          baseline: {
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-08T00:00:00.000Z",
          },
        },
      },
      {
        trendWindow: {
          current: { from: "2026-08-08T00:00:00.000Z", to: 1 },
          baseline: {
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-08T00:00:00.000Z",
          },
        },
      },
      {
        trendWindow: {
          current: {
            from: "2026-08-08T00:00:00.000Z",
            to: "2026-08-15T00:00:00.000Z",
          },
          baseline: { from: 1, to: "2026-08-08T00:00:00.000Z" },
        },
      },
      {
        trendWindow: {
          current: {
            from: "2026-08-08T00:00:00.000Z",
            to: "2026-08-15T00:00:00.000Z",
          },
          baseline: { from: "2026-08-01T00:00:00.000Z", to: 1 },
        },
      },
    ]) {
      await expect(
        coordinator.analyze({
          jwt: "jwt_1",
          workspaceId: "workspace_1",
          projectId: "project_1",
          query,
        }),
      ).resolves.toEqual({ status: "invalid" });
    }
    await expect(
      coordinator.analyze({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        query: { cursor: "missing" },
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      coordinator.analyze({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        query: {
          filter: {
            types: ["bug"],
            states: ["received"],
            reporterKinds: ["unidentified"],
            versions: [],
            places: [],
            features: [],
            reviewedContext: {},
            from: "2026-08-08T00:00:00.000Z",
            to: "2026-08-15T00:00:00.000Z",
          },
        },
      }),
    ).resolves.toMatchObject({ status: "ok" });

    const tied = authorized(
      vi
        .fn<IntelligenceStore["list"]>()
        .mockResolvedValue([
          feedback("feedback_b", "2026-08-10T00:00:00.000Z"),
          feedback("feedback_a", "2026-08-10T00:00:00.000Z"),
        ]),
    );
    await expect(
      tied.analyze({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        query: {},
      }),
    ).resolves.toMatchObject({
      status: "ok",
      result: { ids: ["feedback_a", "feedback_b"] },
    });
    await expect(
      coordinator.analyze({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "bad id",
        query: {},
      }),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("BDD-INT-105 reduces store failure to a stable retryable outcome", async () => {
    const coordinator = authorized(
      vi.fn<IntelligenceStore["list"]>().mockRejectedValue(new Error("transport")),
    );
    await expect(
      coordinator.analyze({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        query: {},
      }),
    ).resolves.toEqual({ status: "retryable" });
  });
});
