import { z } from "zod";

import type { AuthoritativeCommit } from "@y7-feedback/domain";

import type { AcceptanceCommit } from "./intake.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

const required = z.string().min(1).max(10_000);
const timestamp = z.iso.datetime({ offset: false, precision: 3 });
const contextValue = z.union([z.string(), z.number().finite(), z.boolean()]);

const attribution = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unidentified") }).strict(),
  z.object({ kind: z.literal("contact"), value: required, purpose: required }).strict(),
  z
    .object({
      kind: z.literal("external"),
      value: required,
      issuer: required,
      applicationId: required,
      purpose: required,
    })
    .strict(),
  z
    .object({
      kind: z.literal("assertion"),
      value: required,
      issuer: required,
      applicationId: required,
      purpose: required,
      assertionVerified: z.boolean(),
    })
    .strict(),
]);

const source = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("bug"),
      problem: required,
      expectedBehavior: required.optional(),
      observedBehavior: required.optional(),
      reproductionSteps: required.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("suggestion"),
      proposal: required,
      rationale: required,
      usageContext: required.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("review"),
      experience: required,
      appreciation: required,
    })
    .strict(),
]);

const attachment = z
  .object({
    id: required,
    objectId: required,
    feedbackId: required,
    workspaceId: required,
    projectId: required,
    audience: z.literal("reporter"),
    sourceEntry: z
      .object({ kind: z.literal("source_submission"), id: required })
      .strict(),
    displayName: required,
    mediaType: required,
    size: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
    sha256: required,
    createdAt: timestamp,
    lifecycle: z.literal("available"),
  })
  .strict();

const acceptance = z
  .object({
    feedback: z
      .object({
        id: required,
        projectId: required,
        workspaceId: required,
        reporterId: required,
        type: z.enum(["bug", "suggestion", "review"]),
        originalSource: source,
        context: z.array(
          z
            .object({
              name: required,
              value: contextValue,
              purpose: required,
              source: z.enum(["public", "client_assertion", "system_observed"]),
              trust: z.enum(["unverified", "verified"]),
            })
            .strict(),
        ),
        attachmentNames: z.array(required).max(5),
        state: z.literal("received"),
        acceptedAt: timestamp,
      })
      .strict(),
    reporter: z.object({ id: required, workspaceId: required, attribution }).strict(),
    lifecycle: z
      .object({
        id: required,
        feedbackId: required,
        priorState: z.null(),
        state: z.literal("received"),
        actor: z.literal("system:intake"),
        occurredAt: timestamp,
        sequence: z.literal(1),
      })
      .strict(),
    accessGrant: z
      .object({
        feedbackId: required,
        reference: required,
        verifier: required,
        generation: z.literal(1),
        status: z.literal("active"),
      })
      .strict(),
    notification: z
      .object({
        id: required,
        feedbackId: required,
        reporterId: required,
        kind: z.literal("feedback_accepted"),
        reference: required,
        createdAt: timestamp,
      })
      .strict(),
    outbox: z
      .object({
        id: required,
        notificationId: required,
        channel: z.enum(["email", "in_product"]),
        status: z.literal("pending"),
        createdAt: timestamp,
        payload: z
          .object({
            kind: z.literal("feedback_accepted"),
            reference: required,
            locale: z.enum(["fr", "en"]),
          })
          .strict(),
      })
      .strict(),
    idempotency: z
      .object({
        scopeKey: required,
        clientOperationId: required,
        payloadDigest: required,
        feedbackId: required,
        reference: required,
        protectedProof: required,
        proofVerifier: required,
        createdAt: timestamp,
      })
      .strict(),
    attachments: z.array(attachment).max(5),
  })
  .strict();

const envelope = z.object({ version: z.literal(1), acceptance }).strict();

function linked(value: AcceptanceCommit, commit: AuthoritativeCommit): boolean {
  const feedbackId = value.feedback.id;
  const reference = value.idempotency.reference;
  return (
    feedbackId === commit.aggregateId &&
    value.feedback.workspaceId === commit.workspaceId &&
    value.feedback.projectId === commit.projectId &&
    value.feedback.acceptedAt === commit.acceptedAt &&
    value.feedback.type === value.feedback.originalSource.type &&
    value.reporter.id === value.feedback.reporterId &&
    value.reporter.workspaceId === commit.workspaceId &&
    value.lifecycle.feedbackId === feedbackId &&
    value.lifecycle.occurredAt === commit.acceptedAt &&
    value.accessGrant.feedbackId === feedbackId &&
    value.accessGrant.reference === reference &&
    value.notification.feedbackId === feedbackId &&
    value.notification.reporterId === value.reporter.id &&
    value.notification.reference === reference &&
    value.notification.createdAt === commit.acceptedAt &&
    value.outbox.notificationId === value.notification.id &&
    value.outbox.createdAt === commit.acceptedAt &&
    value.outbox.payload.reference === reference &&
    value.idempotency.scopeKey === `${commit.workspaceId}:${commit.projectId}` &&
    value.idempotency.clientOperationId === commit.operationId &&
    value.idempotency.payloadDigest === commit.payloadDigest &&
    value.idempotency.feedbackId === feedbackId &&
    value.idempotency.createdAt === commit.acceptedAt &&
    value.attachments.every(
      (item) =>
        item.feedbackId === feedbackId &&
        item.workspaceId === commit.workspaceId &&
        item.projectId === commit.projectId &&
        item.sourceEntry.id === commit.operationId,
    )
  );
}

export function createAuthoritativeIntakeEnvelope(
  persistence: AppwriteSensitivePersistence,
  authoritativeCommitsTableId: string,
) {
  const context = (commitId: string) => ({
    environment: persistence.environment,
    tableId: authoritativeCommitsTableId,
    rowId: commitId,
    field: "sealedPayload",
  });
  return {
    seal(commitId: string, value: AcceptanceCommit): string {
      return persistence.protector.seal(
        context(commitId),
        JSON.stringify({ version: 1, acceptance: value }),
      );
    },
    open(commit: AuthoritativeCommit): AcceptanceCommit {
      try {
        const plaintext = persistence.protector.open(
          context(commit.id),
          commit.sealedPayload,
        );
        const parsed = envelope.parse(JSON.parse(plaintext))
          .acceptance as unknown as AcceptanceCommit;
        if (!linked(parsed, commit)) throw new Error();
        return parsed;
      } catch {
        throw new Error("AUTHORITATIVE_INTAKE_ENVELOPE_INVALID");
      }
    },
  };
}
