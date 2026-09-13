import { describe, expect, it, vi } from "vitest";

import { drainAuthoritativeProjectionEvent } from "./authoritative-projection-event.js";

describe("authoritative projection event drain", () => {
  it("BDD-SLO-216 retries a transient final projection within the same event", async () => {
    const runBatch = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        processed: 1,
        projected: 0,
        retryScheduled: 1,
      })
      .mockResolvedValueOnce({
        status: "completed",
        processed: 1,
        projected: 1,
        retryScheduled: 0,
      });
    const wait = vi.fn(() => Promise.resolve());

    await expect(
      drainAuthoritativeProjectionEvent({ runBatch }, "preview-commit-event", wait),
    ).resolves.toEqual({
      status: "completed",
      processed: 2,
      projected: 1,
      retryScheduled: 1,
    });
    expect(wait).toHaveBeenCalledWith(2_100);
    expect(runBatch).toHaveBeenCalledTimes(2);
  });

  it("BDD-SLO-217 remains bounded when projection keeps failing", async () => {
    const runBatch = vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        processed: 1,
        projected: 0,
        retryScheduled: 1,
      }),
    );
    const wait = vi.fn(() => Promise.resolve());

    await expect(
      drainAuthoritativeProjectionEvent({ runBatch }, "preview-commit-event", wait),
    ).resolves.toMatchObject({ processed: 3, projected: 0, retryScheduled: 3 });
    expect(runBatch).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 2_100);
    expect(wait).toHaveBeenNthCalledWith(2, 4_100);
  });
});
