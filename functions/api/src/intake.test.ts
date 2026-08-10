import { describe, expect, it, vi } from "vitest";

import type { ValidatedFeedbackDraft } from "@y7-feedback/domain";

import {
  createIntakeCoordinator,
  type AcceptanceCommit,
  type IdempotencyRecord,
  type IntakeDependencies,
  type IntakeStore,
} from "./intake";

const operationId = "018f4f7e-89ab-7def-8123-456789abcdef";
const accessProof = "proof_A_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG";
const proofVerifier = `sha256:${String(accessProof.length)}:${accessProof.slice(0, 7)}`;
const protectedProof = `sealed:${accessProof.split("").reverse().join("")}`;

function draft(problem = "Le solde ne se rafraîchit pas."): ValidatedFeedbackDraft {
  return {
    projectId: "wisemoney",
    workspaceId: "personal",
    type: "bug",
    originalSource: { type: "bug", problem },
    reporter: {
      kind: "contact",
      value: "personne@example.test",
      purpose: "Recontacter la personne au sujet de ce retour",
    },
    context: [
      {
        name: "applicationVersion",
        value: "2.4.1",
        purpose: "Identifier la version concernée",
        source: "public",
        trust: "unverified",
      },
    ],
    attachmentNames: [],
    derivedClassification: null,
  };
}

class MemoryStore implements IntakeStore {
  readonly commits: AcceptanceCommit[] = [];
  readonly records = new Map<string, IdempotencyRecord>();
  failCommit = false;
  failRead = false;

  findIdempotency(
    scopeKey: string,
    clientOperationId: string,
  ): Promise<IdempotencyRecord | null> {
    if (this.failRead) return Promise.reject(new Error("read unavailable"));
    return Promise.resolve(
      this.records.get(`${scopeKey}:${clientOperationId}`) ?? null,
    );
  }

  commit(input: AcceptanceCommit): Promise<void> {
    if (this.failCommit) return Promise.reject(new Error("transaction unavailable"));
    this.commits.push(input);
    this.records.set(
      `${input.idempotency.scopeKey}:${input.idempotency.clientOperationId}`,
      input.idempotency,
    );
    return Promise.resolve();
  }
}

function fixedDependencies(
  overrides: Partial<IntakeDependencies> = {},
): IntakeDependencies {
  return {
    createFeedbackId: () => "feedback-fixed",
    createReporterId: () => "reporter-fixed",
    createHistoryId: () => "history-fixed",
    createNotificationId: () => "notification-fixed",
    createOutboxId: () => "outbox-fixed",
    createReference: () => "Y7-2026-999999",
    createProof: () => accessProof,
    hashProof: (proof) => `sha256:${String(proof.length)}:${proof.slice(0, 7)}`,
    sealProof: (proof) => `sealed:${proof.split("").reverse().join("")}`,
    openProof: (sealed) => sealed.replace("sealed:", "").split("").reverse().join(""),
    digestPayload: (value) => `digest:${JSON.stringify(value)}`,
    now: () => "2026-08-10T15:00:00.000Z",
    ...overrides,
  };
}

function setup(store = new MemoryStore()) {
  const counters = {
    feedback: 0,
    reporter: 0,
    history: 0,
    notification: 0,
    outbox: 0,
    reference: 0,
  };
  const coordinator = createIntakeCoordinator(store, {
    createFeedbackId: () => `feedback-${String(++counters.feedback)}`,
    createReporterId: () => `reporter-${String(++counters.reporter)}`,
    createHistoryId: () => `history-${String(++counters.history)}`,
    createNotificationId: () => `notification-${String(++counters.notification)}`,
    createOutboxId: () => `outbox-${String(++counters.outbox)}`,
    createReference: () => `Y7-2026-${String(++counters.reference).padStart(6, "0")}`,
    createProof: () => accessProof,
    hashProof: (proof) => `sha256:${String(proof.length)}:${proof.slice(0, 7)}`,
    sealProof: (proof) => `sealed:${proof.split("").reverse().join("")}`,
    openProof: (sealed) => sealed.replace("sealed:", "").split("").reverse().join(""),
    digestPayload: (value) => `digest:${JSON.stringify(value)}`,
    now: () => "2026-08-10T15:00:00.000Z",
  });
  return { coordinator, counters, store };
}

describe("trusted intake coordination", () => {
  it("BDD-INTAKE-001 commits the complete acceptance invariant before success", async () => {
    const { coordinator, store } = setup();

    const outcome = await coordinator.accept({
      clientOperationId: operationId,
      draft: draft(),
    });

    expect(outcome).toEqual({
      status: "accepted",
      feedbackId: "feedback-1",
      reference: "Y7-2026-000001",
      accessProof,
      replayed: false,
    });
    expect(store.commits).toHaveLength(1);
    expect(store.commits[0]).toEqual({
      feedback: {
        id: "feedback-1",
        projectId: "wisemoney",
        workspaceId: "personal",
        reporterId: "reporter-1",
        type: "bug",
        originalSource: { type: "bug", problem: "Le solde ne se rafraîchit pas." },
        context: draft().context,
        attachmentNames: [],
        state: "received",
        acceptedAt: "2026-08-10T15:00:00.000Z",
      },
      reporter: {
        id: "reporter-1",
        workspaceId: "personal",
        attribution: draft().reporter,
      },
      lifecycle: {
        id: "history-1",
        feedbackId: "feedback-1",
        priorState: null,
        state: "received",
        actor: "system:intake",
        occurredAt: "2026-08-10T15:00:00.000Z",
        sequence: 1,
      },
      accessGrant: {
        feedbackId: "feedback-1",
        reference: "Y7-2026-000001",
        verifier: proofVerifier,
        generation: 1,
        status: "active",
      },
      notification: {
        id: "notification-1",
        feedbackId: "feedback-1",
        reporterId: "reporter-1",
        kind: "feedback_accepted",
        reference: "Y7-2026-000001",
        createdAt: "2026-08-10T15:00:00.000Z",
      },
      outbox: {
        id: "outbox-1",
        notificationId: "notification-1",
        channel: "email",
        status: "pending",
        createdAt: "2026-08-10T15:00:00.000Z",
        payload: {
          kind: "feedback_accepted",
          reference: "Y7-2026-000001",
          locale: "fr",
        },
      },
      idempotency: {
        scopeKey: "personal:wisemoney",
        clientOperationId: operationId,
        payloadDigest: `digest:${JSON.stringify(draft())}`,
        feedbackId: "feedback-1",
        reference: "Y7-2026-000001",
        protectedProof,
        proofVerifier,
        createdAt: "2026-08-10T15:00:00.000Z",
      },
    });
    expect(JSON.stringify(store.commits[0])).not.toContain(accessProof);
  });

  it("BDD-INTAKE-002 returns the original result after response loss without another effect", async () => {
    const { coordinator, counters, store } = setup();
    const command = { clientOperationId: operationId, draft: draft() };

    const first = await coordinator.accept(command);
    const replay = await coordinator.accept(command);

    expect(first).toEqual(
      expect.objectContaining({ status: "accepted", replayed: false }),
    );
    expect(replay).toEqual({
      status: "accepted",
      feedbackId: "feedback-1",
      reference: "Y7-2026-000001",
      accessProof,
      replayed: true,
    });
    expect(store.commits).toHaveLength(1);
    expect(counters.feedback).toBe(1);
    expect(counters.reference).toBe(1);
  });

  it("rejects changed-payload operation reuse without disclosing the prior result", async () => {
    const { coordinator, store } = setup();
    await coordinator.accept({ clientOperationId: operationId, draft: draft() });

    const conflict = await coordinator.accept({
      clientOperationId: operationId,
      draft: draft("Un autre problème."),
    });

    expect(conflict).toEqual({ status: "rejected", code: "OPERATION_CONFLICT" });
    expect(conflict).not.toHaveProperty("reference");
    expect(conflict).not.toHaveProperty("accessProof");
    expect(store.commits).toHaveLength(1);
  });

  it("BDD-INTAKE-003 returns retryable without partial state on transaction failure", async () => {
    const store = new MemoryStore();
    store.failCommit = true;
    const { coordinator } = setup(store);

    const outcome = await coordinator.accept({
      clientOperationId: operationId,
      draft: draft(),
    });

    expect(outcome).toEqual({ status: "retryable", code: "INTAKE_UNAVAILABLE" });
    expect(outcome).not.toHaveProperty("reference");
    expect(outcome).not.toHaveProperty("accessProof");
    expect(store.commits).toEqual([]);
    expect(store.records.size).toBe(0);
  });

  it("fails closed for invalid operation identity, read failure, and protected-proof failure", async () => {
    const invalid = setup().coordinator;
    expect(
      await invalid.accept({
        clientOperationId: "not-an-operation-id",
        draft: draft(),
      }),
    ).toEqual({ status: "rejected", code: "INTAKE_INVALID" });

    const failedReadStore = new MemoryStore();
    failedReadStore.failRead = true;
    expect(
      await setup(failedReadStore).coordinator.accept({
        clientOperationId: operationId,
        draft: draft(),
      }),
    ).toEqual({ status: "retryable", code: "INTAKE_UNAVAILABLE" });

    const store = new MemoryStore();
    const coordinator = createIntakeCoordinator(store, {
      createFeedbackId: () => "feedback-1",
      createReporterId: () => "reporter-1",
      createHistoryId: () => "history-1",
      createNotificationId: () => "notification-1",
      createOutboxId: () => "outbox-1",
      createReference: () => "Y7-2026-000001",
      createProof: () => accessProof,
      hashProof: () => "sha256:verifier",
      sealProof: () => {
        throw new Error("seal unavailable");
      },
      openProof: () => {
        throw new Error("open unavailable");
      },
      digestPayload: () => "digest",
      now: () => "2026-08-10T15:00:00.000Z",
    });

    expect(
      await coordinator.accept({ clientOperationId: operationId, draft: draft() }),
    ).toEqual({ status: "retryable", code: "INTAKE_UNAVAILABLE" });
    expect(store.commits).toEqual([]);
  });

  it("returns retryable without reference when a stored proof envelope cannot open", async () => {
    const store = new MemoryStore();
    const first = setup(store);
    await first.coordinator.accept({ clientOperationId: operationId, draft: draft() });
    const openProof = vi.fn(() => {
      throw new Error("key unavailable");
    });
    const coordinator = createIntakeCoordinator(store, {
      createFeedbackId: () => "unused-feedback",
      createReporterId: () => "unused-reporter",
      createHistoryId: () => "unused-history",
      createNotificationId: () => "unused-notification",
      createOutboxId: () => "unused-outbox",
      createReference: () => "Y7-2026-unused",
      createProof: () => accessProof,
      hashProof: () => "unused-verifier",
      sealProof: () => "unused-envelope",
      openProof,
      digestPayload: (value) => `digest:${JSON.stringify(value)}`,
      now: () => "2026-08-10T15:00:00.000Z",
    });

    const outcome = await coordinator.accept({
      clientOperationId: operationId,
      draft: draft(),
    });

    expect(outcome).toEqual({ status: "retryable", code: "INTAKE_UNAVAILABLE" });
    expect(outcome).not.toHaveProperty("reference");
    expect(openProof).toHaveBeenCalledOnce();
    expect(store.commits).toHaveLength(1);
  });

  it("rejects short or integrity-mismatched replay envelopes", async () => {
    const store = new MemoryStore();
    await setup(store).coordinator.accept({
      clientOperationId: operationId,
      draft: draft(),
    });

    const shortProofCoordinator = createIntakeCoordinator(
      store,
      fixedDependencies({ openProof: () => "short" }),
    );
    expect(
      await shortProofCoordinator.accept({
        clientOperationId: operationId,
        draft: draft(),
      }),
    ).toEqual({ status: "retryable", code: "INTAKE_UNAVAILABLE" });

    const mismatchedCoordinator = createIntakeCoordinator(
      store,
      fixedDependencies({
        openProof: () => accessProof,
        hashProof: () => "wrong-verifier",
      }),
    );
    expect(
      await mismatchedCoordinator.accept({
        clientOperationId: operationId,
        draft: draft(),
      }),
    ).toEqual({ status: "retryable", code: "INTAKE_UNAVAILABLE" });
  });

  it("rejects an unprotected proof envelope before committing", async () => {
    const store = new MemoryStore();
    const coordinator = createIntakeCoordinator(
      store,
      fixedDependencies({ sealProof: (proof) => proof }),
    );

    expect(
      await coordinator.accept({ clientOperationId: operationId, draft: draft() }),
    ).toEqual({ status: "retryable", code: "INTAKE_UNAVAILABLE" });
    expect(store.commits).toEqual([]);
  });

  it("uses an in-product outbox and explicit English locale without eligible contact", async () => {
    const store = new MemoryStore();
    const coordinator = createIntakeCoordinator(store, fixedDependencies());
    const unidentifiedDraft: ValidatedFeedbackDraft = {
      ...draft(),
      reporter: { kind: "unidentified" },
    };

    const outcome = await coordinator.accept({
      clientOperationId: operationId,
      draft: unidentifiedDraft,
      locale: "en",
    });

    expect(outcome.status).toBe("accepted");
    expect(store.commits[0]?.outbox.channel).toBe("in_product");
    expect(store.commits[0]?.outbox.payload.locale).toBe("en");
  });

  it("fails closed when a dependency returns an empty or oversized value", async () => {
    const emptyDigest = createIntakeCoordinator(
      new MemoryStore(),
      fixedDependencies({ digestPayload: () => " " }),
    );
    expect(
      await emptyDigest.accept({ clientOperationId: operationId, draft: draft() }),
    ).toEqual({ status: "retryable", code: "INTAKE_UNAVAILABLE" });

    const oversizedDigest = createIntakeCoordinator(
      new MemoryStore(),
      fixedDependencies({ digestPayload: () => "x".repeat(1_001) }),
    );
    expect(
      await oversizedDigest.accept({ clientOperationId: operationId, draft: draft() }),
    ).toEqual({ status: "retryable", code: "INTAKE_UNAVAILABLE" });
  });
});
