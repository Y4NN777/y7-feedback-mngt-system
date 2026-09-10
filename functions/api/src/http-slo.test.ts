import { describe, expect, it } from "vitest";

import { classifyHttpSloMeasurements } from "./http-slo";

const input = {
  method: "POST",
  path: "/v1/projects/demo/feedback",
  operation: "public_api",
  statusCode: 201,
  durationMs: 125,
  measuredAt: "2026-09-10T17:00:00.000Z",
  environment: "preview" as const,
  release: "sha-1234567",
};

describe("HTTP SLO classification", () => {
  it("BDD-SLO-301 records intake as critical API and feedback commit", () => {
    expect(classifyHttpSloMeasurements(input)).toEqual([
      expect.objectContaining({
        event: "slo.measurement",
        metricName: "critical_api_ms",
        metricValue: 125,
        eligibility: "eligible",
      }),
      expect.objectContaining({
        event: "slo.measurement",
        metricName: "feedback_commit_ms",
        metricValue: 125,
        eligibility: "eligible",
      }),
    ]);
  });

  it.each([
    [401, "authorization_denied"],
    [403, "authorization_denied"],
    [400, "client_rejected"],
    [422, "client_rejected"],
    [429, "rate_limited"],
    [500, "eligible"],
  ] as const)("BDD-SLO-302 classifies HTTP %i as %s", (statusCode, eligibility) => {
    expect(classifyHttpSloMeasurements({ ...input, statusCode })[0]?.eligibility).toBe(
      eligibility,
    );
  });

  it("BDD-SLO-303 records dashboard and critical request series", () => {
    const events = classifyHttpSloMeasurements({
      ...input,
      method: "GET",
      path: "/v1/workspaces/workspace_1/projects/project_1/workbench",
      operation: "workbench",
      statusCode: 200,
    });
    expect(events.map(({ metricName }) => metricName)).toEqual([
      "critical_api_ms",
      "dashboard_ms",
    ]);
  });

  it.each([
    ["POST", "/v1/feedback/retrieve", "public_api"],
    ["POST", "/v1/feedback/access-proof/rotate", "public_api"],
    ["POST", "/v1/feedback/attachments/download", "public_api"],
    ["POST", "/v1/workspaces/w/projects/p/conversation", "conversation_lifecycle"],
  ])("BDD-SLO-304 instruments critical operation %s %s", (method, path, operation) => {
    expect(
      classifyHttpSloMeasurements({ ...input, method, path, operation }),
    ).toHaveLength(1);
  });

  it("BDD-SLO-305 excludes health, unknown and development traffic", () => {
    expect(
      classifyHttpSloMeasurements({
        ...input,
        method: "GET",
        path: "/health",
        operation: "health",
      }),
    ).toEqual([]);
    expect(classifyHttpSloMeasurements({ ...input, operation: "unknown" })).toEqual([]);
    expect(
      classifyHttpSloMeasurements({ ...input, environment: "development" }),
    ).toEqual([]);
  });

  it("BDD-SLO-306 rejects invalid latency and measurement time", () => {
    expect(() => classifyHttpSloMeasurements({ ...input, durationMs: -1 })).toThrow(
      "HTTP_SLO_INPUT_INVALID",
    );
    expect(() =>
      classifyHttpSloMeasurements({ ...input, measuredAt: "invalid" }),
    ).toThrow("HTTP_SLO_INPUT_INVALID");
  });
});
