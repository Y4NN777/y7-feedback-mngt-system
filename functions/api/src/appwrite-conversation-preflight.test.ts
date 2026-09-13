import { describe, expect, it, vi } from "vitest";

import type { AuthoritativeCommit } from "@y7-feedback/domain";

import { createAppwriteConversationPreflight } from "./appwrite-conversation-preflight.js";
import { createNodeAppwriteConversationPreflight } from "./appwrite-conversation-preflight.js";

const schema = {
  databaseId: "primary",
  feedbackTableId: "feedback",
  lifecycleTableId: "lifecycle",
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  orderDesc: (attribute: string) => `desc:${attribute}`,
  limit: (value: number) => `limit:${String(value)}`,
};
const base = {
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  payloadDigest: "digest_0123456789abcdef",
  locale: "fr" as const,
};

function setup(
  feedback: unknown = {
    $id: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    state: "received",
  },
  rows: readonly unknown[] = [
    { $id: "life_1", feedbackId: "feedback_1", sequence: 1, state: "received" },
  ],
) {
  const getRow = vi.fn(() => Promise.resolve(feedback));
  const listRows = vi.fn(() => Promise.resolve({ rows }));
  return {
    preflight: createAppwriteConversationPreflight(
      { getRow, listRows },
      schema,
      queries,
    ),
    getRow,
    listRows,
  };
}

describe("ADR-015 conversation preflight", () => {
  it("BDD-SLO-500 rejects malformed or overlapping schema authority", () => {
    expect(() =>
      createAppwriteConversationPreflight(
        { getRow: vi.fn(), listRows: vi.fn() },
        { ...schema, lifecycleTableId: schema.feedbackTableId },
        queries,
      ),
    ).toThrow("APPWRITE_CONVERSATION_PREFLIGHT_SCHEMA_INVALID");
  });

  it("BDD-SLO-501 validates append commands without lifecycle reads", async () => {
    const target = setup();
    await expect(
      target.preflight.plan({
        ...base,
        command: {
          kind: "append_message",
          eventId: "event_1",
          actorId: "user_1",
          actorKind: "workspace",
          occurredAt: "2026-09-13T04:30:00.000Z",
          audience: "reporter",
          content: "Question",
        },
      }),
    ).resolves.toEqual({
      result: {
        status: "applied",
        feedbackId: "feedback_1",
        action: "append_message",
      },
      workspaceId: "workspace_1",
      projectId: "project_1",
    });
    expect(target.listRows).not.toHaveBeenCalled();
  });

  it("BDD-SLO-502 plans a lifecycle transition from authoritative normalized state", async () => {
    const target = setup();
    await expect(
      target.preflight.plan({
        ...base,
        command: {
          kind: "start_review",
          eventId: "event_2",
          actorId: "user_1",
          actorKind: "workspace",
          occurredAt: "2026-09-13T04:31:00.000Z",
          expectedVersion: 1,
          reason: "Triage",
        },
      }),
    ).resolves.toEqual({
      result: {
        status: "applied",
        feedbackId: "feedback_1",
        action: "start_review",
        state: "under_review",
        version: 2,
      },
      workspaceId: "workspace_1",
      projectId: "project_1",
    });
    expect(target.listRows).toHaveBeenCalledWith(
      expect.objectContaining({
        queries: ["equal:feedbackId:feedback_1", "desc:sequence", "limit:2"],
      }),
    );
  });

  it("BDD-SLO-503 preserves stale and invalid transition outcomes", async () => {
    const target = setup();
    const transition = (expectedVersion: number, kind: "start_review" | "close") =>
      target.preflight.plan({
        ...base,
        command: {
          kind,
          eventId: `event_${String(expectedVersion)}_${kind}`,
          actorId: "user_1",
          actorKind: "workspace",
          occurredAt: "2026-09-13T04:32:00.000Z",
          expectedVersion,
          reason: "Transition",
        },
      });

    await expect(transition(2, "start_review")).rejects.toMatchObject({
      code: "ERR-CONV-STALE",
    });
    await expect(transition(1, "close")).rejects.toMatchObject({
      code: "ERR-CONV-INVALID",
    });
  });

  it("BDD-SLO-504 denies cross-scope or malformed Feedback authority", async () => {
    const target = setup();
    await expect(
      target.preflight.plan({
        ...base,
        workspaceId: "workspace_other",
        command: {
          kind: "append_internal_note",
          eventId: "event_3",
          actorId: "user_1",
          actorKind: "workspace",
          occurredAt: "2026-09-13T04:33:00.000Z",
          content: "Private",
        },
      }),
    ).rejects.toMatchObject({
      code: "ERR-CONV-DENIED",
    });
  });

  it("BDD-SLO-505 fails closed for missing or inconsistent lifecycle facts", async () => {
    const noFacts = setup(undefined, []);
    await expect(
      noFacts.preflight.plan({
        ...base,
        command: {
          kind: "start_review",
          eventId: "event_4",
          actorId: "user_1",
          actorKind: "workspace",
          occurredAt: "2026-09-13T04:34:00.000Z",
          expectedVersion: 1,
          reason: "Triage",
        },
      }),
    ).resolves.toMatchObject({ result: { version: 2 } });

    const malformed = setup(undefined, [
      { $id: "life_1", feedbackId: "other", sequence: 1, state: "received" },
    ]);
    await expect(
      malformed.preflight.plan({
        ...base,
        command: {
          kind: "start_review",
          eventId: "event_5",
          actorId: "user_1",
          actorKind: "workspace",
          occurredAt: "2026-09-13T04:35:00.000Z",
          expectedVersion: 1,
          reason: "Triage",
        },
      }),
    ).rejects.toMatchObject({ code: "ERR-CONV-RETRYABLE" });

    const excessive = setup(undefined, [{}, {}, {}]);
    await expect(
      excessive.preflight.plan({
        ...base,
        command: {
          kind: "start_review",
          eventId: "event_6",
          actorId: "user_1",
          actorKind: "workspace",
          occurredAt: "2026-09-13T04:36:00.000Z",
          expectedVersion: 1,
          reason: "Triage",
        },
      }),
    ).rejects.toMatchObject({ code: "ERR-CONV-RETRYABLE" });
  });

  it("BDD-SLO-506 adapts the official Node TablesDB boundary", async () => {
    const getRow = vi.fn(() =>
      Promise.resolve({
        $id: "feedback_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        state: "received",
      }),
    );
    const listRows = vi.fn(() =>
      Promise.resolve({
        rows: [
          {
            $id: "life_1",
            feedbackId: "feedback_1",
            sequence: 1,
            state: "received",
          },
        ],
      }),
    );
    const preflight = createNodeAppwriteConversationPreflight(
      { getRow, listRows } as never,
      schema,
    );

    await preflight.plan({
      ...base,
      command: {
        kind: "start_review",
        eventId: "event_7",
        actorId: "user_1",
        actorKind: "workspace",
        occurredAt: "2026-09-13T04:37:00.000Z",
        expectedVersion: 1,
        reason: "Triage",
      },
    });
    expect(getRow).toHaveBeenCalledOnce();
    expect(listRows).toHaveBeenCalledOnce();
  });

  it("BDD-SLO-509 overlays ordered pending lifecycle authority", async () => {
    const target = setup();
    const pendingInput = {
      ...base,
      command: {
        kind: "start_review" as const,
        eventId: "event_pending",
        actorId: "user_1",
        actorKind: "workspace" as const,
        occurredAt: "2026-09-13T04:38:00.000Z",
        expectedVersion: 1,
        reason: "Triage",
      },
    };
    const commits = { list: vi.fn(() => Promise.resolve([{} as AuthoritativeCommit])) };
    const envelope = {
      open: vi.fn(() => ({
        input: pendingInput,
        result: {
          status: "applied" as const,
          feedbackId: "feedback_1",
          action: "start_review" as const,
          state: "under_review" as const,
          version: 2,
        },
      })),
    };
    const preflight = createAppwriteConversationPreflight(
      { getRow: target.getRow, listRows: target.listRows },
      schema,
      queries,
      { commits, envelope },
    );

    await expect(
      preflight.plan({
        ...base,
        command: {
          kind: "request_clarification",
          eventId: "event_next",
          actorId: "user_1",
          actorKind: "workspace",
          occurredAt: "2026-09-13T04:39:00.000Z",
          expectedVersion: 2,
          reason: "Need details",
        },
      }),
    ).resolves.toMatchObject({
      result: { state: "awaiting_reporter", version: 3 },
    });
  });

  it("BDD-SLO-510 ignores pending messages and already normalized lifecycle commits", async () => {
    const target = setup();
    const envelope = {
      open: vi
        .fn()
        .mockReturnValueOnce({
          input: {
            ...base,
            command: {
              kind: "append_message",
              eventId: "message_pending",
              actorId: "user_1",
              actorKind: "workspace",
              occurredAt: "2026-09-13T04:38:00.000Z",
              audience: "reporter",
              content: "Question",
            },
          },
          result: {
            status: "applied",
            feedbackId: "feedback_1",
            action: "append_message",
          },
        })
        .mockReturnValueOnce({
          input: {
            ...base,
            command: {
              kind: "start_review",
              eventId: "normalized",
              actorId: "user_1",
              actorKind: "workspace",
              occurredAt: "2026-09-13T04:38:01.000Z",
              expectedVersion: 1,
              reason: "Triage",
            },
          },
          result: {
            status: "applied",
            feedbackId: "feedback_1",
            action: "start_review",
            state: "received",
            version: 1,
          },
        }),
    };
    const preflight = createAppwriteConversationPreflight(
      { getRow: target.getRow, listRows: target.listRows },
      schema,
      queries,
      {
        commits: {
          list: () =>
            Promise.resolve([{} as AuthoritativeCommit, {} as AuthoritativeCommit]),
        },
        envelope,
      },
    );

    await expect(
      preflight.plan({
        ...base,
        command: {
          kind: "start_review",
          eventId: "next",
          actorId: "user_1",
          actorKind: "workspace",
          occurredAt: "2026-09-13T04:39:00.000Z",
          expectedVersion: 1,
          reason: "Triage",
        },
      }),
    ).resolves.toMatchObject({ result: { version: 2 } });
  });

  it.each([
    [
      "mismatched projection",
      "under_review",
      9,
      "AUTHORITATIVE_CONVERSATION_PENDING_CONFLICT",
    ],
    ["invalid transition", "closed", 2, "AUTHORITATIVE_CONVERSATION_PENDING_INVALID"],
  ] as const)("BDD-SLO-511 rejects %s", async (_name, state, version, message) => {
    const target = setup();
    const preflight = createAppwriteConversationPreflight(
      { getRow: target.getRow, listRows: target.listRows },
      schema,
      queries,
      {
        commits: { list: () => Promise.resolve([{} as AuthoritativeCommit]) },
        envelope: {
          open: () => ({
            input: {
              ...base,
              command: {
                kind: state === "closed" ? "close" : "start_review",
                eventId: "pending",
                actorId: "user_1",
                actorKind: "workspace",
                occurredAt: "2026-09-13T04:38:00.000Z",
                expectedVersion: 1,
                reason: "Transition",
              },
            },
            result: {
              status: "applied",
              feedbackId: "feedback_1",
              action: state === "closed" ? "close" : "start_review",
              state,
              version,
            },
          }),
        },
      },
    );

    await expect(
      preflight.plan({
        ...base,
        command: {
          kind: "start_review",
          eventId: "next",
          actorId: "user_1",
          actorKind: "workspace",
          occurredAt: "2026-09-13T04:39:00.000Z",
          expectedVersion: 1,
          reason: "Triage",
        },
      }),
    ).rejects.toThrow(message);
  });
});
