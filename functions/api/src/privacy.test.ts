import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPrivacyCoordinator, type PrivacyStore } from "./privacy";

const principal = { verify: vi.fn() };
const scope = { resolve: vi.fn() };
const proof = { authorize: vi.fn() };
const execute = vi.fn<PrivacyStore["execute"]>();
const store: PrivacyStore = { execute };
const digest = vi.fn(() => "d".repeat(64));
const command = {
  kind: "request_deletion",
  operationId: "operation_1",
  feedbackId: "feedback_1",
  reasonCode: "reporter_request",
} as const;
const base = {
  workspaceId: "workspace_1",
  projectId: "project_1",
  authority: { kind: "principal", jwt: "jwt_1" } as const,
  command,
};

function coordinator() {
  return createPrivacyCoordinator(principal, scope, proof, store, digest);
}

describe("privacy coordinator", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    digest.mockReturnValue("d".repeat(64));
  });
  it("BDD-PRIV-010 authorizes a principal from authoritative scope and returns a bounded receipt", async () => {
    principal.verify.mockResolvedValueOnce({
      status: "verified",
      principalId: "principal_1",
    });
    scope.resolve.mockResolvedValueOnce({ status: "authorized" });
    execute.mockResolvedValueOnce({
      status: "applied",
      feedbackId: "feedback_1",
      revision: 1,
      purgeEligibleAt: "2026-10-02T00:00:00.000Z",
    });
    await expect(coordinator().execute(base)).resolves.toEqual({
      status: "ok",
      result: {
        disposition: "applied",
        feedbackId: "feedback_1",
        revision: 1,
        purgeEligibleAt: "2026-10-02T00:00:00.000Z",
      },
    });
    expect(scope.resolve).toHaveBeenCalledWith({
      principalId: "principal_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      capability: "feedback.write",
    });
    expect(execute).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      projectId: "project_1",
      actorDigest: "d".repeat(64),
      requesterKind: "principal",
      requesterDigest: "d".repeat(64),
      command,
    });
  });

  it("BDD-PRIV-011 authorizes an Access Proof only for its exact Feedback", async () => {
    proof.authorize.mockResolvedValueOnce({
      status: "authorized",
      feedbackId: "feedback_1",
    });
    execute.mockResolvedValueOnce({
      status: "replayed",
      feedbackId: "feedback_1",
      revision: 1,
      purgeEligibleAt: "2026-10-02T00:00:00.000Z",
    });
    await expect(
      coordinator().execute({
        ...base,
        authority: {
          kind: "access_proof",
          reference: "reference_1",
          proof: "proof_1",
        },
      }),
    ).resolves.toMatchObject({
      status: "ok",
      result: { disposition: "replayed" },
    });
    expect(digest).toHaveBeenLastCalledWith("proof:reference_1");
    proof.authorize.mockResolvedValueOnce({
      status: "authorized",
      feedbackId: "feedback_2",
    });
    await expect(
      coordinator().execute({
        ...base,
        authority: {
          kind: "access_proof",
          reference: "reference_1",
          proof: "proof_1",
        },
      }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("BDD-PRIV-012 denies unverifiable principal, scope and proof indistinguishably", async () => {
    principal.verify.mockResolvedValueOnce({ status: "denied" });
    await expect(coordinator().execute(base)).resolves.toEqual({ status: "denied" });
    principal.verify.mockResolvedValueOnce({
      status: "verified",
      principalId: "principal_1",
    });
    scope.resolve.mockResolvedValueOnce({ status: "denied" });
    await expect(coordinator().execute(base)).resolves.toEqual({ status: "denied" });
    proof.authorize.mockResolvedValueOnce({ status: "denied" });
    await expect(
      coordinator().execute({
        ...base,
        authority: { kind: "access_proof", reference: "ref", proof: "proof" },
      }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("BDD-PRIV-013 validates commands, scope and bounded authority material first", async () => {
    const invalidInputs = [
      { ...base, workspaceId: "bad id" },
      { ...base, projectId: "bad id" },
      { ...base, authority: { kind: "principal", jwt: "" } as const },
      {
        ...base,
        authority: { kind: "access_proof", reference: "", proof: "proof" } as const,
      },
      {
        ...base,
        authority: { kind: "access_proof", reference: "ref", proof: "" } as const,
      },
      { ...base, command: null },
      { ...base, command: { ...command, operationId: "bad id" } },
      { ...base, command: { ...command, feedbackId: "bad id" } },
      { ...base, command: { ...command, reasonCode: "BAD" } },
      {
        ...base,
        command: {
          kind: "restore_feedback",
          operationId: "operation_2",
          feedbackId: "feedback_1",
          expectedRevision: 0,
        },
      },
      { ...base, command: { ...command, kind: "invented" } },
    ];
    for (const input of invalidInputs)
      await expect(coordinator().execute(input)).resolves.toEqual({
        status: "invalid",
      });
    expect(principal.verify).not.toHaveBeenCalled();
  });

  it("BDD-PRIV-014 forwards restore and stable store failures", async () => {
    principal.verify.mockResolvedValue({
      status: "verified",
      principalId: "principal_1",
    });
    scope.resolve.mockResolvedValue({ status: "authorized" });
    for (const status of [
      "denied",
      "invalid",
      "conflict",
      "expired",
      "retryable",
    ] as const) {
      execute.mockResolvedValueOnce({ status });
      await expect(
        coordinator().execute({
          ...base,
          command: {
            kind: "restore_feedback",
            operationId: "operation_2",
            feedbackId: "feedback_1",
            expectedRevision: 1,
          },
        }),
      ).resolves.toEqual({ status });
    }
  });

  it("BDD-PRIV-015 turns dependency failures and invalid digests into retryable outcomes", async () => {
    principal.verify.mockRejectedValueOnce(new Error("transport"));
    await expect(coordinator().execute(base)).resolves.toEqual({
      status: "retryable",
    });
    principal.verify.mockResolvedValueOnce({
      status: "verified",
      principalId: "principal_1",
    });
    scope.resolve.mockResolvedValueOnce({ status: "authorized" });
    digest.mockReturnValueOnce("invalid");
    await expect(coordinator().execute(base)).resolves.toEqual({
      status: "retryable",
    });
  });
});
