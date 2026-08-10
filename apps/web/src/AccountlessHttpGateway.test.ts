import { describe, expect, it, vi } from "vitest";

import { createHttpAccountlessGateway } from "./AccountlessHttpGateway";

const view = {
  feedbackId: "feedback-1",
  reference: "Y7-2026-000001",
  originalSource: { type: "bug", problem: "Broken balance" },
  currentSource: { type: "bug", problem: "Broken balance" },
  currentState: "received",
  history: [],
  messages: [],
  attachments: [],
  sourceRevisions: [],
  deletionRequests: [],
};

const populatedView = {
  ...view,
  originalSource: {
    type: "bug",
    problem: "Broken balance",
    expectedBehavior: "Fresh balance",
    observedBehavior: "Stale balance",
    reproductionSteps: "Open dashboard",
  },
  currentSource: {
    type: "suggestion",
    proposal: "Add refresh",
    rationale: "Avoid stale state",
    usageContext: "Dashboard",
  },
  currentState: "awaiting_reporter",
  history: [
    {
      id: "history-1",
      kind: "state_changed",
      audience: "reporter",
      actor: "system",
      occurredAt: "2026-08-10T12:00:00.000Z",
      detail: "Need clarification",
    },
  ],
  messages: [
    {
      id: "message-1",
      audience: "workspace",
      actor: "maintainer",
      occurredAt: "2026-08-10T12:01:00.000Z",
      content: "Please clarify",
    },
  ],
  attachments: [{ id: "attachment-1", audience: "reporter", name: "evidence.png" }],
  sourceRevisions: [
    {
      id: "revision-1",
      priorSource: {
        type: "review",
        experience: "Slow",
        appreciation: "Clear",
      },
      source: { type: "bug", problem: "Updated issue" },
      actor: "reporter",
      occurredAt: "2026-08-10T12:02:00.000Z",
    },
  ],
  deletionRequests: [
    {
      id: "deletion-1",
      status: "received",
      reason: "No longer needed",
      actor: "reporter",
      occurredAt: "2026-08-10T12:03:00.000Z",
    },
  ],
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("accountless HTTP gateway", () => {
  it("BDD-WEB-ACCESS-HTTP-001 keeps proof in authorization and parses the safe view", async () => {
    const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(response(200, { status: "ok", feedback: view })),
    );
    const gateway = createHttpAccountlessGateway(
      "https://feedback-api.example/",
      fetcher,
    );

    await expect(
      gateway.retrieve({
        reference: "Y7-2026-000001",
        proof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
      }),
    ).resolves.toEqual({ status: "ok", view });
    expect(fetcher).toHaveBeenCalledWith(
      "https://feedback-api.example/v1/feedback/retrieve",
      {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: {
          "content-type": "application/json",
          authorization:
            "FeedbackProof proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
        },
        body: JSON.stringify({ reference: "Y7-2026-000001" }),
      },
    );
    const request = JSON.stringify(fetcher.mock.calls);
    expect(request).not.toContain("/proof_");
    expect(fetcher.mock.calls[0]?.[1].body).toBe(
      JSON.stringify({ reference: "Y7-2026-000001" }),
    );

    const populated = createHttpAccountlessGateway("http://127.0.0.1:8787/", () =>
      Promise.resolve(response(200, { status: "ok", feedback: populatedView })),
    );
    await expect(
      populated.retrieve({ reference: "reference", proof: "proof" }),
    ).resolves.toEqual({ status: "ok", view: populatedView });
    const suggestionWithoutContext = {
      ...view,
      currentSource: {
        type: "suggestion",
        proposal: "Export",
        rationale: "Reporting",
      },
    };
    await expect(
      createHttpAccountlessGateway("https://feedback-api.example", () =>
        Promise.resolve(
          response(200, { status: "ok", feedback: suggestionWithoutContext }),
        ),
      ).retrieve({ reference: "reference", proof: "proof" }),
    ).resolves.toEqual({ status: "ok", view: suggestionWithoutContext });
  });

  it("maps neutral denial, dependency failure, malformed projection, and network failure", async () => {
    const cases = [
      [response(404, {}), { status: "denied" }],
      [response(503, {}), { status: "retryable" }],
      [
        response(200, { status: "ok", feedback: { ...view, currentState: "secret" } }),
        { status: "retryable" },
      ],
      [
        response(200, { status: "ok", feedback: { ...view, internalNotes: [] } }),
        { status: "retryable" },
      ],
      [response(200, { status: "accepted", feedback: view }), { status: "retryable" }],
      [
        response(200, { status: "ok", feedback: { ...view, feedbackId: " " } }),
        { status: "retryable" },
      ],
      [
        response(200, { status: "ok", feedback: { ...view, history: [null] } }),
        { status: "retryable" },
      ],
      [
        response(200, {
          status: "ok",
          feedback: {
            ...view,
            originalSource: { type: "unknown" },
          },
        }),
        { status: "retryable" },
      ],
      [
        response(200, {
          status: "ok",
          feedback: {
            ...view,
            history: [
              {
                id: "history",
                kind: "event",
                audience: "private",
                actor: "actor",
                occurredAt: "now",
                detail: "detail",
              },
            ],
          },
        }),
        { status: "retryable" },
      ],
      [
        response(200, { status: "ok", feedback: { ...view, messages: {} } }),
        { status: "retryable" },
      ],
      [
        response(200, { status: "ok", feedback: { ...view, messages: [null] } }),
        { status: "retryable" },
      ],
      [
        response(200, { status: "ok", feedback: { ...view, attachments: [null] } }),
        { status: "retryable" },
      ],
      [
        response(200, { status: "ok", feedback: { ...view, sourceRevisions: [null] } }),
        { status: "retryable" },
      ],
      [
        response(200, {
          status: "ok",
          feedback: { ...view, deletionRequests: [{ status: "done" }] },
        }),
        { status: "retryable" },
      ],
    ] as const;
    for (const [serverResponse, expected] of cases) {
      const gateway = createHttpAccountlessGateway("https://feedback-api.example", () =>
        Promise.resolve(serverResponse),
      );
      await expect(
        gateway.retrieve({ reference: "reference", proof: "proof" }),
      ).resolves.toEqual(expected);
    }

    const failed = createHttpAccountlessGateway("https://feedback-api.example", () =>
      Promise.reject(new Error("offline")),
    );
    await expect(
      failed.retrieve({ reference: "reference", proof: "proof" }),
    ).resolves.toEqual({ status: "retryable" });
  });

  it("rejects an unsafe API endpoint before a request", () => {
    expect(() =>
      createHttpAccountlessGateway("http://remote.example", vi.fn()),
    ).toThrow("ACCESS_ENDPOINT_INVALID");
  });
});
