import { describe, expect, it, vi } from "vitest";

import type { ClaimedProviderEvent } from "./provider-event-inbox";
import {
  createProviderMessageEventHandler,
  parseProviderMessageEvent,
  type ProviderMessageContext,
} from "./provider-message-event";

const base: ClaimedProviderEvent = {
  inboxId: "inbox_1",
  provider: "github",
  deliveryId: "delivery_1",
  eventType: "issue_comment",
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  repositoryId: "repo_1",
  payloadEnvelope: "",
  attempt: 1,
};

function github(action: "created" | "edited" | "deleted", body = "Visible reply") {
  return {
    ...base,
    payloadEnvelope: JSON.stringify({
      action,
      issue: { id: 41 },
      comment: {
        id: 91,
        body,
        updated_at: "2026-09-02T01:00:00Z",
        user: { id: 7, login: "maintainer" },
      },
    }),
  };
}

function gitlab(action: "create" | "update" | "delete", note = "Visible reply") {
  return {
    ...base,
    provider: "gitlab" as const,
    eventType: "Note Hook",
    payloadEnvelope: JSON.stringify({
      object_kind: "note",
      event_type: action,
      user: { id: 8, username: "maintainer" },
      issue: { id: 42 },
      object_attributes: {
        id: 92,
        action,
        note,
        noteable_type: "Issue",
        updated_at: "2026-09-02T01:00:00Z",
      },
    }),
  };
}

describe.each([
  ["github", github("created"), "created"],
  ["github revision", github("edited"), "revised"],
  ["github tombstone", github("deleted"), "tombstoned"],
  ["gitlab", gitlab("create"), "created"],
  ["gitlab revision", gitlab("update"), "revised"],
  ["gitlab tombstone", gitlab("delete"), "tombstoned"],
] as const)("provider message parsing: %s", (_label, event, mutation) => {
  it(`BDD-SYNC-MSG-001 parses ${mutation} with attributable provenance`, () => {
    expect(parseProviderMessageEvent(event)).toMatchObject({
      kind: "message",
      observation: {
        mutation,
        connectionId: "connection_1",
        repositoryId: "repo_1",
        authorLogin: "maintainer",
        providerUpdatedAt: "2026-09-02T01:00:00.000Z",
      },
    });
  });
});

it("BDD-SYNC-MSG-002 suppresses Y7-originated comment echoes", () => {
  expect(
    parseProviderMessageEvent(
      github("created", "hello <!-- y7-feedback-operation:message_1 -->"),
    ),
  ).toEqual({ kind: "self_generated" });
});

it.each([
  { ...base, payloadEnvelope: "-" },
  { ...github("created"), payloadEnvelope: JSON.stringify({ action: "created" }) },
  github("created", ""),
])("BDD-SYNC-MSG-003 fails malformed content closed", (event) => {
  expect(parseProviderMessageEvent(event)).toEqual({ kind: "invalid" });
});

function harness(authority: "authorized" | "denied" | "retryable") {
  const context: ProviderMessageContext = {
    provider: "github",
    deliveryId: "delivery_1",
    connectionId: "connection_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    repositoryId: "repo_1",
    issueId: "41",
    commentId: "91",
    authorId: "7",
    authorLogin: "maintainer",
    mutation: "created",
    content: "Visible reply",
    providerUpdatedAt: "2026-09-02T01:00:00.000Z",
    linkId: "link_1",
    feedbackId: "feedback_1",
    encryptedGrantRef: "grant_1",
    repositoryOwner: "owner",
    repositoryName: "repo",
  };
  const dependencies = {
    contexts: { resolve: vi.fn().mockResolvedValue({ status: "resolved", context }) },
    authors: { verify: vi.fn().mockResolvedValue(authority) },
    facts: { apply: vi.fn().mockResolvedValue("applied") },
    fallback: { handle: vi.fn().mockResolvedValue("ignored") },
  };
  return { dependencies, handler: createProviderMessageEventHandler(dependencies) };
}

it("BDD-SYNC-MSG-004 persists an eligible collaborator comment exactly once", async () => {
  const target = harness("authorized");
  await expect(target.handler.handle(github("created"))).resolves.toBe("applied");
  expect(target.dependencies.facts.apply).toHaveBeenCalledOnce();
});

it("BDD-SYNC-MSG-005 ignores an outsider without creating a visible Message", async () => {
  const target = harness("denied");
  await expect(target.handler.handle(github("created"))).resolves.toBe("ignored");
  expect(target.dependencies.facts.apply).not.toHaveBeenCalled();
});

it("BDD-SYNC-MSG-006 retries when current author authority cannot be verified", async () => {
  const target = harness("retryable");
  await expect(target.handler.handle(github("created"))).resolves.toBe("retryable");
  expect(target.dependencies.facts.apply).not.toHaveBeenCalled();
});

it("BDD-SYNC-MSG-007 never interprets issue events as comments", async () => {
  const target = harness("authorized");
  const issue = { ...base, eventType: "issues", payloadEnvelope: "{}" };
  await target.handler.handle(issue);
  expect(target.dependencies.fallback.handle).toHaveBeenCalledWith(issue);
  expect(target.dependencies.authors.verify).not.toHaveBeenCalled();
});

it("parses provider fallback fields and rejects every malformed provenance boundary", () => {
  const githubPayload = JSON.parse(github("created").payloadEnvelope) as Record<
    string,
    unknown
  >;
  const comment = githubPayload.comment as Record<string, unknown>;
  const issue = githubPayload.issue as Record<string, unknown>;
  expect(
    parseProviderMessageEvent({
      ...github("created"),
      payloadEnvelope: JSON.stringify({
        ...githubPayload,
        comment: {
          ...comment,
          updated_at: undefined,
          created_at: "2026-09-02T01:00:00Z",
        },
      }),
    }),
  ).toMatchObject({ kind: "message" });
  for (const payload of [
    { ...githubPayload, issue: null },
    { ...githubPayload, comment: null },
    { ...githubPayload, comment: { ...comment, user: null } },
    { ...githubPayload, action: "unknown" },
    { ...githubPayload, issue: { ...issue, id: null } },
    { ...githubPayload, issue: { ...issue, id: "x".repeat(129) } },
    { ...githubPayload, comment: { ...comment, id: null } },
    { ...githubPayload, comment: { ...comment, user: { id: null, login: "x" } } },
    { ...githubPayload, comment: { ...comment, user: { id: 7, login: "" } } },
    { ...githubPayload, comment: { ...comment, updated_at: "invalid" } },
    { ...githubPayload, comment: { ...comment, updated_at: null, created_at: null } },
  ]) {
    expect(
      parseProviderMessageEvent({
        ...base,
        payloadEnvelope: JSON.stringify(payload),
      }),
    ).toEqual({ kind: "invalid" });
  }

  const gitlabPayload = JSON.parse(gitlab("create").payloadEnvelope) as Record<
    string,
    unknown
  >;
  const attributes = gitlabPayload.object_attributes as Record<string, unknown>;
  const user = gitlabPayload.user as Record<string, unknown>;
  const issueGl = gitlabPayload.issue as Record<string, unknown>;
  for (const [eventType, expected] of [
    ["created", "created"],
    ["updated", "revised"],
    ["deleted", "tombstoned"],
    ["note", "created"],
  ] as const) {
    expect(
      parseProviderMessageEvent({
        ...gitlab("create"),
        payloadEnvelope: JSON.stringify({
          ...gitlabPayload,
          event_type: eventType,
          object_attributes: { ...attributes, action: undefined },
        }),
      }),
    ).toMatchObject({ kind: "message", observation: { mutation: expected } });
  }
  expect(
    parseProviderMessageEvent({
      ...gitlab("create"),
      payloadEnvelope: JSON.stringify({
        ...gitlabPayload,
        user: { id: 8, name: "fallback" },
        issue: { iid: 43 },
        object_attributes: {
          ...attributes,
          updated_at: undefined,
          created_at: "2026-09-02T01:00:00Z",
        },
      }),
    }),
  ).toMatchObject({
    kind: "message",
    observation: { issueId: "43", authorLogin: "fallback" },
  });
  expect(
    parseProviderMessageEvent(
      gitlab("create", "hello <!-- y7-feedback-operation:message_1 -->"),
    ),
  ).toEqual({ kind: "self_generated" });
  for (const payload of [
    { ...gitlabPayload, object_kind: "merge_request" },
    {
      ...gitlabPayload,
      object_kind: "note",
      object_attributes: { ...attributes, action: undefined },
      user: user,
      event_type: "unknown",
    },
    { ...gitlabPayload, object_attributes: null },
    { ...gitlabPayload, user: null },
    { ...gitlabPayload, object_attributes: { ...attributes, noteable_type: "Commit" } },
    { ...gitlabPayload, object_attributes: { ...attributes, action: "unknown" } },
    {
      ...gitlabPayload,
      issue: { ...issueGl, id: null },
      object_attributes: { ...attributes, noteable_id: null },
    },
    { ...gitlabPayload, object_attributes: { ...attributes, id: null } },
    { ...gitlabPayload, user: { ...user, id: null } },
    { ...gitlabPayload, user: { id: 8, username: "", name: "" } },
    { ...gitlabPayload, object_attributes: { ...attributes, updated_at: "invalid" } },
    { ...gitlabPayload, object_attributes: { ...attributes, note: "" } },
  ]) {
    const parsed = parseProviderMessageEvent({
      ...gitlab("create"),
      payloadEnvelope: JSON.stringify(payload),
    });
    expect(["invalid", "ignored"]).toContain(parsed.kind);
  }
  expect(
    parseProviderMessageEvent({
      ...gitlab("create"),
      payloadEnvelope: JSON.stringify({
        ...gitlabPayload,
        issue: null,
        object_attributes: { ...attributes, noteable_id: 42 },
      }),
    }),
  ).toMatchObject({ kind: "message", observation: { issueId: "42" } });
  expect(
    parseProviderMessageEvent({ ...gitlab("create"), eventType: "Push Hook" }),
  ).toEqual({ kind: "ignored" });
  expect(
    parseProviderMessageEvent({ ...base, payloadEnvelope: JSON.stringify([]) }),
  ).toEqual({ kind: "invalid" });
});

it("maps handler boundary failures and resolver outcomes deterministically", async () => {
  const invalid = harness("authorized");
  await expect(invalid.handler.handle(github("created", ""))).resolves.toBe(
    "permanent",
  );
  const self = harness("authorized");
  await expect(
    self.handler.handle(github("created", "<!-- y7-feedback-operation:message_1 -->")),
  ).resolves.toBe("ignored");

  for (const status of ["ignored", "permanent", "retryable"] as const) {
    const x = harness("authorized");
    x.dependencies.contexts.resolve.mockResolvedValue({ status });
    await expect(x.handler.handle(github("created"))).resolves.toBe(status);
  }
  const resolveFailure = harness("authorized");
  resolveFailure.dependencies.contexts.resolve.mockRejectedValue(new Error("db"));
  await expect(resolveFailure.handler.handle(github("created"))).resolves.toBe(
    "retryable",
  );
  const authorityFailure = harness("authorized");
  authorityFailure.dependencies.authors.verify.mockRejectedValue(new Error("api"));
  await expect(authorityFailure.handler.handle(github("created"))).resolves.toBe(
    "retryable",
  );
  const factFailure = harness("authorized");
  factFailure.dependencies.facts.apply.mockRejectedValue(new Error("db"));
  await expect(factFailure.handler.handle(github("created"))).resolves.toBe(
    "retryable",
  );
});
