import { describe, expect, it, vi } from "vitest";

import type { AuthoritativeCommit } from "@y7-feedback/domain";

import { createAuthoritativeIntakeStore } from "./authoritative-intake-store.js";
import type { AcceptanceCommit } from "./intake.js";

const acceptance = {
  feedback: {
    id: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    acceptedAt: "2026-09-13T02:00:00.000Z",
  },
  idempotency: {
    scopeKey: "workspace_1:project_1",
    clientOperationId: "018f4f7e-89ab-7def-8123-456789abcdef",
    payloadDigest: "digest_0123456789abcdef",
  },
} as AcceptanceCommit;

function setup(status: "applied" | "replayed" = "applied") {
  const seal = vi.fn(() => "sealed_payload");
  const open = vi.fn(() => acceptance);
  const accept = vi.fn((commit: AuthoritativeCommit) =>
    Promise.resolve({ status, commit }),
  );
  const store = createAuthoritativeIntakeStore(
    "preview",
    { accept, find: () => Promise.resolve(null) },
    { seal, open },
  );
  return { store, seal, open, accept };
}

describe("ADR-015 authoritative intake acceptance", () => {
  it("BDD-SLO-471 persists acceptance through one deterministic commit", async () => {
    const target = setup();
    await expect(target.store.acceptAuthoritatively(acceptance)).resolves.toEqual({
      acceptance,
      replayed: false,
    });
    const committed = target.accept.mock.calls[0]?.[0];
    expect(committed).toMatchObject({
      id: "commit_d54dfefcb3931059868ac2f8a109b",
      environment: "preview",
      aggregateKind: "feedback",
      aggregateId: "feedback_1",
      operationId: "018f4f7e-89ab-7def-8123-456789abcdef",
      commandKind: "feedback.accepted",
      workspaceId: "workspace_1",
      projectId: "project_1",
      actorKind: "system",
      actorId: "intake",
      payloadDigest: "digest_0123456789abcdef",
      sealedPayload: "sealed_payload",
      acceptedAt: "2026-09-13T02:00:00.000Z",
    });
    expect(target.seal).toHaveBeenCalledWith(committed?.id, acceptance);
    expect(target.open).not.toHaveBeenCalled();
  });

  it("BDD-SLO-472 returns the original encrypted acceptance on replay", async () => {
    const original = {
      ...acceptance,
      feedback: { ...acceptance.feedback, id: "original" },
    };
    const target = setup("replayed");
    target.open.mockReturnValueOnce(original);
    await expect(target.store.acceptAuthoritatively(acceptance)).resolves.toEqual({
      acceptance: original,
      replayed: true,
    });
    expect(target.open).toHaveBeenCalledWith(target.accept.mock.calls[0]?.[0]);
  });

  it("BDD-SLO-473 fails closed when persistence returns another identity", async () => {
    const target = setup();
    target.accept.mockImplementationOnce((commit) =>
      Promise.resolve({
        status: "applied",
        commit: { ...commit, id: "commit_other" },
      }),
    );
    await expect(target.store.acceptAuthoritatively(acceptance)).rejects.toThrow(
      "AUTHORITATIVE_INTAKE_COMMIT_INVALID",
    );
  });

  it("BDD-SLO-474 uses a distinct identity per environment, scope and operation", async () => {
    const preview = setup();
    const production = createAuthoritativeIntakeStore(
      "production",
      { accept: preview.accept, find: () => Promise.resolve(null) },
      { seal: preview.seal, open: preview.open },
    );
    await production.acceptAuthoritatively(acceptance);
    const productionId = preview.accept.mock.calls[0]?.[0].id;
    const changed = setup();
    await changed.store.acceptAuthoritatively({
      ...acceptance,
      idempotency: {
        ...acceptance.idempotency,
        clientOperationId: "018f4f7e-89ab-7def-8123-456789abcdee",
      },
    });
    expect(changed.accept.mock.calls[0]?.[0].id).not.toBe(productionId);
  });
});
