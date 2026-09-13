import { createHash } from "node:crypto";

import { planAuthoritativeCommit } from "@y7-feedback/domain";

import type { AuthoritativeIntakeEnvelopeReader } from "./authoritative-intake-projector.js";
import type { AcceptanceCommit } from "./intake.js";
import type { AuthoritativeCommitStore } from "./appwrite-authoritative-commit-store.js";

export interface AuthoritativeIntakeEnvelopeCodec extends AuthoritativeIntakeEnvelopeReader {
  seal(commitId: string, value: AcceptanceCommit): string;
}

export interface AuthoritativeIntakeAcceptanceStore {
  acceptAuthoritatively(input: AcceptanceCommit): Promise<{
    readonly acceptance: AcceptanceCommit;
    readonly replayed: boolean;
  }>;
}

function commitId(
  environment: "preview" | "production",
  acceptance: AcceptanceCommit,
): string {
  return `commit_${createHash("sha256")
    .update(environment)
    .update("\0")
    .update(acceptance.idempotency.scopeKey)
    .update("\0")
    .update(acceptance.idempotency.clientOperationId)
    .digest("hex")
    .slice(0, 29)}`;
}

export function createAuthoritativeIntakeStore(
  environment: "preview" | "production",
  commits: AuthoritativeCommitStore,
  envelope: AuthoritativeIntakeEnvelopeCodec,
): AuthoritativeIntakeAcceptanceStore {
  return {
    async acceptAuthoritatively(input) {
      const id = commitId(environment, input);
      const sealedPayload = envelope.seal(id, input);
      const planned = planAuthoritativeCommit(
        {
          environment,
          aggregateKind: "feedback",
          aggregateId: input.feedback.id,
          operationId: input.idempotency.clientOperationId,
          commandKind: "feedback.accepted",
          workspaceId: input.feedback.workspaceId,
          projectId: input.feedback.projectId,
          actorKind: "system",
          actorId: "intake",
          payloadDigest: input.idempotency.payloadDigest,
          sealedPayload,
          acceptedAt: input.feedback.acceptedAt,
        },
        () => id,
      );
      const result = await commits.accept(planned);
      if (result.commit.id !== id) {
        throw new Error("AUTHORITATIVE_INTAKE_COMMIT_INVALID");
      }
      return result.status === "replayed"
        ? { acceptance: envelope.open(result.commit), replayed: true }
        : { acceptance: input, replayed: false };
    },
  };
}
