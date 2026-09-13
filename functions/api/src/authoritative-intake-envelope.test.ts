import { describe, expect, it, vi } from "vitest";

import { planAuthoritativeCommit } from "@y7-feedback/domain";

import { createAuthoritativeIntakeEnvelope } from "./authoritative-intake-envelope.js";
import type { AcceptanceCommit } from "./intake.js";

const operationId = "018f4f7e-89ab-7def-8123-456789abcdef";
const acceptedAt = "2026-09-13T02:00:00.000Z";
const digest = "digest_0123456789abcdef";

function acceptance(): AcceptanceCommit {
  return {
    feedback: {
      id: "feedback_1",
      projectId: "project_1",
      workspaceId: "workspace_1",
      reporterId: "reporter_1",
      type: "bug",
      originalSource: { type: "bug", problem: "Broken balance" },
      context: [
        {
          name: "version",
          value: "1.0.0",
          purpose: "diagnostic",
          source: "public",
          trust: "unverified",
        },
      ],
      attachmentNames: ["evidence.txt"],
      state: "received",
      acceptedAt,
    },
    reporter: {
      id: "reporter_1",
      workspaceId: "workspace_1",
      attribution: { kind: "contact", value: "user@example.test", purpose: "reply" },
    },
    lifecycle: {
      id: "history_1",
      feedbackId: "feedback_1",
      priorState: null,
      state: "received",
      actor: "system:intake",
      occurredAt: acceptedAt,
      sequence: 1,
    },
    accessGrant: {
      feedbackId: "feedback_1",
      reference: "Y7-2026-000001",
      verifier: "verifier_0123456789",
      generation: 1,
      status: "active",
    },
    notification: {
      id: "notification_1",
      feedbackId: "feedback_1",
      reporterId: "reporter_1",
      kind: "feedback_accepted",
      reference: "Y7-2026-000001",
      createdAt: acceptedAt,
    },
    outbox: {
      id: "outbox_1",
      notificationId: "notification_1",
      channel: "email",
      status: "pending",
      createdAt: acceptedAt,
      payload: {
        kind: "feedback_accepted",
        reference: "Y7-2026-000001",
        locale: "fr",
      },
    },
    idempotency: {
      scopeKey: "workspace_1:project_1",
      clientOperationId: operationId,
      payloadDigest: digest,
      feedbackId: "feedback_1",
      reference: "Y7-2026-000001",
      protectedProof: "protected_proof",
      proofVerifier: "verifier_0123456789",
      createdAt: acceptedAt,
    },
    attachments: [
      {
        id: "attachment_1",
        objectId: "private/workspace_1/project_1/attachment_1",
        feedbackId: "feedback_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        audience: "reporter",
        sourceEntry: { kind: "source_submission", id: operationId },
        displayName: "evidence.txt",
        mediaType: "text/plain; charset=utf-8",
        size: 12,
        sha256: "A".repeat(43),
        createdAt: acceptedAt,
        lifecycle: "available",
      },
    ],
  };
}

function authoritative(sealedPayload = "sealed") {
  return planAuthoritativeCommit(
    {
      environment: "preview",
      aggregateKind: "feedback",
      aggregateId: "feedback_1",
      operationId,
      commandKind: "feedback.accepted",
      workspaceId: "workspace_1",
      projectId: "project_1",
      actorKind: "system",
      actorId: "intake",
      payloadDigest: digest,
      sealedPayload,
      acceptedAt,
    },
    () => "commit_a",
  );
}

function setup(opened?: string) {
  const seal = vi.fn((_context, plaintext: string) => `sealed:${plaintext}`);
  const open = vi.fn((_context, payload: string) => opened ?? payload.slice(7));
  return {
    seal,
    open,
    envelope: createAuthoritativeIntakeEnvelope(
      { environment: "preview", protector: { seal, open } },
      "authoritative_commits",
    ),
  };
}

describe("ADR-015 authoritative intake envelope", () => {
  it("BDD-SLO-451 seals and validates the complete intake payload", () => {
    const target = setup();
    const payload = target.envelope.seal("commit_a", acceptance());
    expect(target.envelope.open(authoritative(payload))).toEqual(acceptance());
    expect(target.seal).toHaveBeenCalledWith(
      {
        environment: "preview",
        tableId: "authoritative_commits",
        rowId: "commit_a",
        field: "sealedPayload",
      },
      expect.any(String),
    );
  });

  it.each([
    [
      "feedback id",
      (value: AcceptanceCommit) => ({
        ...value,
        feedback: { ...value.feedback, id: "other" },
      }),
    ],
    [
      "workspace",
      (value: AcceptanceCommit) => ({
        ...value,
        feedback: { ...value.feedback, workspaceId: "other" },
      }),
    ],
    [
      "project",
      (value: AcceptanceCommit) => ({
        ...value,
        feedback: { ...value.feedback, projectId: "other" },
      }),
    ],
    [
      "accepted time",
      (value: AcceptanceCommit) => ({
        ...value,
        feedback: { ...value.feedback, acceptedAt: "2026-09-13T02:00:01.000Z" },
      }),
    ],
    [
      "source type",
      (value: AcceptanceCommit) => ({
        ...value,
        feedback: { ...value.feedback, type: "review" as const },
      }),
    ],
    [
      "reporter id",
      (value: AcceptanceCommit) => ({
        ...value,
        reporter: { ...value.reporter, id: "other" },
      }),
    ],
    [
      "reporter workspace",
      (value: AcceptanceCommit) => ({
        ...value,
        reporter: { ...value.reporter, workspaceId: "other" },
      }),
    ],
    [
      "lifecycle feedback",
      (value: AcceptanceCommit) => ({
        ...value,
        lifecycle: { ...value.lifecycle, feedbackId: "other" },
      }),
    ],
    [
      "lifecycle time",
      (value: AcceptanceCommit) => ({
        ...value,
        lifecycle: { ...value.lifecycle, occurredAt: "2026-09-13T02:00:01.000Z" },
      }),
    ],
    [
      "grant feedback",
      (value: AcceptanceCommit) => ({
        ...value,
        accessGrant: { ...value.accessGrant, feedbackId: "other" },
      }),
    ],
    [
      "grant reference",
      (value: AcceptanceCommit) => ({
        ...value,
        accessGrant: { ...value.accessGrant, reference: "other" },
      }),
    ],
    [
      "notification feedback",
      (value: AcceptanceCommit) => ({
        ...value,
        notification: { ...value.notification, feedbackId: "other" },
      }),
    ],
    [
      "notification reporter",
      (value: AcceptanceCommit) => ({
        ...value,
        notification: { ...value.notification, reporterId: "other" },
      }),
    ],
    [
      "notification reference",
      (value: AcceptanceCommit) => ({
        ...value,
        notification: { ...value.notification, reference: "other" },
      }),
    ],
    [
      "notification time",
      (value: AcceptanceCommit) => ({
        ...value,
        notification: { ...value.notification, createdAt: "2026-09-13T02:00:01.000Z" },
      }),
    ],
    [
      "outbox notification",
      (value: AcceptanceCommit) => ({
        ...value,
        outbox: { ...value.outbox, notificationId: "other" },
      }),
    ],
    [
      "outbox time",
      (value: AcceptanceCommit) => ({
        ...value,
        outbox: { ...value.outbox, createdAt: "2026-09-13T02:00:01.000Z" },
      }),
    ],
    [
      "outbox reference",
      (value: AcceptanceCommit) => ({
        ...value,
        outbox: {
          ...value.outbox,
          payload: { ...value.outbox.payload, reference: "other" },
        },
      }),
    ],
    [
      "scope",
      (value: AcceptanceCommit) => ({
        ...value,
        idempotency: { ...value.idempotency, scopeKey: "other" },
      }),
    ],
    [
      "operation",
      (value: AcceptanceCommit) => ({
        ...value,
        idempotency: { ...value.idempotency, clientOperationId: "other" },
      }),
    ],
    [
      "digest",
      (value: AcceptanceCommit) => ({
        ...value,
        idempotency: { ...value.idempotency, payloadDigest: "other_digest_123456" },
      }),
    ],
    [
      "idempotency feedback",
      (value: AcceptanceCommit) => ({
        ...value,
        idempotency: { ...value.idempotency, feedbackId: "other" },
      }),
    ],
    [
      "idempotency time",
      (value: AcceptanceCommit) => ({
        ...value,
        idempotency: { ...value.idempotency, createdAt: "2026-09-13T02:00:01.000Z" },
      }),
    ],
    [
      "attachment feedback",
      (value: AcceptanceCommit) => ({
        ...value,
        attachments: [{ ...value.attachments[0]!, feedbackId: "other" }],
      }),
    ],
    [
      "attachment workspace",
      (value: AcceptanceCommit) => ({
        ...value,
        attachments: [{ ...value.attachments[0]!, workspaceId: "other" }],
      }),
    ],
    [
      "attachment project",
      (value: AcceptanceCommit) => ({
        ...value,
        attachments: [{ ...value.attachments[0]!, projectId: "other" }],
      }),
    ],
    [
      "attachment operation",
      (value: AcceptanceCommit) => ({
        ...value,
        attachments: [
          {
            ...value.attachments[0]!,
            sourceEntry: { kind: "source_submission" as const, id: "other" },
          },
        ],
      }),
    ],
  ])("BDD-SLO-452 rejects a mismatched %s", (_label, mutate) => {
    const value = mutate(acceptance());
    const target = setup(JSON.stringify({ version: 1, acceptance: value }));
    expect(() => target.envelope.open(authoritative())).toThrow(
      "AUTHORITATIVE_INTAKE_ENVELOPE_INVALID",
    );
  });

  it.each([
    ["invalid JSON", "{"],
    ["unknown version", JSON.stringify({ version: 2, acceptance: acceptance() })],
    [
      "extra field",
      JSON.stringify({ version: 1, acceptance: acceptance(), extra: true }),
    ],
    [
      "invalid nested field",
      JSON.stringify({ version: 1, acceptance: { ...acceptance(), feedback: null } }),
    ],
  ])("BDD-SLO-453 rejects %s", (_label, plaintext) => {
    const target = setup(plaintext);
    expect(() => target.envelope.open(authoritative())).toThrow(
      "AUTHORITATIVE_INTAKE_ENVELOPE_INVALID",
    );
  });
});
