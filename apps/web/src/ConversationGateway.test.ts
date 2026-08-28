import { describe, expect, it, vi } from "vitest";

import { createHttpConversationGateway } from "./ConversationGateway";

const projection = {
  feedbackId: "feedback_1",
  state: "awaiting_reporter",
  messages: [
    {
      id: "message_1",
      actorKind: "workspace",
      audience: "reporter",
      occurredAt: "2026-08-28T12:00:00.000Z",
      content: "Which version?",
    },
  ],
  lifecycle: [
    {
      id: "event_1",
      priorState: "under_review",
      state: "awaiting_reporter",
      actorKind: "workspace",
      occurredAt: "2026-08-28T12:01:00.000Z",
      reason: "Version required",
      sequence: 3,
    },
  ],
};

describe("Reporter Conversation HTTP gateway", () => {
  it("retrieves a Reporter-only projection without putting proof in URL", async () => {
    const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok", conversation: projection }), {
          status: 200,
        }),
      ),
    );
    const gateway = createHttpConversationGateway(
      "https://api.example.test/v1",
      fetcher,
    );
    await expect(
      gateway.retrieve({
        feedbackId: "feedback_1",
        reference: "Y7-2026-ABC",
        proof: "secret-proof",
      }),
    ).resolves.toEqual({ status: "ok", value: projection });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).not.toContain("secret-proof");
    expect(init?.headers).toEqual(
      expect.objectContaining({ authorization: "FeedbackProof secret-proof" }),
    );
    expect(init?.cache).toBe("no-store");
  });

  it("submits answer and reopen commands with response-loss replay support", async () => {
    const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "replayed" }), { status: 200 }),
      ),
    );
    const gateway = createHttpConversationGateway("http://127.0.0.1:3000", fetcher);
    await expect(
      gateway.execute({
        feedbackId: "feedback_1",
        reference: "Y7-2026-ABC",
        proof: "proof",
        command: {
          kind: "reporter_answer",
          eventId: "event_2",
          expectedVersion: 3,
          reason: "Version 2.1",
        },
      }),
    ).resolves.toEqual({ status: "ok", value: "replayed" });
    const body = fetcher.mock.calls[0]?.[1].body;
    if (typeof body !== "string") throw new Error("expected JSON request body");
    expect(JSON.parse(body)).toMatchObject({
      reference: "Y7-2026-ABC",
      command: { kind: "reporter_answer", expectedVersion: 3 },
    });
  });

  it("fails closed for hidden notes, malformed facts, cross-feedback and errors", async () => {
    for (const conversation of [
      { ...projection, internalNotes: [] },
      { ...projection, feedbackId: "other" },
      { ...projection, state: "unknown" },
      {
        ...projection,
        messages: [{ ...projection.messages[0], audience: "workspace" }],
      },
      { ...projection, lifecycle: [{ ...projection.lifecycle[0], sequence: 1 }] },
    ]) {
      const gateway = createHttpConversationGateway("https://api.example.test", () =>
        Promise.resolve(
          new Response(JSON.stringify({ status: "ok", conversation }), {
            status: 200,
          }),
        ),
      );
      await expect(
        gateway.retrieve({
          feedbackId: "feedback_1",
          reference: "ref",
          proof: "proof",
        }),
      ).resolves.toEqual({ status: "retryable" });
    }
    for (const [statusCode, status] of [
      [404, "denied"],
      [400, "invalid"],
      [409, "conflict"],
      [503, "retryable"],
    ] as const) {
      const gateway = createHttpConversationGateway("https://api.example.test", () =>
        Promise.resolve(new Response(null, { status: statusCode })),
      );
      await expect(
        gateway.execute({
          feedbackId: "feedback_1",
          reference: "ref",
          proof: "proof",
          command: {
            kind: "append_message",
            eventId: "message_1",
            audience: "reporter",
            content: "Answer",
          },
        }),
      ).resolves.toEqual({ status });
    }
  });

  it("rejects unsafe endpoints and malformed success envelopes", async () => {
    expect(() =>
      createHttpConversationGateway("https://api.example.test/"),
    ).not.toThrow();
    expect(() => createHttpConversationGateway("http://localhost:3000")).not.toThrow();
    expect(() => createHttpConversationGateway("http://example.test")).toThrow(
      "CONVERSATION_ENDPOINT_INVALID",
    );
    expect(() =>
      createHttpConversationGateway("https://user:password@example.test"),
    ).toThrow("CONVERSATION_ENDPOINT_INVALID");
    const malformed = createHttpConversationGateway("https://api.example.test", () =>
      Promise.resolve(new Response(JSON.stringify({ status: "ok" }), { status: 200 })),
    );
    await expect(
      malformed.retrieve({
        feedbackId: "feedback_1",
        reference: "ref",
        proof: "proof",
      }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      malformed.execute({
        feedbackId: "feedback_1",
        reference: "ref",
        proof: "proof",
        command: {
          kind: "append_message",
          eventId: "message_1",
          audience: "reporter",
          content: "Answer",
        },
      }),
    ).resolves.toEqual({ status: "retryable" });

    for (const conversation of [
      { ...projection, feedbackId: "" },
      {
        ...projection,
        messages: [{ ...projection.messages[0], actorKind: "unknown" }],
      },
      {
        ...projection,
        lifecycle: [{ ...projection.lifecycle[0], actorKind: "unknown" }],
      },
    ]) {
      const invalid = createHttpConversationGateway("https://api.example.test", () =>
        Promise.resolve(
          new Response(JSON.stringify({ status: "ok", conversation }), {
            status: 200,
          }),
        ),
      );
      await expect(
        invalid.retrieve({
          feedbackId: "feedback_1",
          reference: "ref",
          proof: "proof",
        }),
      ).resolves.toEqual({ status: "retryable" });
    }
    for (const [status, body] of [
      [404, null],
      [200, []],
      [200, { status: "unexpected" }],
    ] as const) {
      const invalid = createHttpConversationGateway("https://api.example.test", () =>
        Promise.resolve(new Response(JSON.stringify(body), { status })),
      );
      await expect(
        invalid.retrieve({
          feedbackId: "feedback_1",
          reference: "ref",
          proof: "proof",
        }),
      ).resolves.toMatchObject({
        status: status === 404 ? "denied" : "retryable",
      });
    }
  });
});
