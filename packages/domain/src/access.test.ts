import { describe, expect, it } from "vitest";

import {
  AccessPolicyError,
  applyReporterAction,
  authorizeAccess,
  issueAccessGrant,
  projectReporterFeedback,
  revokeAccessGrant,
  rotateAccessGrant,
  type ReporterFeedbackRecord,
} from "./access";

const proofA = "proof_A_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG";
const proofB = "proof_B_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG";
const verifierFor = (value: string) =>
  `hash:${String(value.length)}:${value.slice(0, 7)}`;
const grantDependencies = (proof: string) => ({
  createProof: () => proof,
  hashProof: verifierFor,
});
const matchesProof = (proof: string, verifier: string) =>
  verifier === verifierFor(proof);

function record(): ReporterFeedbackRecord {
  return {
    feedbackId: "feedback-1",
    reference: "Y7-2026-000001",
    originalSource: { type: "review", experience: "Rapide", appreciation: "Clair" },
    currentSource: { type: "review", experience: "Rapide", appreciation: "Clair" },
    currentState: "received",
    history: [
      {
        id: "event-1",
        kind: "received",
        audience: "reporter",
        actor: "system:intake",
        occurredAt: "2026-08-10T13:00:00.000Z",
        detail: "received",
      },
      {
        id: "event-2",
        kind: "classification",
        audience: "workspace",
        actor: "maintainer-1",
        occurredAt: "2026-08-10T13:01:00.000Z",
        detail: "internal-priority",
      },
    ],
    messages: [
      {
        id: "message-1",
        audience: "reporter",
        actor: "maintainer-1",
        occurredAt: "2026-08-10T13:02:00.000Z",
        content: "Merci pour votre retour.",
      },
      {
        id: "message-2",
        audience: "workspace",
        actor: "maintainer-1",
        occurredAt: "2026-08-10T13:03:00.000Z",
        content: "Diagnostic interne.",
      },
    ],
    attachments: [
      { id: "attachment-1", audience: "reporter", name: "capture.png" },
      { id: "attachment-2", audience: "workspace", name: "diagnostic.txt" },
    ],
    sourceRevisions: [],
    deletionRequests: [],
    internalNotes: ["Never project this"],
    workspaceClassification: "internal-priority",
  };
}

function expectDenied(action: () => unknown) {
  expect(action).toThrow(
    expect.objectContaining<Partial<AccessPolicyError>>({ code: "ACCESS_DENIED" }),
  );
}

describe("Feedback-specific access proof", () => {
  it("BDD-ACC-001 stores only a verifier and denies every non-authorizing attempt alike", () => {
    const issued = issueAccessGrant(
      { feedbackId: "feedback-1", reference: "Y7-2026-000001" },
      grantDependencies(proofA),
    );

    expect(issued.proof).toBe(proofA);
    expect(issued.grant).toEqual({
      feedbackId: "feedback-1",
      reference: "Y7-2026-000001",
      verifier: verifierFor(proofA),
      generation: 1,
      status: "active",
    });
    expect(JSON.stringify(issued.grant)).not.toContain(proofA);
    expect(
      authorizeAccess(
        issued.grant,
        { reference: issued.grant.reference, proof: proofA },
        matchesProof,
      ),
    ).toBe("feedback-1");

    expectDenied(() =>
      authorizeAccess(
        issued.grant,
        { reference: issued.grant.reference },
        matchesProof,
      ),
    );
    expectDenied(() =>
      authorizeAccess(
        issued.grant,
        { reference: issued.grant.reference, proof: proofB },
        matchesProof,
      ),
    );
    expectDenied(() =>
      authorizeAccess(
        undefined,
        { reference: "Y7-2026-999999", proof: proofA },
        matchesProof,
      ),
    );
    expectDenied(() =>
      authorizeAccess(
        issued.grant,
        { reference: "Y7-2026-999999", proof: proofA },
        matchesProof,
      ),
    );
  });

  it("BDD-ACC-002 rotates and revokes without changing reference or Feedback scope", () => {
    const issued = issueAccessGrant(
      { feedbackId: "feedback-1", reference: "Y7-2026-000001" },
      grantDependencies(proofA),
    );
    const rotated = rotateAccessGrant(issued.grant, grantDependencies(proofB));

    expect(rotated.grant.reference).toBe(issued.grant.reference);
    expect(rotated.grant.feedbackId).toBe(issued.grant.feedbackId);
    expect(rotated.grant.generation).toBe(2);
    expectDenied(() =>
      authorizeAccess(
        rotated.grant,
        { reference: rotated.grant.reference, proof: proofA },
        matchesProof,
      ),
    );
    expect(
      authorizeAccess(
        rotated.grant,
        { reference: rotated.grant.reference, proof: proofB },
        matchesProof,
      ),
    ).toBe("feedback-1");

    const revoked = revokeAccessGrant(rotated.grant);
    expect(revoked.status).toBe("revoked");
    expect(revoked.reference).toBe(issued.grant.reference);
    expectDenied(() =>
      authorizeAccess(
        revoked,
        { reference: revoked.reference, proof: proofB },
        matchesProof,
      ),
    );
    expectDenied(() => rotateAccessGrant(revoked, grantDependencies(proofA)));
  });

  it("rejects weak generated proofs and malformed grant input", () => {
    expect(() =>
      issueAccessGrant(
        { feedbackId: "feedback-1", reference: "Y7-2026-000001" },
        grantDependencies("too-short"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<AccessPolicyError>>({
        code: "ACCESS_CONFIGURATION_INVALID",
      }),
    );
    expectDenied(() =>
      authorizeAccess(
        issueAccessGrant(
          { feedbackId: "feedback-1", reference: "Y7-2026-000001" },
          grantDependencies(proofA),
        ).grant,
        { reference: "Y7-2026-000001", proof: proofA },
        () => {
          throw new Error("hash provider unavailable");
        },
      ),
    );
    expect(() =>
      issueAccessGrant(
        { feedbackId: " ", reference: "Y7-2026-000001" },
        grantDependencies(proofA),
      ),
    ).toThrow(
      expect.objectContaining<Partial<AccessPolicyError>>({
        code: "ACCESS_CONFIGURATION_INVALID",
      }),
    );
  });
});

describe("Reporter-safe projection and actions", () => {
  it("BDD-ACC-003 projects only reporter-visible categories", () => {
    const view = projectReporterFeedback(record(), "feedback-1");

    expect(view).toEqual({
      feedbackId: "feedback-1",
      reference: "Y7-2026-000001",
      originalSource: { type: "review", experience: "Rapide", appreciation: "Clair" },
      currentSource: { type: "review", experience: "Rapide", appreciation: "Clair" },
      currentState: "received",
      history: [expect.objectContaining({ id: "event-1", audience: "reporter" })],
      messages: [expect.objectContaining({ id: "message-1", audience: "reporter" })],
      attachments: [{ id: "attachment-1", audience: "reporter", name: "capture.png" }],
      sourceRevisions: [],
      deletionRequests: [],
    });
    expect(JSON.stringify(view)).not.toMatch(
      /Never project|internal-priority|Diagnostic interne/,
    );
    expectDenied(() => projectReporterFeedback(record(), "feedback-2"));
  });

  it("keeps original source while appending attributable revisions and clarification", () => {
    const revised = applyReporterAction(record(), "feedback-1", {
      kind: "revise_source",
      source: { type: "review", experience: "Très rapide", appreciation: "Clair" },
      actor: "reporter:feedback-1",
      occurredAt: "2026-08-10T14:00:00.000Z",
      eventId: "revision-1",
    });
    const clarified = applyReporterAction(revised, "feedback-1", {
      kind: "clarify",
      content: "Cela arrive après reconnexion.",
      actor: "reporter:feedback-1",
      occurredAt: "2026-08-10T14:01:00.000Z",
      eventId: "clarification-1",
    });

    expect(clarified.originalSource).toEqual(record().originalSource);
    expect(clarified.currentSource).toEqual({
      type: "review",
      experience: "Très rapide",
      appreciation: "Clair",
    });
    expect(clarified.sourceRevisions).toEqual([
      expect.objectContaining({ id: "revision-1", actor: "reporter:feedback-1" }),
    ]);
    expect(clarified.messages.at(-1)).toEqual({
      id: "clarification-1",
      audience: "reporter",
      actor: "reporter:feedback-1",
      occurredAt: "2026-08-10T14:01:00.000Z",
      content: "Cela arrive après reconnexion.",
    });
  });

  it("records a deletion request without claiming purge and denies malformed or sibling actions", () => {
    const requested = applyReporterAction(record(), "feedback-1", {
      kind: "request_deletion",
      reason: "Je souhaite retirer ce retour.",
      actor: "reporter:feedback-1",
      occurredAt: "2026-08-10T14:02:00.000Z",
      eventId: "deletion-1",
    });

    expect(requested.deletionRequests).toEqual([
      {
        id: "deletion-1",
        status: "received",
        reason: "Je souhaite retirer ce retour.",
        actor: "reporter:feedback-1",
        occurredAt: "2026-08-10T14:02:00.000Z",
      },
    ]);
    expect(requested.currentState).toBe("received");
    expectDenied(() =>
      applyReporterAction(record(), "feedback-2", {
        kind: "clarify",
        content: "Sibling attempt",
        actor: "reporter:feedback-2",
        occurredAt: "2026-08-10T14:03:00.000Z",
        eventId: "clarification-2",
      }),
    );
    expect(() =>
      applyReporterAction(record(), "feedback-1", {
        kind: "clarify",
        content: " ",
        actor: "reporter:feedback-1",
        occurredAt: "2026-08-10T14:03:00.000Z",
        eventId: "clarification-3",
      }),
    ).toThrow(
      expect.objectContaining<Partial<AccessPolicyError>>({
        code: "REPORTER_ACTION_INVALID",
      }),
    );
    expect(() =>
      applyReporterAction(record(), "feedback-1", {
        kind: "clarify",
        content: "Valid content",
        actor: "reporter:feedback-1",
        occurredAt: "not-a-dateZ",
        eventId: "clarification-4",
      }),
    ).toThrow(
      expect.objectContaining<Partial<AccessPolicyError>>({
        code: "REPORTER_ACTION_INVALID",
      }),
    );
    expect(() =>
      applyReporterAction(record(), "feedback-1", {
        kind: "clarify",
        content: "Valid content",
        actor: "reporter:feedback-1",
        occurredAt: "not-a-date",
        eventId: "clarification-5",
      }),
    ).toThrow(
      expect.objectContaining<Partial<AccessPolicyError>>({
        code: "REPORTER_ACTION_INVALID",
      }),
    );
    expect(() =>
      applyReporterAction(record(), "feedback-1", {
        kind: "revise_source",
        source: { type: "review", experience: "Changed", appreciation: "Changed" },
        actor: "reporter:feedback-1",
        occurredAt: "2026-08-10T14:04:00.000Z",
        eventId: "revision-2",
      }),
    ).not.toThrow();

    const bugRecord = {
      ...record(),
      currentSource: {
        type: "bug" as const,
        problem: "Problem",
      },
    };
    expect(() =>
      applyReporterAction(bugRecord, "feedback-1", {
        kind: "revise_source",
        source: { type: "review", experience: "Changed", appreciation: "Changed" },
        actor: "reporter:feedback-1",
        occurredAt: "2026-08-10T14:04:00.000Z",
        eventId: "revision-3",
      }),
    ).toThrow(
      expect.objectContaining<Partial<AccessPolicyError>>({
        code: "REPORTER_ACTION_INVALID",
      }),
    );
  });
});
