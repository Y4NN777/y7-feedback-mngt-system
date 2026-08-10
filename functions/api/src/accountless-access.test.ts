import { describe, expect, it } from "vitest";

import {
  issueAccessGrant,
  type AccessGrant,
  type ReporterAction,
  type ReporterFeedbackRecord,
} from "@y7-feedback/domain";

import {
  createAccountlessAccessCoordinator,
  type AccountlessAccessRepository,
  type AccountlessResource,
} from "./accountless-access";

const proofA = "proof_A_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG";
const proofB = "proof_B_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG";
const hashProof = (proof: string) =>
  `hash:${String(proof.length)}:${proof.slice(0, 7)}`;
const matchesProof = (proof: string, verifier: string) => hashProof(proof) === verifier;

function feedback(): ReporterFeedbackRecord {
  return {
    feedbackId: "feedback-1",
    reference: "Y7-2026-000001",
    originalSource: { type: "review", experience: "Rapide", appreciation: "Clair" },
    currentSource: { type: "review", experience: "Rapide", appreciation: "Clair" },
    currentState: "received",
    history: [
      {
        id: "history-1",
        kind: "received",
        audience: "reporter",
        actor: "system:intake",
        occurredAt: "2026-08-10T15:00:00.000Z",
        detail: "received",
      },
    ],
    messages: [],
    attachments: [],
    sourceRevisions: [],
    deletionRequests: [],
    internalNotes: ["internal"],
    workspaceClassification: "priority-high",
  };
}

class MemoryAccessRepository implements AccountlessAccessRepository {
  resource: AccountlessResource | null;
  failLoad = false;
  failSave = false;
  savedGrants: AccessGrant[] = [];
  savedRecords: ReporterFeedbackRecord[] = [];

  constructor(resource: AccountlessResource | null) {
    this.resource = resource;
  }

  loadByReference(): Promise<AccountlessResource | null> {
    if (this.failLoad) return Promise.reject(new Error("load unavailable"));
    return Promise.resolve(this.resource);
  }

  saveGrant(grant: AccessGrant): Promise<void> {
    if (this.failSave) return Promise.reject(new Error("save unavailable"));
    this.savedGrants.push(grant);
    if (this.resource) this.resource = { ...this.resource, grant };
    return Promise.resolve();
  }

  saveRecord(record: ReporterFeedbackRecord): Promise<void> {
    if (this.failSave) return Promise.reject(new Error("save unavailable"));
    this.savedRecords.push(record);
    if (this.resource) this.resource = { ...this.resource, record };
    return Promise.resolve();
  }
}

function setup() {
  const issued = issueAccessGrant(
    { feedbackId: "feedback-1", reference: "Y7-2026-000001" },
    { createProof: () => proofA, hashProof },
  );
  const repository = new MemoryAccessRepository({
    grant: issued.grant,
    record: feedback(),
  });
  const coordinator = createAccountlessAccessCoordinator(repository, {
    matchesProof,
    rotation: { createProof: () => proofB, hashProof },
  });
  return { coordinator, repository };
}

describe("trusted accountless access coordination", () => {
  it("retrieves only the Reporter-safe projection with a valid Feedback proof", async () => {
    const { coordinator } = setup();

    const outcome = await coordinator.retrieve({
      reference: "Y7-2026-000001",
      proof: proofA,
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("expected Reporter view");
    expect(outcome.view.feedbackId).toBe("feedback-1");
    expect(outcome.view.reference).toBe("Y7-2026-000001");
    expect(JSON.stringify(outcome)).not.toMatch(/internal|priority-high/u);
  });

  it("returns one denial for reference-only, invalid, unknown, and sibling proof attempts", async () => {
    const { coordinator } = setup();
    const unknown = createAccountlessAccessCoordinator(
      new MemoryAccessRepository(null),
      { matchesProof, rotation: { createProof: () => proofB, hashProof } },
    );
    const denied = { status: "denied", code: "ACCESS_DENIED" };

    expect(await coordinator.retrieve({ reference: "Y7-2026-000001" })).toEqual(denied);
    expect(
      await coordinator.retrieve({ reference: "Y7-2026-000001", proof: proofB }),
    ).toEqual(denied);
    expect(
      await unknown.retrieve({ reference: "Y7-2026-999999", proof: proofA }),
    ).toEqual(denied);
    expect(
      await coordinator.retrieve({ reference: "Y7-2026-000001", proof: proofB }),
    ).toEqual(denied);
  });

  it("rotates and revokes only after current proof authorization", async () => {
    const { coordinator, repository } = setup();

    const rotated = await coordinator.rotate({
      reference: "Y7-2026-000001",
      proof: proofA,
    });
    expect(rotated).toEqual({
      status: "ok",
      reference: "Y7-2026-000001",
      accessProof: proofB,
    });
    expect(repository.savedGrants).toHaveLength(1);
    expect(
      await coordinator.retrieve({ reference: "Y7-2026-000001", proof: proofA }),
    ).toEqual({ status: "denied", code: "ACCESS_DENIED" });
    expect(
      (
        await coordinator.retrieve({
          reference: "Y7-2026-000001",
          proof: proofB,
        })
      ).status,
    ).toBe("ok");

    expect(
      await coordinator.revoke({ reference: "Y7-2026-000001", proof: proofB }),
    ).toEqual({ status: "ok" });
    expect(repository.savedGrants.at(-1)?.status).toBe("revoked");
    expect(repository.resource?.record.originalSource).toEqual(
      feedback().originalSource,
    );
    expect(
      await coordinator.retrieve({ reference: "Y7-2026-000001", proof: proofB }),
    ).toEqual({ status: "denied", code: "ACCESS_DENIED" });
  });

  it("persists a bounded Reporter action and returns the updated projection", async () => {
    const { coordinator, repository } = setup();
    const action: ReporterAction = {
      kind: "clarify",
      content: "Le problème survient après reconnexion.",
      actor: "reporter:feedback-1",
      occurredAt: "2026-08-10T16:00:00.000Z",
      eventId: "clarification-1",
    };

    const outcome = await coordinator.act(
      { reference: "Y7-2026-000001", proof: proofA },
      action,
    );

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("expected updated Reporter view");
    expect(outcome.view.messages).toEqual([
      {
        id: "clarification-1",
        audience: "reporter",
        actor: "reporter:feedback-1",
        occurredAt: "2026-08-10T16:00:00.000Z",
        content: "Le problème survient après reconnexion.",
      },
    ]);
    expect(repository.savedRecords).toHaveLength(1);
  });

  it("distinguishes safe retry from denial and exposes no rotated proof on save failure", async () => {
    const { coordinator, repository } = setup();
    repository.failLoad = true;
    expect(
      await coordinator.retrieve({ reference: "Y7-2026-000001", proof: proofA }),
    ).toEqual({ status: "retryable", code: "ACCESS_UNAVAILABLE" });

    repository.failLoad = false;
    repository.failSave = true;
    const failedRotation = await coordinator.rotate({
      reference: "Y7-2026-000001",
      proof: proofA,
    });
    expect(failedRotation).toEqual({ status: "retryable", code: "ACCESS_UNAVAILABLE" });
    expect(failedRotation).not.toHaveProperty("accessProof");

    expect(
      await coordinator.revoke({ reference: "Y7-2026-000001", proof: proofA }),
    ).toEqual({ status: "retryable", code: "ACCESS_UNAVAILABLE" });
    expect(
      await coordinator.act(
        { reference: "Y7-2026-000001", proof: proofA },
        {
          kind: "clarify",
          content: "Valid clarification",
          actor: "reporter:feedback-1",
          occurredAt: "2026-08-10T16:00:00.000Z",
          eventId: "clarification-failed",
        },
      ),
    ).toEqual({ status: "retryable", code: "ACCESS_UNAVAILABLE" });
  });

  it("rejects malformed Reporter actions without changing the record", async () => {
    const { coordinator, repository } = setup();

    const outcome = await coordinator.act(
      { reference: "Y7-2026-000001", proof: proofA },
      {
        kind: "clarify",
        content: " ",
        actor: "reporter:feedback-1",
        occurredAt: "2026-08-10T16:00:00.000Z",
        eventId: "clarification-1",
      },
    );

    expect(outcome).toEqual({ status: "rejected", code: "ACTION_INVALID" });
    expect(repository.savedRecords).toEqual([]);
  });

  it("denies an inconsistent grant-to-record binding", async () => {
    const issued = issueAccessGrant(
      { feedbackId: "feedback-1", reference: "Y7-2026-000001" },
      { createProof: () => proofA, hashProof },
    );
    const inconsistent = new MemoryAccessRepository({
      grant: issued.grant,
      record: { ...feedback(), feedbackId: "feedback-2" },
    });
    const coordinator = createAccountlessAccessCoordinator(inconsistent, {
      matchesProof,
      rotation: { createProof: () => proofB, hashProof },
    });

    expect(
      await coordinator.retrieve({ reference: "Y7-2026-000001", proof: proofA }),
    ).toEqual({ status: "denied", code: "ACCESS_DENIED" });
  });
});
