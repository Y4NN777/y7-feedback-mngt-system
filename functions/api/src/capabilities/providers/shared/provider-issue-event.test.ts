import { describe, expect, it, vi } from "vitest";

import {
  createProviderIssueEventHandler,
  parseProviderIssueEvent,
} from "./provider-issue-event.js";
import type { ClaimedProviderEvent } from "./provider-event-inbox.js";

const base: ClaimedProviderEvent = {
  inboxId: "inbox_1",
  provider: "github",
  deliveryId: "delivery_1",
  eventType: "issues",
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  repositoryId: "1329343404",
  payloadEnvelope: JSON.stringify({
    action: "closed",
    issue: {
      id: 42,
      state: "closed",
      updated_at: "2026-09-02T00:00:00Z",
      body: "external issue",
    },
  }),
  attempt: 1,
};

describe("provider issue event mapping", () => {
  it("BDD-SYNC-041 maps exact GitHub and GitLab lifecycle states", () => {
    expect(parseProviderIssueEvent(base)).toEqual({
      kind: "state",
      issueId: "42",
      state: "closed",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(
      parseProviderIssueEvent({
        ...base,
        provider: "gitlab",
        eventType: "Issue Hook",
        repositoryId: "83836910",
        payloadEnvelope: JSON.stringify({
          object_kind: "issue",
          object_attributes: {
            id: "84",
            state: "opened",
            updated_at: "2026-09-02T00:01:00.000Z",
            description: "external issue",
          },
        }),
      }),
    ).toEqual({
      kind: "state",
      issueId: "84",
      state: "open",
      updatedAt: "2026-09-02T00:01:00.000Z",
    });
    expect(
      parseProviderIssueEvent({
        ...base,
        provider: "gitlab",
        eventType: "Issue Hook",
        payloadEnvelope: JSON.stringify({
          object_kind: "issue",
          object_attributes: {
            id: 84,
            state: "closed",
            updated_at: "2026-09-02T00:02:00.000Z",
          },
        }),
      }),
    ).toMatchObject({ kind: "state", state: "closed" });
  });

  it("BDD-SYNC-042 suppresses self-generated and unrelated events", () => {
    expect(parseProviderIssueEvent({ ...base, eventType: "push" })).toEqual({
      kind: "ignored",
    });
    for (const provider of ["github", "gitlab"] as const) {
      const payloadEnvelope =
        provider === "github"
          ? JSON.stringify({
              issue: {
                id: 42,
                state: "open",
                updated_at: "2026-09-02T00:00:00Z",
                body: "<!-- y7-feedback-operation:operation_1 -->",
              },
            })
          : JSON.stringify({
              object_kind: "issue",
              object_attributes: {
                id: 84,
                state: "opened",
                updated_at: "2026-09-02T00:00:00Z",
                description: "<!-- y7-feedback-operation:operation_1 -->",
              },
            });
      expect(
        parseProviderIssueEvent({
          ...base,
          provider,
          eventType: provider === "github" ? "issues" : "Issue Hook",
          payloadEnvelope,
        }),
      ).toEqual({ kind: "self_generated" });
    }
  });

  it.each([
    "{",
    "null",
    "[]",
    JSON.stringify({ issue: null }),
    JSON.stringify({ issue: { id: "", state: "open", updated_at: "invalid" } }),
    JSON.stringify({ issue: { id: 1, state: "unknown", updated_at: "2026-09-02" } }),
    JSON.stringify({ issue: { id: 1, state: "open", updated_at: null } }),
  ])("BDD-SYNC-043 rejects malformed GitHub payload %#", (payloadEnvelope) => {
    expect(parseProviderIssueEvent({ ...base, payloadEnvelope })).toEqual({
      kind: "invalid",
    });
  });

  it.each([
    {},
    { object_kind: "push", object_attributes: {} },
    { object_kind: "issue", object_attributes: null },
    {
      object_kind: "issue",
      object_attributes: {
        id: 1,
        state: "unknown",
        updated_at: "2026-09-02T00:00:00Z",
      },
    },
  ])("BDD-SYNC-044 rejects malformed GitLab payload %#", (payload) => {
    expect(
      parseProviderIssueEvent({
        ...base,
        provider: "gitlab",
        eventType: "Issue Hook",
        payloadEnvelope: JSON.stringify(payload),
      }),
    ).toEqual({ kind: "invalid" });
  });

  it("BDD-SYNC-045 applies, ignores, permanently rejects and retries safely", async () => {
    const apply = vi.fn(() => Promise.resolve("applied" as const));
    const handler = createProviderIssueEventHandler({ apply });
    await expect(handler.handle(base)).resolves.toBe("applied");
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "42", state: "closed" }),
    );
    await expect(handler.handle({ ...base, eventType: "push" })).resolves.toBe(
      "ignored",
    );
    await expect(handler.handle({ ...base, payloadEnvelope: "invalid" })).resolves.toBe(
      "permanent",
    );
    apply.mockRejectedValueOnce(new Error("unavailable"));
    await expect(handler.handle(base)).resolves.toBe("retryable");
  });
});
