import { describe, expect, it, vi } from "vitest";

import { probeUrl } from "./availability-probe.js";
import { stableProbeFailureCode } from "./slo-probe-failure.js";

describe("G5 probe diagnostics", () => {
  it("BDD-SLO-208 preserves a stable code from structured failure details", () => {
    expect(
      stableProbeFailureCode(
        '{"status":"error","code":"APPWRITE_DEPLOYED_G1_STATUS_INVALID:{\\"expected\\":201,\\"actual\\":503}"}\n',
      ),
    ).toBe("APPWRITE_DEPLOYED_G1_STATUS_INVALID");
  });

  it("BDD-SLO-209 rejects unstructured child diagnostics", () => {
    expect(stableProbeFailureCode("private transport failure")).toBe("UNKNOWN");
    expect(stableProbeFailureCode("{}\n")).toBe("UNKNOWN");
  });

  it("BDD-SLO-210 accepts a stable error field and skips malformed codes", () => {
    expect(
      stableProbeFailureCode(
        '{"code":"invalid"}\n{"error":"APPWRITE_PROBE_DENIED:private"}\n',
      ),
    ).toBe("APPWRITE_PROBE_DENIED");
  });
});

describe("G5 availability probes", () => {
  it("BDD-SLO-211 retries transient transport and server failures", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const wait = vi.fn(() => Promise.resolve());

    await expect(probeUrl("https://example.test/health", fetcher, wait)).resolves.toBe(
      true,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("BDD-SLO-212 fails closed after bounded retries", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));

    await expect(
      probeUrl("https://example.test/health", fetcher, () => Promise.resolve()),
    ).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("BDD-SLO-218 uses the runtime transport and delay while rejecting terminal HTTP", async () => {
    vi.useFakeTimers();
    const runtimeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", runtimeFetch);
    const pending = probeUrl("https://example.test/health");
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe(true);
    vi.useRealTimers();
    vi.unstubAllGlobals();

    const terminal = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    await expect(
      probeUrl("https://example.test/health", terminal, () => Promise.resolve()),
    ).resolves.toBe(false);
    expect(terminal).toHaveBeenCalledTimes(1);
  });

  it("BDD-SLO-219 stops after the third server failure", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    );
    await expect(
      probeUrl("https://example.test/health", fetcher, () => Promise.resolve()),
    ).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
