import { describe, expect, it, vi } from "vitest";

import { planAuthoritativeCommit } from "@y7-feedback/domain";

import { createAuthoritativeIntakeProjectionHandler } from "./authoritative-intake-projector.js";
import type { AcceptanceCommit, IdempotencyRecord } from "./intake.js";

const record: IdempotencyRecord = {
  scopeKey: "workspace_1:project_1",
  clientOperationId: "operation_1",
  payloadDigest: "digest_0123456789abcdef",
  feedbackId: "feedback_1",
  reference: "Y7-2026-000001",
  protectedProof: "protected_proof",
  proofVerifier: "proof_verifier",
  createdAt: "2026-09-13T02:00:00.000Z",
};

const acceptance = { idempotency: record } as AcceptanceCommit;
const commit = planAuthoritativeCommit(
  {
    environment: "preview",
    aggregateKind: "feedback",
    aggregateId: "feedback_1",
    operationId: "operation_1",
    commandKind: "feedback.accepted",
    workspaceId: "workspace_1",
    projectId: "project_1",
    actorKind: "system",
    actorId: "intake",
    payloadDigest: "digest_0123456789abcdef",
    sealedPayload: "sealed_payload",
    acceptedAt: "2026-09-13T02:00:00.000Z",
  },
  () => "commit_a",
);

function setup(existing: IdempotencyRecord | null = null) {
  const open = vi.fn(() => acceptance);
  const findIdempotency = vi.fn(() => Promise.resolve(existing));
  const normalizedCommit = vi.fn(() => Promise.resolve());
  const handler = createAuthoritativeIntakeProjectionHandler(
    { open },
    { findIdempotency, commit: normalizedCommit },
  );
  return { open, findIdempotency, normalizedCommit, handler };
}

describe("ADR-015 authoritative intake projection", () => {
  it("BDD-SLO-461 projects a new acceptance atomically", async () => {
    const target = setup();
    await expect(target.handler.project(commit)).resolves.toBeUndefined();
    expect(target.open).toHaveBeenCalledWith(commit);
    expect(target.findIdempotency).toHaveBeenCalledWith(
      "workspace_1:project_1",
      "operation_1",
    );
    expect(target.normalizedCommit).toHaveBeenCalledWith(acceptance);
  });

  it("BDD-SLO-462 treats an identical existing projection as success", async () => {
    const target = setup(record);
    await expect(target.handler.project(commit)).resolves.toBeUndefined();
    expect(target.normalizedCommit).not.toHaveBeenCalled();
  });

  it.each(Object.keys(record) as (keyof IdempotencyRecord)[])(
    "BDD-SLO-463 fails closed when projected %s differs",
    async (field) => {
      const target = setup({ ...record, [field]: `${record[field]}_other` });
      await expect(target.handler.project(commit)).rejects.toThrow(
        "AUTHORITATIVE_INTAKE_PROJECTION_CONFLICT",
      );
      expect(target.normalizedCommit).not.toHaveBeenCalled();
    },
  );

  it("BDD-SLO-464 rejects another command kind before opening payload", async () => {
    const target = setup();
    await expect(
      target.handler.project({ ...commit, commandKind: "conversation.message" }),
    ).rejects.toThrow("AUTHORITATIVE_INTAKE_COMMAND_UNSUPPORTED");
    expect(target.open).not.toHaveBeenCalled();
  });

  it("BDD-SLO-465 preserves envelope, lookup and commit failures", async () => {
    const envelopeFailure = setup();
    envelopeFailure.open.mockImplementationOnce(() => {
      throw new Error("envelope invalid");
    });
    await expect(envelopeFailure.handler.project(commit)).rejects.toThrow(
      "envelope invalid",
    );

    const lookupFailure = setup();
    lookupFailure.findIdempotency.mockRejectedValueOnce(
      new Error("lookup unavailable"),
    );
    await expect(lookupFailure.handler.project(commit)).rejects.toThrow(
      "lookup unavailable",
    );

    const commitFailure = setup();
    commitFailure.normalizedCommit.mockRejectedValueOnce(
      new Error("commit unavailable"),
    );
    await expect(commitFailure.handler.project(commit)).rejects.toThrow(
      "commit unavailable",
    );
  });
});
