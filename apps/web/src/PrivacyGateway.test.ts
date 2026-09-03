import { describe, expect, it, vi } from "vitest";

import { createHttpPrivacyGateway } from "./PrivacyGateway";

const input = {
  operationId: "operation_1",
  feedbackId: "feedback_1",
  reference: "Y7-2026-000001",
  proof: "proof_secret",
  reasonCode: "reporter_request" as const,
};

describe("privacy HTTP gateway", () => {
  it("BDD-PRIV-WEB-001 keeps proof in a no-store POST body", async () => {
    const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ok",
            result: {
              disposition: "applied",
              revision: 1,
              purgeEligibleAt: "2026-10-03T00:00:00.000Z",
            },
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      createHttpPrivacyGateway("https://api.example.test", fetcher).requestDeletion(
        input,
      ),
    ).resolves.toEqual({
      status: "ok",
      disposition: "applied",
      revision: 1,
      purgeEligibleAt: "2026-10-03T00:00:00.000Z",
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.example.test/v1/feedback/privacy");
    expect(url).not.toContain(input.proof);
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    expect(init?.body).toContain(input.proof);
  });

  it.each([
    [404, "denied"],
    [409, "conflict"],
    [503, "retryable"],
  ] as const)("maps HTTP %s without disclosure", async (code, status) => {
    const gateway = createHttpPrivacyGateway("https://api.example.test", () =>
      Promise.resolve(new Response("{}", { status: code })),
    );
    await expect(gateway.requestDeletion(input)).resolves.toEqual({ status });
  });

  it("fails closed for malformed success and network failure", async () => {
    for (const body of [
      null,
      {},
      { status: "invalid" },
      { status: "ok" },
      { status: "ok", result: {} },
      { status: "ok", result: { disposition: "invented" } },
      { status: "ok", result: { disposition: "replayed", revision: 0 } },
      {
        status: "ok",
        result: { disposition: "replayed", revision: 1, purgeEligibleAt: "invalid" },
      },
    ]) {
      const malformed = createHttpPrivacyGateway("https://api.example.test", () =>
        Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
      );
      await expect(malformed.requestDeletion(input)).resolves.toEqual({
        status: "retryable",
      });
    }
    const failed = createHttpPrivacyGateway("https://api.example.test", () =>
      Promise.reject(new Error("network")),
    );
    await expect(failed.requestDeletion(input)).resolves.toEqual({
      status: "retryable",
    });
  });
});
