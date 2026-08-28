import { describe, expect, it } from "vitest";

import {
  ConversationLifecycleError,
  appendConversationEntry,
  planLifecycleTransition,
  projectConversationForReporter,
  type ConversationState,
  type FeedbackLifecycle,
} from "./conversation-lifecycle";

const lifecycle: FeedbackLifecycle = {
  feedbackId: "feedback_1",
  state: "received",
  version: 1,
};

describe("Feedback lifecycle policy", () => {
  it("BDD-LIFE-001 accepts the exact review, clarification, resolution and closure path", () => {
    const start = planLifecycleTransition(lifecycle, {
      kind: "start_review",
      eventId: "event_1",
      expectedVersion: 1,
      actorId: "maintainer_1",
      actorKind: "workspace",
      occurredAt: "2026-08-28T12:00:00.000Z",
      reason: "Triage started",
    });
    expect(start.next).toMatchObject({ state: "under_review", version: 2 });
    const clarification = planLifecycleTransition(start.next, {
      kind: "request_clarification",
      eventId: "event_2",
      expectedVersion: 2,
      actorId: "maintainer_1",
      actorKind: "workspace",
      occurredAt: "2026-08-28T12:01:00.000Z",
      reason: "Version required",
    });
    expect(clarification.next.state).toBe("awaiting_reporter");
    const answer = planLifecycleTransition(clarification.next, {
      kind: "reporter_answer",
      eventId: "event_3",
      expectedVersion: 3,
      actorId: "reporter_1",
      actorKind: "reporter",
      occurredAt: "2026-08-28T12:02:00.000Z",
      reason: "Version supplied",
    });
    expect(answer.next.state).toBe("under_review");
    const resolved = planLifecycleTransition(answer.next, {
      kind: "resolve",
      eventId: "event_4",
      expectedVersion: 4,
      actorId: "maintainer_1",
      actorKind: "workspace",
      occurredAt: "2026-08-28T12:03:00.000Z",
      reason: "Fixed in release 2",
    });
    expect(resolved.next.state).toBe("resolved");
    const closed = planLifecycleTransition(resolved.next, {
      kind: "close",
      eventId: "event_5",
      expectedVersion: 5,
      actorId: "maintainer_1",
      actorKind: "workspace",
      occurredAt: "2026-08-28T12:04:00.000Z",
      reason: "Reporter notified",
    });
    expect(closed.next).toEqual({
      feedbackId: "feedback_1",
      state: "closed",
      version: 6,
    });
    expect(closed.history).toMatchObject({
      priorState: "resolved",
      state: "closed",
      sequence: 6,
      actorKind: "workspace",
    });
  });

  it("BDD-LIFE-002 allows a Reporter to reopen only a closed Feedback", () => {
    const closed = { ...lifecycle, state: "closed" as const, version: 6 };
    const reopened = planLifecycleTransition(closed, {
      kind: "reopen",
      eventId: "event_6",
      expectedVersion: 6,
      actorId: "reporter_1",
      actorKind: "reporter",
      occurredAt: "2026-08-28T12:05:00.000Z",
      reason: "Issue still occurs",
    });
    expect(reopened.next).toMatchObject({ state: "under_review", version: 7 });
    expect(() =>
      planLifecycleTransition(lifecycle, {
        kind: "reopen",
        eventId: "event_7",
        expectedVersion: 1,
        actorId: "reporter_1",
        actorKind: "reporter",
        occurredAt: "2026-08-28T12:06:00.000Z",
        reason: "Invalid early reopen",
      }),
    ).toThrow(new ConversationLifecycleError("ERR-LIFECYCLE-TRANSITION-INVALID"));
  });

  it("BDD-LIFE-003 rejects stale, unauthorized, no-op and malformed transitions", () => {
    const valid = {
      kind: "start_review" as const,
      eventId: "event_1",
      expectedVersion: 1,
      actorId: "maintainer_1",
      actorKind: "workspace" as const,
      occurredAt: "2026-08-28T12:00:00.000Z",
      reason: "Triage started",
    };
    for (const [command, code] of [
      [{ ...valid, expectedVersion: 2 }, "ERR-LIFECYCLE-STALE"],
      [{ ...valid, actorKind: "reporter" }, "ERR-LIFECYCLE-DENIED"],
      [{ ...valid, reason: " " }, "ERR-LIFECYCLE-COMMAND-INVALID"],
    ] as const) {
      expect(() => planLifecycleTransition(lifecycle, command)).toThrow(
        new ConversationLifecycleError(code),
      );
    }
    for (const version of [0, Number.NaN]) {
      expect(() => planLifecycleTransition({ ...lifecycle, version }, valid)).toThrow(
        new ConversationLifecycleError("ERR-LIFECYCLE-COMMAND-INVALID"),
      );
    }
  });
});

describe("Conversation audience policy", () => {
  const state: ConversationState = {
    feedbackId: "feedback_1",
    messages: [],
    internalNotes: [],
  };

  it("BDD-CONV-001 appends attributable Reporter-visible Messages", () => {
    const result = appendConversationEntry(state, {
      kind: "append_message",
      eventId: "message_1",
      actorId: "maintainer_1",
      actorKind: "workspace",
      audience: "reporter",
      occurredAt: "2026-08-28T12:00:00.000Z",
      content: "Which version is affected?",
    });
    expect(result.status).toBe("appended");
    expect(result.state.messages).toEqual([
      {
        id: "message_1",
        actorId: "maintainer_1",
        actorKind: "workspace",
        audience: "reporter",
        occurredAt: "2026-08-28T12:00:00.000Z",
        content: "Which version is affected?",
      },
    ]);
  });

  it("BDD-CONV-002 keeps Internal Notes structurally absent from Reporter projection", () => {
    const withNote = appendConversationEntry(state, {
      kind: "append_internal_note",
      eventId: "note_1",
      actorId: "maintainer_1",
      actorKind: "workspace",
      occurredAt: "2026-08-28T12:00:00.000Z",
      content: "Private reproduction detail",
    }).state;
    expect(withNote.internalNotes).toHaveLength(1);
    expect(projectConversationForReporter(withNote)).toEqual({
      feedbackId: "feedback_1",
      messages: [],
    });
    expect(JSON.stringify(projectConversationForReporter(withNote))).not.toContain(
      "Private reproduction detail",
    );
  });

  it("BDD-CONV-003 makes audience conversion impossible and denies Reporter notes", () => {
    const message = appendConversationEntry(state, {
      kind: "append_message",
      eventId: "event_1",
      actorId: "reporter_1",
      actorKind: "reporter",
      audience: "reporter",
      occurredAt: "2026-08-28T12:00:00.000Z",
      content: "Version 2.1",
    }).state;
    expect(() =>
      appendConversationEntry(message, {
        kind: "append_message",
        eventId: "event_1",
        actorId: "reporter_1",
        actorKind: "reporter",
        audience: "workspace",
        occurredAt: "2026-08-28T12:00:00.000Z",
        content: "Version 2.1",
      }),
    ).toThrow(new ConversationLifecycleError("ERR-CONVERSATION-ID-CONFLICT"));
    expect(() =>
      appendConversationEntry(state, {
        kind: "append_internal_note",
        eventId: "note_1",
        actorId: "reporter_1",
        actorKind: "reporter",
        occurredAt: "2026-08-28T12:00:00.000Z",
        content: "Attempted private note",
      }),
    ).toThrow(new ConversationLifecycleError("ERR-CONVERSATION-DENIED"));
    expect(() =>
      appendConversationEntry(state, {
        kind: "append_message",
        eventId: "private_message_1",
        actorId: "reporter_1",
        actorKind: "reporter",
        audience: "workspace",
        occurredAt: "2026-08-28T12:00:00.000Z",
        content: "Attempted private message",
      }),
    ).toThrow(new ConversationLifecycleError("ERR-CONVERSATION-DENIED"));
  });

  it("BDD-CONV-004 replays an identical event without duplication", () => {
    const command = {
      kind: "append_message" as const,
      eventId: "message_1",
      actorId: "reporter_1",
      actorKind: "reporter" as const,
      audience: "reporter" as const,
      occurredAt: "2026-08-28T12:00:00.000Z",
      content: "Version 2.1",
    };
    const first = appendConversationEntry(state, command);
    const replay = appendConversationEntry(first.state, command);
    expect(replay.status).toBe("replayed");
    expect(replay.state).toBe(first.state);

    const note = {
      kind: "append_internal_note" as const,
      eventId: "note_1",
      actorId: "maintainer_1",
      actorKind: "workspace" as const,
      occurredAt: "2026-08-28T12:01:00.000Z",
      content: "Private note",
    };
    const firstNote = appendConversationEntry(state, note);
    expect(appendConversationEntry(firstNote.state, note).status).toBe("replayed");
  });

  it("filters Workspace-only Messages from the Reporter projection", () => {
    const workspaceOnly = appendConversationEntry(state, {
      kind: "append_message",
      eventId: "message_2",
      actorId: "maintainer_1",
      actorKind: "workspace",
      audience: "workspace",
      occurredAt: "2026-08-28T12:00:00.000Z",
      content: "Workspace-visible context",
    }).state;
    expect(projectConversationForReporter(workspaceOnly).messages).toEqual([]);
  });
});
