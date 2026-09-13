import { describe, expect, it, vi } from "vitest";

import { retryAppwriteAdminCall } from "./appwrite-admin-retry.js";

describe("retryAppwriteAdminCall", () => {
  it("BDD-REL-421 retries a transient Appwrite administration timeout", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ code: 503 })
      .mockResolvedValue("configured");
    const wait = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(retryAppwriteAdminCall(operation, { wait })).resolves.toBe(
      "configured",
    );
    expect(operation).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1_000);
  });

  it("BDD-REL-421 uses the production backoff when no test clock is injected", async () => {
    vi.useFakeTimers();
    try {
      const operation = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce({ code: 503 })
        .mockResolvedValue("configured");
      const result = retryAppwriteAdminCall(operation);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(result).resolves.toBe("configured");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([429, 502, 504])("BDD-REL-422 retries status %s", async (code) => {
    const operation = vi.fn().mockRejectedValueOnce({ code }).mockResolvedValue("ok");
    await expect(
      retryAppwriteAdminCall(operation, { wait: () => Promise.resolve() }),
    ).resolves.toBe("ok");
  });

  it("BDD-REL-423 preserves terminal failures without retrying", async () => {
    const denied = { code: 401 };
    const operation = vi.fn().mockRejectedValue(denied);
    await expect(
      retryAppwriteAdminCall(operation, { wait: () => Promise.resolve() }),
    ).rejects.toBe(denied);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { code: "503" }])(
    "BDD-REL-423 rejects a non-Appwrite failure without retrying",
    async (failure) => {
      const operation = vi.fn().mockRejectedValue(failure);
      await expect(
        retryAppwriteAdminCall(operation, { wait: () => Promise.resolve() }),
      ).rejects.toBe(failure);
      expect(operation).toHaveBeenCalledTimes(1);
    },
  );

  it("BDD-REL-424 stops after the bounded retry budget", async () => {
    const unavailable = { code: 503 };
    const operation = vi.fn().mockRejectedValue(unavailable);
    const wait = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await expect(retryAppwriteAdminCall(operation, { attempts: 3, wait })).rejects.toBe(
      unavailable,
    );
    expect(operation).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
});
