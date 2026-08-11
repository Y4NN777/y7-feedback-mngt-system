import { describe, expect, it, vi } from "vitest";

import type { ValidatedFeedbackDraft } from "@y7-feedback/domain";

import { createHttpIntakeGateway } from "./IntakeGateway";

const draft: ValidatedFeedbackDraft = {
  projectId: "browser-forged-project",
  workspaceId: "browser-forged-workspace",
  type: "bug",
  originalSource: { type: "bug", problem: "Broken balance" },
  reporter: {
    kind: "contact",
    value: "person@example.test",
    purpose: "Browser-local purpose",
  },
  context: [
    {
      name: "applicationVersion",
      value: "2.4.1",
      purpose: "Browser-local purpose",
      source: "public",
      trust: "unverified",
    },
  ],
  attachmentNames: [],
  derivedClassification: null,
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("public intake HTTP gateway", () => {
  it("BDD-WEB-INTAKE-HTTP-001 sends only public claims and parses acceptance", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        response(201, {
          status: "accepted",
          reference: "Y7-2026-000001",
          accessProof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
          replayed: false,
        }),
      ),
    );
    const gateway = createHttpIntakeGateway("https://feedback-api.example/", fetcher);

    await expect(
      gateway.accept({
        projectSlug: "wisemoney",
        clientOperationId: "123e4567-e89b-42d3-a456-426614174000",
        locale: "fr",
        draft,
      }),
    ).resolves.toEqual({
      status: "accepted",
      reference: "Y7-2026-000001",
      accessProof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
      replayed: false,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://feedback-api.example/v1/projects/wisemoney/feedback",
      {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: "123e4567-e89b-42d3-a456-426614174000",
          locale: "fr",
          feedback: {
            type: "bug",
            source: { type: "bug", problem: "Broken balance" },
            reporter: { kind: "contact", value: "person@example.test" },
            context: [{ name: "applicationVersion", value: "2.4.1" }],
            attachmentNames: [],
          },
        }),
      },
    );
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("browser-forged");
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("Browser-local purpose");
  });

  it("maps conflict, invalid, dependency, malformed success, and network failure", async () => {
    const cases = [
      [response(409, {}), { status: "conflict" }],
      [response(400, {}), { status: "invalid" }],
      [response(503, {}), { status: "retryable" }],
      [response(201, { status: "accepted" }), { status: "retryable" }],
    ] as const;
    for (const [serverResponse, expected] of cases) {
      const gateway = createHttpIntakeGateway("https://feedback-api.example", () =>
        Promise.resolve(serverResponse),
      );
      await expect(
        gateway.accept({
          projectSlug: "wisemoney",
          clientOperationId: "123e4567-e89b-42d3-a456-426614174000",
          locale: "en",
          draft: { ...draft, reporter: { kind: "unidentified" }, context: [] },
        }),
      ).resolves.toEqual(expected);
    }

    const failed = createHttpIntakeGateway("https://feedback-api.example", () =>
      Promise.reject(new Error("offline")),
    );
    await expect(
      failed.accept({
        projectSlug: "wisemoney",
        clientOperationId: "123e4567-e89b-42d3-a456-426614174000",
        locale: "fr",
        draft,
      }),
    ).resolves.toEqual({ status: "retryable" });
  });

  it("rejects an unsafe API endpoint before a request", () => {
    expect(() => createHttpIntakeGateway("http://remote.example", vi.fn())).toThrow(
      "INTAKE_ENDPOINT_INVALID",
    );
  });
});
