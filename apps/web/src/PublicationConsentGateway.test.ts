import { describe, expect, it, vi } from "vitest";

import { createHttpPublicationConsentGateway } from "./PublicationConsentGateway";

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function response(status: number, body: unknown): Response {
  return { status, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

describe("HTTP publication consent gateway", () => {
  it("BDD-ISSUE-WEB-007 grants exact versioned audience without leaking proof in the body", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      response(201, {
        status: "ok",
        consent: {
          version: 1,
          state: "active",
          disclosureVersion: "reporter-content-v1",
          audience: "github:123",
        },
      }),
    );
    const gateway = createHttpPublicationConsentGateway(
      "https://api.example/",
      fetcher,
    );
    await expect(
      gateway.grant({
        operationId: "operation_1",
        reference: "Y7-2026-000001",
        proof: "secret-proof",
        disclosureVersion: "reporter-content-v1",
        audience: "github:123",
      }),
    ).resolves.toMatchObject({ status: "ok", consent: { version: 1 } });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "FeedbackProof secret-proof",
    });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        operationId: "operation_1",
        reference: "Y7-2026-000001",
        disclosureVersion: "reporter-content-v1",
        audience: "github:123",
      }),
    );
  });

  it("BDD-ISSUE-WEB-008 revokes without resending disclosure scope", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      response(200, {
        status: "ok",
        consent: {
          version: 2,
          state: "revoked",
          disclosureVersion: "reporter-content-v1",
          audience: "github:123",
        },
      }),
    );
    const gateway = createHttpPublicationConsentGateway(
      "https://api.example/",
      fetcher,
    );
    await gateway.revoke({
      operationId: "operation_2",
      reference: "Y7-2026-000001",
      proof: "secret-proof",
    });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ operationId: "operation_2", reference: "Y7-2026-000001" }),
    );
  });

  it.each([
    [404, "denied"],
    [409, "conflict"],
    [503, "retryable"],
  ] as const)("BDD-ISSUE-WEB-009 maps HTTP %i", async (code, status) => {
    const gateway = createHttpPublicationConsentGateway(
      "https://api.example/",
      vi.fn<Fetcher>().mockResolvedValue(response(code, {})),
    );
    await expect(
      gateway.revoke({ operationId: "o", reference: "r", proof: "p" }),
    ).resolves.toEqual({ status });
  });

  it("BDD-ISSUE-WEB-010 fails closed for malformed and unavailable responses", async () => {
    const malformed = createHttpPublicationConsentGateway(
      "https://api.example/",
      vi.fn<Fetcher>().mockResolvedValue(response(200, { status: "ok", consent: {} })),
    );
    await expect(
      malformed.revoke({ operationId: "o", reference: "r", proof: "p" }),
    ).resolves.toEqual({ status: "retryable" });
    const unavailable = createHttpPublicationConsentGateway(
      "https://api.example/",
      vi.fn<Fetcher>().mockRejectedValue(new Error("network unavailable")),
    );
    await expect(
      unavailable.revoke({ operationId: "o", reference: "r", proof: "p" }),
    ).resolves.toEqual({ status: "retryable" });
  });
});
