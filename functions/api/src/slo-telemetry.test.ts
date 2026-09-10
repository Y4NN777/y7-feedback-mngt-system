import { describe, expect, it, vi } from "vitest";

import { buildMonthlySloReport, sloDefinitions } from "@y7-feedback/domain";

import {
  parseSloMeasurement,
  routeSloAlerts,
  type SloAlertSink,
} from "./slo-telemetry";

describe("safe SLO telemetry", () => {
  it("BDD-SLO-101 parses only the minimal allow-listed measurement", () => {
    const parsed = parseSloMeasurement({
      event: "slo.measurement",
      metricName: "critical_api_ms",
      metricValue: 42,
      measuredAt: "2026-08-15T12:00:00.000Z",
      environment: "production",
      release: "sha-1234567",
      eligibility: "eligible",
      workspaceId: "must-not-survive",
      accessProof: "must-not-survive",
      body: { title: "must-not-survive" },
    });
    expect(parsed).toEqual({
      metric: "critical_api_ms",
      value: 42,
      measuredAt: "2026-08-15T12:00:00.000Z",
      environment: "production",
      release: "sha-1234567",
      eligible: true,
    });
    expect(JSON.stringify(parsed)).not.toContain("must-not-survive");
  });

  it("BDD-SLO-102 rejects malformed, unknown or ambiguous measurements", () => {
    const valid = {
      event: "slo.measurement",
      metricName: "critical_api_ms",
      metricValue: 42,
      measuredAt: "2026-08-15T12:00:00.000Z",
      environment: "production",
      release: "sha-1234567",
      eligibility: "eligible",
    };
    for (const candidate of [
      null,
      { ...valid, event: "private.event" },
      { ...valid, metricName: "unknown" },
      { ...valid, metricValue: "42" },
      { ...valid, metricValue: Number.NaN },
      { ...valid, metricValue: -1 },
      { ...valid, metricName: "availability", metricValue: 0.5 },
      { ...valid, measuredAt: "invalid" },
      { ...valid, environment: "development" },
      { ...valid, release: "unsafe release" },
      { ...valid, eligibility: "unknown" },
    ])
      expect(() => parseSloMeasurement(candidate)).toThrow("SLO_MEASUREMENT_INVALID");
  });

  it("BDD-SLO-103 routes only deterministic redacted threshold alerts", async () => {
    const observations = sloDefinitions.map((definition) => ({
      metric: definition.metric,
      value:
        definition.id === "NFR-SLO-005"
          ? 501
          : definition.comparison === "minimum"
            ? 1
            : definition.target,
      measuredAt: "2026-08-15T12:00:00.000Z",
      environment: "production" as const,
      release: "sha-1234567",
      eligible: true,
    }));
    const report = buildMonthlySloReport({
      month: "2026-08",
      generatedAt: "2026-08-20T00:00:00.000Z",
      observations,
    });
    const send = vi.fn<SloAlertSink["send"]>().mockResolvedValue(undefined);
    await expect(routeSloAlerts(report, { send })).resolves.toEqual({ sent: 1 });
    expect(send).toHaveBeenCalledWith({
      event: "slo.alert",
      alertId: "2026-08:NFR-SLO-005:failed",
      month: "2026-08",
      sloId: "NFR-SLO-005",
      metric: "critical_api_ms",
      severity: "warning",
      observedValue: 501,
      target: 500,
      sampleCount: 1,
      reportStatus: "provisional",
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain("sha-1234567");
  });

  it("BDD-SLO-104 propagates alert route failure and sends no empty-series alert", async () => {
    const empty = buildMonthlySloReport({
      month: "2026-08",
      generatedAt: "2026-09-01T00:00:00.000Z",
      observations: [],
    });
    const send = vi.fn<SloAlertSink["send"]>().mockResolvedValue(undefined);
    await expect(routeSloAlerts(empty, { send })).resolves.toEqual({ sent: 0 });
    expect(send).not.toHaveBeenCalled();

    const failingReport = buildMonthlySloReport({
      month: "2026-08",
      generatedAt: "2026-09-01T00:00:00.000Z",
      observations: [
        {
          metric: "availability",
          value: 0,
          measuredAt: "2026-08-15T12:00:00.000Z",
          environment: "production",
          release: "sha-1234567",
          eligible: true,
        },
      ],
    });
    await expect(
      routeSloAlerts(failingReport, {
        send: () => Promise.reject(new Error("route unavailable")),
      }),
    ).rejects.toThrow("route unavailable");
  });
});
