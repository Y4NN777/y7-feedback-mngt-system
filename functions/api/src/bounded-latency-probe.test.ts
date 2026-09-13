import { describe, expect, it, vi } from "vitest";

import { runBoundedLatencyProbe } from "./bounded-latency-probe.js";

describe("bounded latency probe", () => {
  it("BDD-SLO-213 exercises the declared concurrency and preserves every sample", async () => {
    let active = 0;
    let maximumActive = 0;
    const probe = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return 25;
    });

    await expect(
      runBoundedLatencyProbe({ concurrency: 4, iterations: 40, probe }),
    ).resolves.toEqual(Array(40).fill(25));
    expect(maximumActive).toBe(4);
    expect(probe).toHaveBeenCalledTimes(40);
  });

  it("BDD-SLO-214 rejects invalid envelopes and samples", async () => {
    await expect(
      runBoundedLatencyProbe({
        concurrency: 0,
        iterations: 40,
        probe: () => Promise.resolve(1),
      }),
    ).rejects.toThrow("BOUNDED_LATENCY_PROBE_INVALID");
    await expect(
      runBoundedLatencyProbe({
        concurrency: 4,
        iterations: 3,
        probe: () => Promise.resolve(1),
      }),
    ).rejects.toThrow("BOUNDED_LATENCY_PROBE_INVALID");
    await expect(
      runBoundedLatencyProbe({
        concurrency: 1,
        iterations: 1,
        probe: () => Promise.resolve(-1),
      }),
    ).rejects.toThrow("BOUNDED_LATENCY_SAMPLE_INVALID");
  });
});
