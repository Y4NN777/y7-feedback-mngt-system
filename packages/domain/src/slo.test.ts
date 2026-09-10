import { describe, expect, it } from "vitest";

import {
  buildCapacityReport,
  buildMonthlySloReport,
  evaluateSloSeries,
  sloDefinitions,
  type SloObservation,
} from "./slo";

const observation = (
  metric: SloObservation["metric"],
  value: number,
  overrides: Partial<SloObservation> = {},
): SloObservation => ({
  metric,
  value,
  measuredAt: "2026-08-15T12:00:00.000Z",
  environment: "production",
  release: "sha-1234567",
  eligible: true,
  ...overrides,
});

const definition = (id: SloDefinitionId) => {
  const found = sloDefinitions.find((candidate) => candidate.id === id);
  if (!found) throw new Error("SLO definition fixture missing");
  return found;
};
type SloDefinitionId = (typeof sloDefinitions)[number]["id"];
const availabilityDefinition = definition("NFR-SLO-001");
const criticalApiDefinition = definition("NFR-SLO-005");

describe("SLO measurement policy", () => {
  it("BDD-SLO-001 freezes every normative measurement definition", () => {
    expect(sloDefinitions).toEqual([
      expect.objectContaining({
        id: "NFR-SLO-001",
        metric: "availability",
        target: 0.999,
      }),
      expect.objectContaining({ id: "NFR-SLO-002", metric: "lcp_ms", target: 2500 }),
      expect.objectContaining({ id: "NFR-SLO-003", metric: "inp_ms", target: 200 }),
      expect.objectContaining({ id: "NFR-SLO-004", metric: "cls", target: 0.1 }),
      expect.objectContaining({
        id: "NFR-SLO-005",
        metric: "critical_api_ms",
        target: 500,
      }),
      expect.objectContaining({
        id: "NFR-SLO-006",
        metric: "feedback_commit_ms",
        target: 1000,
      }),
      expect.objectContaining({
        id: "NFR-SLO-007",
        metric: "dashboard_ms",
        target: 1000,
      }),
      expect.objectContaining({
        id: "NFR-SLO-008",
        metric: "attachment_processing_ms",
        target: 2000,
      }),
      expect.objectContaining({
        id: "NFR-SLO-009",
        metric: "notification_visibility_ms",
        target: 5000,
      }),
      expect.objectContaining({
        id: "NFR-SLO-010",
        metric: "email_handoff_ms",
        target: 30000,
      }),
    ]);
  });

  it("BDD-SLO-002 computes nearest-rank percentiles and availability without hiding failures", () => {
    const latency = Array.from({ length: 20 }, (_, index) =>
      observation("critical_api_ms", (index + 1) * 20),
    );
    expect(evaluateSloSeries(criticalApiDefinition, latency)).toMatchObject({
      status: "passed",
      sampleCount: 20,
      value: 380,
    });
    expect(
      evaluateSloSeries(availabilityDefinition, [
        observation("availability", 1),
        observation("availability", 1),
        observation("availability", 0),
      ]),
    ).toMatchObject({ status: "failed", value: 2 / 3, sampleCount: 3 });
  });

  it("BDD-SLO-003 excludes only explicitly ineligible observations and rejects malformed series", () => {
    expect(
      evaluateSloSeries(criticalApiDefinition, [
        observation("critical_api_ms", 100),
        observation("critical_api_ms", 900, { eligible: false }),
      ]),
    ).toMatchObject({ status: "passed", sampleCount: 1, excludedCount: 1, value: 100 });
    expect(evaluateSloSeries(criticalApiDefinition, [])).toEqual({
      status: "insufficient_data",
      sampleCount: 0,
      excludedCount: 0,
    });
    for (const candidate of [
      observation("critical_api_ms", -1),
      observation("critical_api_ms", Number.NaN),
      observation("critical_api_ms", 1, { measuredAt: "invalid" }),
      observation("critical_api_ms", 1, {
        measuredAt: "2026-08-15T12:00:00.000+00:00",
      }),
      observation("critical_api_ms", 1, { release: "" }),
      observation("critical_api_ms", 1, { release: "unsafe release" }),
    ])
      expect(() => evaluateSloSeries(criticalApiDefinition, [candidate])).toThrow(
        "SLO_OBSERVATION_INVALID",
      );
    expect(() =>
      evaluateSloSeries(criticalApiDefinition, [observation("dashboard_ms", 1)]),
    ).toThrow("SLO_OBSERVATION_INVALID");
    expect(() =>
      evaluateSloSeries(availabilityDefinition, [observation("availability", 0.5)]),
    ).toThrow("SLO_OBSERVATION_INVALID");
  });

  it("BDD-SLO-004 never calls an open month or Preview series a monthly Production pass", () => {
    const observations = sloDefinitions.map((definition) =>
      observation(
        definition.metric,
        definition.comparison === "minimum" ? 1 : definition.target,
      ),
    );
    expect(
      buildMonthlySloReport({
        month: "2026-08",
        generatedAt: "2026-08-20T00:00:00.000Z",
        observations,
      }),
    ).toMatchObject({ status: "provisional", month: "2026-08" });
    expect(
      buildMonthlySloReport({
        month: "2026-08",
        generatedAt: "2026-09-01T00:00:00.000Z",
        observations: observations.map((item) => ({ ...item, environment: "preview" })),
      }),
    ).toMatchObject({ status: "insufficient_data" });
    expect(
      buildMonthlySloReport({
        month: "2026-08",
        generatedAt: "2026-09-01T00:00:00.000Z",
        observations,
      }),
    ).toMatchObject({ status: "passed" });
    expect(
      buildMonthlySloReport({
        month: "2026-08",
        generatedAt: "2026-09-01T00:00:00.000Z",
        observations: [
          ...observations.filter(({ metric }) => metric !== "critical_api_ms"),
          observation("critical_api_ms", 501),
          observation("critical_api_ms", 1, {
            measuredAt: "2026-07-31T23:59:59.999Z",
          }),
          observation("critical_api_ms", 1, {
            measuredAt: "2026-09-01T00:00:00.000Z",
          }),
        ],
      }),
    ).toMatchObject({ status: "failed" });
    expect(() =>
      buildMonthlySloReport({
        month: "2026-13",
        generatedAt: "2026-09-01T00:00:00.000Z",
        observations: [],
      }),
    ).toThrow("SLO_MONTH_INVALID");
    expect(() =>
      buildMonthlySloReport({
        month: "2026-08",
        generatedAt: "invalid",
        observations: [],
      }),
    ).toThrow("SLO_REPORT_TIME_INVALID");
    expect(() =>
      buildMonthlySloReport({
        month: "2026-08",
        generatedAt: "2026-09-01T00:00:00.000Z",
        observations: [observation("availability", 1, { measuredAt: "invalid" })],
      }),
    ).toThrow("SLO_OBSERVATION_INVALID");
  });

  it("BDD-SLO-005 reports only the load envelope actually exercised", () => {
    const capacityInput = {
      environment: "preview",
      release: "sha-1234567",
      startedAt: "2026-09-10T10:00:00.000Z",
      completedAt: "2026-09-10T10:02:00.000Z",
      concurrency: 4,
      iterations: 120,
      observations: sloDefinitions
        .filter(({ id }) => Number(id.slice(-3)) >= 5)
        .flatMap((definition) =>
          Array.from({ length: 20 }, () =>
            observation(definition.metric, 1, {
              environment: "preview",
              measuredAt: "2026-09-10T10:01:00.000Z",
            }),
          ),
        ),
    } as const;
    const report = buildCapacityReport(capacityInput);
    expect(report).toMatchObject({
      status: "passed",
      envelope: { concurrency: 4, iterations: 120 },
    });
    expect(report.series).toHaveLength(6);
    expect(buildCapacityReport({ ...capacityInput, observations: [] })).toMatchObject({
      status: "failed",
    });
    expect(() =>
      buildCapacityReport({
        ...capacityInput,
        observations: capacityInput.observations.slice(1),
      }),
    ).toThrow("SLO_CAPACITY_SAMPLE_COUNT_INVALID");
    for (const override of [
      { startedAt: "invalid" },
      { completedAt: "invalid" },
      { completedAt: "2026-09-10T09:59:59.999Z" },
      { release: "" },
      { concurrency: 1.5 },
      { concurrency: 0 },
      { iterations: 1.5 },
      { iterations: 0 },
    ])
      expect(() => buildCapacityReport({ ...capacityInput, ...override })).toThrow(
        "SLO_CAPACITY_INPUT_INVALID",
      );
    for (const override of [
      { environment: "production" as const },
      { release: "sha-other" },
      { measuredAt: "invalid" },
      { measuredAt: "2026-09-10T09:59:59.999Z" },
      { measuredAt: "2026-09-10T10:02:00.001Z" },
    ]) {
      const firstObservation = capacityInput.observations[0];
      if (!firstObservation) throw new Error("capacity observation fixture missing");
      expect(() =>
        buildCapacityReport({
          ...capacityInput,
          observations: [{ ...firstObservation, ...override }],
        }),
      ).toThrow("SLO_CAPACITY_OBSERVATION_INVALID");
    }
  });
});
