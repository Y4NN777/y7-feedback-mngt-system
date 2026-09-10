import { describe, expect, it } from "vitest";

import { buildLatencyHistogram, buildMeasurementSeriesIndex } from "./slo-series";

describe("SLO measurement series", () => {
  it("BDD-SLO-201 builds cumulative server latency histogram buckets", () => {
    expect(buildLatencyHistogram([5, 100, 100, 501], [50, 100, 500])).toEqual({
      count: 4,
      sum: 706,
      buckets: [
        { upperBoundMs: 50, cumulativeCount: 1 },
        { upperBoundMs: 100, cumulativeCount: 3 },
        { upperBoundMs: 500, cumulativeCount: 3 },
        { upperBoundMs: null, cumulativeCount: 4 },
      ],
    });
  });

  it("BDD-SLO-202 rejects ambiguous histogram observations and boundaries", () => {
    for (const [observations, boundaries] of [
      [[1, Number.NaN], [100]],
      [[-1], [100]],
      [[1], []],
      [[1], [100, 50]],
      [[1], [100, 100]],
      [[1], [0]],
    ] as const)
      expect(() => buildLatencyHistogram(observations, boundaries)).toThrow(
        "SLO_HISTOGRAM_INVALID",
      );
  });

  it("BDD-SLO-203 indexes every frozen series with its authoritative collector", () => {
    const index = buildMeasurementSeriesIndex();
    expect(index).toHaveLength(10);
    expect(index.map(({ id }) => id)).toEqual([
      "NFR-SLO-001",
      "NFR-SLO-002",
      "NFR-SLO-003",
      "NFR-SLO-004",
      "NFR-SLO-005",
      "NFR-SLO-006",
      "NFR-SLO-007",
      "NFR-SLO-008",
      "NFR-SLO-009",
      "NFR-SLO-010",
    ]);
    expect(index).toContainEqual(
      expect.objectContaining({
        id: "NFR-SLO-005",
        collector: "trusted_api_histogram",
        evidenceScope: "preview_load_and_production_monthly",
      }),
    );
    expect(index).toContainEqual(
      expect.objectContaining({
        id: "NFR-SLO-002",
        collector: "vercel_web_vitals",
      }),
    );
    expect(index).toContainEqual(
      expect.objectContaining({
        id: "NFR-SLO-010",
        collector: "mail_handoff_probe",
      }),
    );
    expect(index[0]?.prohibitedFields).toEqual([
      "accessProof",
      "attachmentContent",
      "contact",
      "internalNote",
      "providerToken",
      "workspaceId",
    ]);
  });
});
