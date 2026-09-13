import { describe, expect, it, vi } from "vitest";

import { planAuthoritativeCommit } from "@y7-feedback/domain";

import { createAppwriteAuthoritativeCommitStore } from "./appwrite-authoritative-commit-store.js";

const commit = planAuthoritativeCommit(
  {
    environment: "preview",
    aggregateKind: "feedback",
    aggregateId: "feedback_1",
    operationId: "operation_1",
    commandKind: "feedback.accepted",
    workspaceId: "workspace_1",
    projectId: "project_1",
    actorKind: "reporter",
    actorId: "reporter_1",
    payloadDigest: "digest_0123456789abcdef",
    sealedPayload: "sealed_payload_1",
    acceptedAt: "2026-09-13T02:00:00.000Z",
  },
  () => "commit_a",
);

function row(overrides: Readonly<Record<string, unknown>> = {}) {
  return { $id: commit.id, ...commit, ...overrides };
}

function setup() {
  const createRow = vi.fn<() => Promise<unknown>>(() => Promise.resolve(row()));
  const getRow = vi.fn<() => Promise<unknown>>(() => Promise.resolve(row()));
  return {
    createRow,
    getRow,
    store: createAppwriteAuthoritativeCommitStore(
      { createRow, getRow },
      { databaseId: "feedback", authoritativeCommitsTableId: "authoritative_commits" },
    ),
  };
}

describe("ADR-015 Appwrite authoritative commit store", () => {
  it("BDD-SLO-410 loads an existing canonical commit without writing", async () => {
    const target = setup();
    await expect(target.store.find("commit_a")).resolves.toEqual(commit);
    expect(target.createRow).not.toHaveBeenCalled();
    target.getRow.mockRejectedValueOnce({ code: 404 });
    await expect(target.store.find("commit_missing")).resolves.toBeNull();
    await expect(target.store.find("bad/id")).resolves.toBeNull();
    const failure = new Error("transport");
    target.getRow.mockRejectedValueOnce(failure);
    await expect(target.store.find("commit_a")).rejects.toBe(failure);
  });

  it("BDD-SLO-411 accepts through exactly one non-transactional write", async () => {
    const target = setup();
    await expect(target.store.accept(commit)).resolves.toEqual({
      status: "applied",
      commit,
    });
    expect(target.createRow).toHaveBeenCalledTimes(1);
    expect(target.getRow).not.toHaveBeenCalled();
    expect(target.createRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "authoritative_commits",
      rowId: "commit_a",
      data: {
        version: 1,
        environment: "preview",
        aggregateKind: "feedback",
        aggregateId: "feedback_1",
        operationId: "operation_1",
        commandKind: "feedback.accepted",
        workspaceId: "workspace_1",
        projectId: "project_1",
        actorKind: "reporter",
        actorId: "reporter_1",
        payloadDigest: "digest_0123456789abcdef",
        sealedPayload: "sealed_payload_1",
        acceptedAt: "2026-09-13T02:00:00.000Z",
        projectionState: "pending",
        projectionAttempts: 0,
        availableAt: "2026-09-13T02:00:00.000Z",
      },
      permissions: [],
    });
  });

  it("BDD-SLO-411A accepts Appwrite's equivalent UTC datetime representation", async () => {
    const target = setup();
    target.createRow.mockResolvedValueOnce(
      row({ acceptedAt: "2026-09-13T02:00:00.000+00:00" }),
    );
    await expect(target.store.accept(commit)).resolves.toEqual({
      status: "applied",
      commit,
    });
  });

  it("BDD-SLO-412 returns the original commit after a duplicate write", async () => {
    const target = setup();
    target.createRow.mockRejectedValueOnce({ code: 409 });
    await expect(target.store.accept(commit)).resolves.toEqual({
      status: "replayed",
      commit,
    });
    expect(target.getRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "authoritative_commits",
      rowId: "commit_a",
    });
  });

  it("BDD-SLO-413 fails closed when a duplicate identity has another digest", async () => {
    const target = setup();
    target.createRow.mockRejectedValueOnce({ code: 409 });
    target.getRow.mockResolvedValueOnce(
      row({ payloadDigest: "different_digest_1234" }),
    );
    await expect(target.store.accept(commit)).rejects.toThrow(
      "AUTHORITATIVE_COMMIT_CONFLICT",
    );
  });

  it("BDD-SLO-414 rejects malformed persistence responses and schema", async () => {
    expect(() =>
      createAppwriteAuthoritativeCommitStore(
        { createRow: vi.fn(), getRow: vi.fn() },
        { databaseId: "bad/id", authoritativeCommitsTableId: "commits" },
      ),
    ).toThrow("AUTHORITATIVE_COMMIT_SCHEMA_INVALID");
    expect(() =>
      createAppwriteAuthoritativeCommitStore(
        { createRow: vi.fn(), getRow: vi.fn() },
        { databaseId: "feedback", authoritativeCommitsTableId: "bad/id" },
      ),
    ).toThrow("AUTHORITATIVE_COMMIT_SCHEMA_INVALID");
    expect(() =>
      createAppwriteAuthoritativeCommitStore(
        { createRow: vi.fn(), getRow: vi.fn() },
        { databaseId: "feedback", authoritativeCommitsTableId: "feedback" },
      ),
    ).toThrow("AUTHORITATIVE_COMMIT_SCHEMA_INVALID");
    const target = setup();
    target.createRow.mockResolvedValueOnce(row({ projectionAttempts: -1 }));
    await expect(target.store.accept(commit)).rejects.toThrow(
      "AUTHORITATIVE_COMMIT_WRITE_INVALID",
    );
  });

  it("BDD-SLO-415 preserves non-conflict transport failures", async () => {
    const target = setup();
    const failure = new Error("transport");
    target.createRow.mockRejectedValueOnce(failure);
    await expect(target.store.accept(commit)).rejects.toBe(failure);
    expect(target.getRow).not.toHaveBeenCalled();
  });

  it("BDD-SLO-415 preserves non-object transport failures", async () => {
    const target = setup();
    target.createRow.mockRejectedValueOnce(null);
    await expect(target.store.accept(commit)).rejects.toBeNull();
  });

  it.each([
    ["null row", null],
    ["array row", []],
    ["wrong id", row({ $id: "other" })],
    ["invalid environment", row({ environment: "development" })],
    ["invalid aggregate kind", row({ aggregateKind: "project" })],
    ["invalid aggregate id", row({ aggregateId: "bad/id" })],
    ["invalid operation id", row({ operationId: "bad/id" })],
    ["invalid command kind", row({ commandKind: "invalid" })],
    ["invalid workspace id", row({ workspaceId: "bad/id" })],
    ["invalid project id", row({ projectId: "bad/id" })],
    ["invalid actor kind", row({ actorKind: "owner" })],
    ["invalid actor id", row({ actorId: "bad/id" })],
    ["invalid digest", row({ payloadDigest: "short" })],
    ["invalid sealed payload", row({ sealedPayload: "" })],
    ["invalid accepted time", row({ acceptedAt: "invalid" })],
    ["invalid version", row({ version: 2 })],
    ["invalid state", row({ projectionState: "unknown" })],
    ["non-number attempts", row({ projectionAttempts: "0" })],
    ["fractional attempts", row({ projectionAttempts: 0.5 })],
    ["negative attempts", row({ projectionAttempts: -1 })],
  ])("BDD-SLO-416 rejects %s", async (_label, persisted) => {
    const target = setup();
    target.createRow.mockResolvedValueOnce(persisted);
    await expect(target.store.accept(commit)).rejects.toThrow(
      "AUTHORITATIVE_COMMIT_WRITE_INVALID",
    );
  });

  it.each(["processing", "projected", "failed"] as const)(
    "BDD-SLO-417 replays a commit in %s projection state",
    async (projectionState) => {
      const target = setup();
      target.createRow.mockRejectedValueOnce({ code: 409 });
      target.getRow.mockResolvedValueOnce(
        row({ projectionState, projectionAttempts: 1 }),
      );
      await expect(target.store.accept(commit)).resolves.toMatchObject({
        status: "replayed",
      });
    },
  );

  it("BDD-SLO-418 rejects a malformed duplicate row", async () => {
    const target = setup();
    target.createRow.mockRejectedValueOnce({ code: 409 });
    target.getRow.mockResolvedValueOnce(null);
    await expect(target.store.accept(commit)).rejects.toThrow(
      "AUTHORITATIVE_COMMIT_REPLAY_INVALID",
    );
  });
});
