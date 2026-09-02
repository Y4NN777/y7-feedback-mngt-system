import { describe, expect, it } from "vitest";

import {
  aggregateIntelligenceFeedback,
  filterIntelligenceFeedback,
  intelligenceTrend,
  IntelligencePolicyError,
  type IntelligenceFeedback,
} from "./intelligence.js";

const scope = { workspaceId: "workspace_1", projectId: "project_1" };

function feedback(
  feedbackId: string,
  input: Partial<IntelligenceFeedback> = {},
): IntelligenceFeedback {
  return {
    feedbackId,
    workspaceId: "workspace_1",
    projectId: "project_1",
    type: "bug",
    state: "received",
    createdAt: "2026-08-10T12:00:00.000Z",
    reporterKind: "unidentified",
    version: "2.0.0",
    place: "dashboard",
    feature: "balance",
    context: [{ name: "plan", value: "student", reviewed: true }],
    ...input,
  };
}

describe("scoped feedback intelligence", () => {
  it("BDD-INT-001 filters every supported dimension within exact authority scope", () => {
    const selected = feedback("feedback_selected", {
      type: "suggestion",
      state: "under_review",
      reporterKind: "contact",
    });
    const records = [
      selected,
      feedback("feedback_type"),
      feedback("feedback_state", { type: "suggestion", state: "closed" }),
      feedback("feedback_reporter", {
        type: "suggestion",
        state: "under_review",
        reporterKind: "external",
      }),
      feedback("feedback_version", {
        ...selected,
        feedbackId: "feedback_version",
        version: "1.0.0",
      }),
      feedback("feedback_place", {
        ...selected,
        feedbackId: "feedback_place",
        place: "settings",
      }),
      feedback("feedback_feature", {
        ...selected,
        feedbackId: "feedback_feature",
        feature: "profile",
      }),
      feedback("feedback_context", {
        ...selected,
        feedbackId: "feedback_context",
        context: [{ name: "plan", value: "student", reviewed: false }],
      }),
      feedback("feedback_before", {
        ...selected,
        feedbackId: "feedback_before",
        createdAt: "2026-08-01T00:00:00.000Z",
      }),
    ];

    expect(
      filterIntelligenceFeedback(records, scope, {
        types: ["suggestion"],
        states: ["under_review"],
        reporterKinds: ["contact"],
        versions: ["2.0.0"],
        places: ["dashboard"],
        features: ["balance"],
        reviewedContext: { plan: "student" },
        from: "2026-08-08T00:00:00.000Z",
        to: "2026-08-15T00:00:00.000Z",
      }),
    ).toEqual([selected]);
  });

  it("BDD-INT-002 excludes deleted, sibling Project and cross-Workspace records", () => {
    const visible = feedback("feedback_visible");
    expect(
      filterIntelligenceFeedback(
        [
          visible,
          feedback("feedback_deleted", {
            deletedAt: "2026-08-11T00:00:00.000Z",
          }),
          feedback("feedback_sibling_project", { projectId: "project_2" }),
          feedback("feedback_sibling_workspace", { workspaceId: "workspace_2" }),
        ],
        scope,
        {},
      ),
    ).toEqual([visible]);
  });

  it("BDD-INT-003 computes deterministic type and lifecycle aggregates", () => {
    expect(
      aggregateIntelligenceFeedback(
        [
          feedback("bug_received"),
          feedback("suggestion_review", {
            type: "suggestion",
            state: "under_review",
          }),
          feedback("review_resolved", { type: "review", state: "resolved" }),
          feedback("deleted", {
            type: "review",
            state: "closed",
            deletedAt: "2026-08-12T00:00:00.000Z",
          }),
        ],
        scope,
        {},
      ),
    ).toEqual({
      total: 3,
      byType: { bug: 1, suggestion: 1, review: 1 },
      byState: {
        received: 1,
        under_review: 1,
        awaiting_reporter: 0,
        resolved: 1,
        closed: 0,
      },
    });
  });

  it("BDD-INT-004 reports explicit empty, new, stable, up and down trend semantics", () => {
    const window = {
      baseline: {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-08T00:00:00.000Z",
      },
      current: {
        from: "2026-08-08T00:00:00.000Z",
        to: "2026-08-15T00:00:00.000Z",
      },
    };
    expect(intelligenceTrend([], scope, {}, window)).toMatchObject({
      direction: "empty",
      changePercent: null,
    });
    expect(intelligenceTrend([feedback("current")], scope, {}, window)).toMatchObject({
      direction: "new",
      currentCount: 1,
      baselineCount: 0,
    });
    const baseline = feedback("baseline", {
      createdAt: "2026-08-03T12:00:00.000Z",
    });
    expect(
      intelligenceTrend([baseline, feedback("current")], scope, {}, window),
    ).toMatchObject({ direction: "stable", changePercent: 0 });
    expect(
      intelligenceTrend(
        [baseline, feedback("current_1"), feedback("current_2")],
        scope,
        {},
        window,
      ),
    ).toMatchObject({ direction: "up", changePercent: 100 });
    expect(
      intelligenceTrend(
        [
          baseline,
          feedback("baseline_2", {
            createdAt: "2026-08-04T12:00:00.000Z",
          }),
          feedback("current"),
        ],
        scope,
        {},
        window,
      ),
    ).toMatchObject({ direction: "down", changePercent: -50 });
  });

  it("BDD-INT-005 rejects malformed scope, filters and incomparable windows", () => {
    expect(() =>
      filterIntelligenceFeedback([], { ...scope, projectId: "bad id" }, {}),
    ).toThrow(new IntelligencePolicyError("INTELLIGENCE_SCOPE_INVALID"));
    expect(() =>
      filterIntelligenceFeedback([], scope, {
        versions: Array.from({ length: 21 }, (_, index) => `v${String(index)}`),
      }),
    ).toThrow(new IntelligencePolicyError("INTELLIGENCE_FILTER_INVALID"));
    expect(() =>
      filterIntelligenceFeedback([], scope, {
        from: "2026-08-01T00:00:00.000Z",
      }),
    ).toThrow(new IntelligencePolicyError("INTELLIGENCE_WINDOW_INVALID"));
    expect(() =>
      filterIntelligenceFeedback([], scope, {
        from: "not-a-time",
        to: "2026-08-02T00:00:00.000Z",
      }),
    ).toThrow(new IntelligencePolicyError("INTELLIGENCE_TIME_INVALID"));
    expect(() =>
      filterIntelligenceFeedback([], scope, {
        from: "2026-08-02T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
      }),
    ).toThrow(new IntelligencePolicyError("INTELLIGENCE_WINDOW_INVALID"));
    for (const reviewedContext of [
      { "bad name": "value" },
      { plan: "" },
      { score: Number.NaN },
    ]) {
      expect(() => filterIntelligenceFeedback([], scope, { reviewedContext })).toThrow(
        new IntelligencePolicyError("INTELLIGENCE_FILTER_INVALID"),
      );
    }
    expect(() =>
      intelligenceTrend(
        [],
        scope,
        {},
        {
          baseline: {
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-07T00:00:00.000Z",
          },
          current: {
            from: "2026-08-08T00:00:00.000Z",
            to: "2026-08-15T00:00:00.000Z",
          },
        },
      ),
    ).toThrow(new IntelligencePolicyError("INTELLIGENCE_WINDOW_INVALID"));
  });
});
