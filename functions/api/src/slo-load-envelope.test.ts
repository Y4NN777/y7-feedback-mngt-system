import { describe, expect, it, vi } from "vitest";

import { runSloLoadEnvelope } from "./slo-load-envelope";

describe("reproducible SLO load envelope", () => {
  it("BDD-SLO-204 runs every real probe under bounded concurrency", async () => {
    let active = 0;
    let maximumActive = 0;
    const probe = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
    });
    const probes = {
      critical_api_ms: probe,
      feedback_commit_ms: probe,
      dashboard_ms: probe,
      attachment_processing_ms: probe,
      notification_visibility_ms: probe,
      email_handoff_ms: probe,
    };
    let milliseconds = 0;
    const result = await runSloLoadEnvelope({
      concurrency: 4,
      iterations: 120,
      probes,
      release: "sha-1234567",
      nowIso: () => "2026-09-10T10:01:00.000Z",
      nowMs: () => milliseconds++,
    });

    expect(result.report).toMatchObject({
      status: "passed",
      envelope: { concurrency: 4, iterations: 120 },
    });
    expect(result.observations).toHaveLength(120);
    expect(maximumActive).toBe(4);
    expect(probe).toHaveBeenCalledTimes(120);
  });

  it("BDD-SLO-205 fails closed on a probe error or invalid envelope", async () => {
    const probe = vi.fn(() => Promise.resolve());
    const probes = {
      critical_api_ms: probe,
      feedback_commit_ms: probe,
      dashboard_ms: probe,
      attachment_processing_ms: probe,
      notification_visibility_ms: probe,
      email_handoff_ms: probe,
    };
    await expect(
      runSloLoadEnvelope({
        concurrency: 0,
        iterations: 120,
        probes,
        release: "sha-1234567",
      }),
    ).rejects.toThrow("SLO_LOAD_ENVELOPE_INVALID");
    await expect(
      runSloLoadEnvelope({
        concurrency: 4,
        iterations: 119,
        probes,
        release: "sha-1234567",
      }),
    ).rejects.toThrow("SLO_LOAD_ENVELOPE_INVALID");
    await expect(
      runSloLoadEnvelope({
        concurrency: 4,
        iterations: 120,
        probes: { ...probes, critical_api_ms: () => Promise.reject(new Error("x")) },
        release: "sha-1234567",
      }),
    ).rejects.toThrow("SLO_LOAD_PROBE_FAILED");
  });
});
