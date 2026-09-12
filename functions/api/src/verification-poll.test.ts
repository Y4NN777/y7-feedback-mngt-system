import { describe, expect, it, vi } from "vitest";

import { pollVerification, retryVerificationOperation } from "./verification-poll.js";

describe("pollVerification", () => {
  it("returns immediately when the first observation is accepted", async () => {
    const attempt = vi.fn().mockResolvedValue("completed");
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(
      pollVerification({
        attempt,
        accept: (value) => value === "completed",
        maximumAttempts: 3,
        intervalMs: 1_000,
        delay,
      }),
    ).resolves.toBe("completed");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("retries bounded asynchronous observations until one is accepted", async () => {
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("missing")
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("completed");
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(
      pollVerification({
        attempt,
        accept: (value) => value === "completed",
        maximumAttempts: 3,
        intervalMs: 250,
        delay,
      }),
    ).resolves.toBe("completed");
    expect(delay).toHaveBeenNthCalledWith(1, 250);
    expect(delay).toHaveBeenNthCalledWith(2, 250);
  });

  it("returns undefined after the configured attempt limit", async () => {
    const attempt = vi.fn().mockResolvedValue("pending");
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(
      pollVerification({
        attempt,
        accept: () => false,
        maximumAttempts: 2,
        intervalMs: 10,
        delay,
      }),
    ).resolves.toBeUndefined();
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("uses its default delay between attempts", async () => {
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("completed");

    await expect(
      pollVerification({
        attempt,
        accept: (value) => value === "completed",
        maximumAttempts: 2,
        intervalMs: 0,
      }),
    ).resolves.toBe("completed");
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});

describe("retryVerificationOperation", () => {
  it("retries a transient real-service failure and returns the successful result", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("completed");
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(
      retryVerificationOperation({
        operation,
        maximumAttempts: 3,
        intervalMs: 250,
        delay,
      }),
    ).resolves.toBe("completed");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(250);
  });

  it("rethrows after the bounded attempt limit", async () => {
    const failure = new Error("persistent");
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(failure);

    await expect(
      retryVerificationOperation({
        operation,
        maximumAttempts: 2,
        intervalMs: 0,
        delay: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
