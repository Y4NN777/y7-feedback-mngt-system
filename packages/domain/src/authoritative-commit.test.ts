import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthoritativeCommitError,
  planAuthoritativeCommit,
  resolveAuthoritativeCommitReplay,
} from "./authoritative-commit.js";

const input = {
  environment: "preview" as const,
  aggregateKind: "feedback" as const,
  aggregateId: "feedback_1",
  operationId: "operation_1",
  commandKind: "feedback.accepted",
  workspaceId: "workspace_1",
  projectId: "project_1",
  actorKind: "reporter" as const,
  actorId: "reporter_1",
  payloadDigest: "digest_0123456789abcdef",
  sealedPayload: "sealed_payload_1",
  acceptedAt: "2026-09-13T02:00:00.000Z",
};

const deriveId = vi.fn(() => "commit_a");

describe("ADR-015 authoritative commit", () => {
  beforeEach(() => deriveId.mockClear());

  it("BDD-SLO-401 plans one deterministic immutable commit", () => {
    expect(planAuthoritativeCommit(input, deriveId)).toEqual({
      id: "commit_a",
      version: 1,
      ...input,
      projectionState: "pending",
      projectionAttempts: 0,
    });
    expect(deriveId).toHaveBeenCalledWith(
      "preview\u0000feedback\u0000feedback_1\u0000operation_1",
    );
  });

  it("BDD-SLO-402 replays the original result only for the same digest", () => {
    const commit = planAuthoritativeCommit(input, deriveId);
    expect(resolveAuthoritativeCommitReplay(commit, input.payloadDigest)).toEqual({
      status: "replayed",
      commit,
    });
  });

  it.each([
    [
      "production conversation by user",
      { environment: "production", aggregateKind: "conversation", actorKind: "user" },
    ],
    ["system projection command", { actorKind: "system" }],
  ] as const)("BDD-SLO-401 supports %s", (_label, patch) => {
    expect(
      planAuthoritativeCommit({ ...input, ...patch }, deriveId).projectionState,
    ).toBe("pending");
  });

  it("BDD-SLO-403 rejects operation identity reuse with a different digest", () => {
    const commit = planAuthoritativeCommit(input, deriveId);
    expect(() =>
      resolveAuthoritativeCommitReplay(commit, "digest_ffffffffffffffff"),
    ).toThrow(new AuthoritativeCommitError("AUTHORITATIVE_COMMIT_CONFLICT"));
  });

  it.each([
    ["development environment", { environment: "development" }],
    ["invalid aggregate kind", { aggregateKind: "project" }],
    ["invalid aggregate", { aggregateId: "bad/id" }],
    ["invalid operation", { operationId: "bad/id" }],
    ["invalid command", { commandKind: "invalid" }],
    ["invalid workspace", { workspaceId: "bad/id" }],
    ["invalid project", { projectId: "bad/id" }],
    ["invalid actor kind", { actorKind: "owner" }],
    ["invalid actor", { actorId: "bad/id" }],
    ["short digest", { payloadDigest: "short" }],
    ["invalid timestamp", { acceptedAt: "2026-09-13" }],
    ["impossible timestamp", { acceptedAt: "2026-99-99T02:00:00.000Z" }],
    ["empty payload", { sealedPayload: "" }],
    ["oversized payload", { sealedPayload: "x".repeat(500_001) }],
  ])("BDD-SLO-404 fails closed for %s", (_label, patch) => {
    expect(() =>
      planAuthoritativeCommit(
        { ...input, ...patch } as unknown as typeof input,
        deriveId,
      ),
    ).toThrow(new AuthoritativeCommitError("AUTHORITATIVE_COMMIT_INVALID"));
  });

  it("BDD-SLO-405 rejects an invalid derived Appwrite identity", () => {
    expect(() => planAuthoritativeCommit(input, () => "bad/id")).toThrow(
      new AuthoritativeCommitError("AUTHORITATIVE_COMMIT_INVALID"),
    );
  });

  it("BDD-SLO-406 rejects an invalid replay digest", () => {
    const commit = planAuthoritativeCommit(input, deriveId);
    expect(() => resolveAuthoritativeCommitReplay(commit, "short")).toThrow(
      new AuthoritativeCommitError("AUTHORITATIVE_COMMIT_INVALID"),
    );
  });
});
