import type { AuthoritativeCommit } from "@y7-feedback/domain";

import type { AuthoritativeProjectionHandler } from "./authoritative-projector.js";
import type { AcceptanceCommit, IdempotencyRecord, IntakeStore } from "./intake.js";

export interface AuthoritativeIntakeEnvelopeReader {
  open(commit: AuthoritativeCommit): AcceptanceCommit;
}

function sameIdempotency(left: IdempotencyRecord, right: IdempotencyRecord): boolean {
  return (
    left.scopeKey === right.scopeKey &&
    left.clientOperationId === right.clientOperationId &&
    left.payloadDigest === right.payloadDigest &&
    left.feedbackId === right.feedbackId &&
    left.reference === right.reference &&
    left.protectedProof === right.protectedProof &&
    left.proofVerifier === right.proofVerifier &&
    left.createdAt === right.createdAt
  );
}

export function createAuthoritativeIntakeProjectionHandler(
  envelope: AuthoritativeIntakeEnvelopeReader,
  normalizedStore: IntakeStore,
): AuthoritativeProjectionHandler {
  return {
    async project(commit) {
      if (commit.commandKind !== "feedback.accepted") {
        throw new Error("AUTHORITATIVE_INTAKE_COMMAND_UNSUPPORTED");
      }
      const acceptance = envelope.open(commit);
      const expected = acceptance.idempotency;
      const existing = await normalizedStore.findIdempotency(
        expected.scopeKey,
        expected.clientOperationId,
      );
      if (existing !== null) {
        if (!sameIdempotency(existing, expected)) {
          throw new Error("AUTHORITATIVE_INTAKE_PROJECTION_CONFLICT");
        }
        return;
      }
      await normalizedStore.commit(acceptance);
    },
  };
}
