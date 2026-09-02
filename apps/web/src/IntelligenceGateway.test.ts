import { describe, expect, it, vi } from "vitest";

import { createHttpIntelligenceGateway } from "./IntelligenceGateway";

const payload = {
  status: "ok",
  result: {
    ids: ["feedback_1"],
    nextCursor: null,
    aggregate: {
      total: 1,
      byType: { bug: 1, suggestion: 0, review: 0 },
      byState: {
        received: 1,
        under_review: 0,
        awaiting_reporter: 0,
        resolved: 0,
        closed: 0,
      },
    },
    trend: {
      currentCount: 1,
      baselineCount: 0,
      changePercent: null,
      direction: "new",
    },
  },
};

describe("HTTP Intelligence gateway", () => {
  it("BDD-INT-210 sends scoped filters with a bearer JWT and parses the result", async () => {
    const fetcher = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const gateway = createHttpIntelligenceGateway(
      "https://api.example/",
      () => Promise.resolve("jwt_1"),
      fetcher,
    );
    const trendWindow = {
      current: { from: "2026-08-25T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
      baseline: { from: "2026-08-18T00:00:00.000Z", to: "2026-08-25T00:00:00.000Z" },
    };

    await expect(
      gateway.analyze({
        workspaceId: "workspace_1",
        projectId: "project/1",
        filter: { types: ["bug"], reporterKinds: ["external"] },
        trendWindow,
      }),
    ).resolves.toEqual({ status: "ok", result: payload.result });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.example/v1/workspaces/workspace_1/projects/project%2F1/intelligence",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      authorization: "Bearer jwt_1",
      "content-type": "application/json",
    });
    expect(init?.body).toBe(
      JSON.stringify({
        filter: { types: ["bug"], reporterKinds: ["external"] },
        pageSize: 50,
        trendWindow,
      }),
    );
  });

  it("BDD-INT-211 maps denial, validation, transport and malformed projections safely", async () => {
    const deniedSession = createHttpIntelligenceGateway("https://api.example", () =>
      Promise.reject(new Error("no")),
    );
    await expect(
      deniedSession.analyze({ workspaceId: "w", projectId: "p", filter: {} }),
    ).resolves.toEqual({ status: "denied" });
    for (const [status, expected] of [
      [404, "denied"],
      [400, "invalid"],
      [503, "retryable"],
    ] as const) {
      const gateway = createHttpIntelligenceGateway(
        "https://api.example",
        () => Promise.resolve("jwt"),
        () =>
          Promise.resolve(new Response(JSON.stringify({ error: "safe" }), { status })),
      );
      await expect(
        gateway.analyze({ workspaceId: "w", projectId: "p", filter: {} }),
      ).resolves.toEqual({ status: expected });
    }
    for (const body of [
      null,
      {},
      { result: {} },
      { result: { ...payload.result, ids: [null] } },
    ]) {
      const gateway = createHttpIntelligenceGateway(
        "https://api.example",
        () => Promise.resolve("jwt"),
        () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
      );
      await expect(
        gateway.analyze({ workspaceId: "w", projectId: "p", filter: {} }),
      ).resolves.toEqual({ status: "retryable" });
    }
  });

  it("BDD-INT-216 rejects every malformed aggregate and trend boundary", async () => {
    const invalidResults: unknown[] = [
      { ...payload.result, nextCursor: 1 },
      { ...payload.result, aggregate: null },
      { ...payload.result, aggregate: { ...payload.result.aggregate, total: -1 } },
      { ...payload.result, aggregate: { ...payload.result.aggregate, byType: null } },
      {
        ...payload.result,
        aggregate: {
          ...payload.result.aggregate,
          byType: { ...payload.result.aggregate.byType, bug: -1 },
        },
      },
      {
        ...payload.result,
        aggregate: {
          ...payload.result.aggregate,
          byState: { ...payload.result.aggregate.byState, closed: "0" },
        },
      },
      { ...payload.result, trend: {} },
      { ...payload.result, trend: { ...payload.result.trend, currentCount: -1 } },
      { ...payload.result, trend: { ...payload.result.trend, baselineCount: "0" } },
      { ...payload.result, trend: { ...payload.result.trend, changePercent: "1" } },
      { ...payload.result, trend: { ...payload.result.trend, direction: "invented" } },
    ];
    for (const candidate of invalidResults) {
      const gateway = createHttpIntelligenceGateway(
        "https://api.example",
        () => Promise.resolve("jwt"),
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ result: candidate }), { status: 200 }),
          ),
      );
      await expect(
        gateway.analyze({ workspaceId: "w", projectId: "p", filter: {} }),
      ).resolves.toEqual({ status: "retryable" });
    }
  });

  it("BDD-INT-322 sends provenance commands and validates attributable receipts", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            disposition: "applied",
            associationId: "association_1",
            eventId: "event_1",
            revision: 1,
          },
        }),
        { status: 200 },
      ),
    );
    const gateway = createHttpIntelligenceGateway(
      "https://api.example/",
      () => Promise.resolve("jwt_1"),
      fetcher,
    );
    const command = {
      kind: "record_theme",
      operationId: "operation_1",
      feedbackId: "feedback_1",
      label: "Checkout friction",
    } as const;
    await expect(
      gateway.mutate({ workspaceId: "workspace_1", projectId: "project_1", command }),
    ).resolves.toEqual({
      status: "ok",
      result: {
        disposition: "applied",
        associationId: "association_1",
        eventId: "event_1",
        revision: 1,
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example/v1/workspaces/workspace_1/projects/project_1/intelligence/provenance",
      expect.objectContaining({ method: "POST", body: JSON.stringify(command) }),
    );
  });

  it("BDD-INT-323 fails closed for provenance transport and malformed receipts", async () => {
    const command = {
      kind: "remove_association",
      operationId: "operation_1",
      associationId: "association_1",
      expectedRevision: 1,
    } as const;
    const input = { workspaceId: "w", projectId: "p", command };
    const denied = createHttpIntelligenceGateway("https://api.example", () =>
      Promise.reject(new Error("session")),
    );
    await expect(denied.mutate(input)).resolves.toEqual({ status: "denied" });
    for (const [status, expected] of [
      [404, "denied"],
      [400, "invalid"],
      [409, "conflict"],
      [503, "retryable"],
    ] as const) {
      const gateway = createHttpIntelligenceGateway(
        "https://api.example",
        () => Promise.resolve("jwt"),
        () => Promise.resolve(new Response("{}", { status })),
      );
      await expect(gateway.mutate(input)).resolves.toEqual({ status: expected });
    }
    for (const result of [
      null,
      {},
      { disposition: "unknown", associationId: "a", eventId: "e", revision: 1 },
      { disposition: "applied", associationId: 1, eventId: "e", revision: 1 },
      { disposition: "applied", associationId: "a", eventId: 1, revision: 1 },
      { disposition: "applied", associationId: "a", eventId: "e", revision: 0 },
    ]) {
      const gateway = createHttpIntelligenceGateway(
        "https://api.example",
        () => Promise.resolve("jwt"),
        () =>
          Promise.resolve(new Response(JSON.stringify({ result }), { status: 200 })),
      );
      await expect(gateway.mutate(input)).resolves.toEqual({ status: "retryable" });
    }
  });
});
