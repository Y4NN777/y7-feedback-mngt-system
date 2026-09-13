import { createHash } from "node:crypto";

import { AuthoritativeCommitError, planAuthoritativeCommit } from "@y7-feedback/domain";

import type { AuthoritativeCommitStore } from "./appwrite-authoritative-commit-store.js";
import type {
  ConversationLifecycleStore,
  ConversationLifecycleStoreInput,
  ConversationLifecycleStoreResult,
} from "./appwrite-conversation-lifecycle-store.js";
import type { AuthoritativeConversationPayload } from "./authoritative-conversation-envelope.js";

export interface AuthoritativeConversationEnvelopeCodec {
  seal(commitId: string, value: AuthoritativeConversationPayload): string;
  open(
    commit: Parameters<AuthoritativeCommitStore["accept"]>[0],
  ): AuthoritativeConversationPayload;
}

export interface ConversationLifecyclePreflight {
  plan(input: ConversationLifecycleStoreInput): Promise<{
    readonly result: ConversationLifecycleStoreResult & { readonly status: "applied" };
    readonly workspaceId: string;
    readonly projectId: string;
  }>;
}

function commitId(
  environment: "preview" | "production",
  input: ConversationLifecycleStoreInput,
): string {
  const concurrencyIdentity =
    "expectedVersion" in input.command
      ? `version:${String(input.command.expectedVersion)}`
      : `operation:${input.command.eventId}`;
  return `commit_${createHash("sha256")
    .update(environment)
    .update("\0conversation\0")
    .update(input.feedbackId)
    .update("\0")
    .update(concurrencyIdentity)
    .digest("hex")
    .slice(0, 29)}`;
}

export function createAuthoritativeConversationStore(
  environment: "preview" | "production",
  commits: AuthoritativeCommitStore,
  envelope: AuthoritativeConversationEnvelopeCodec,
  preflight: ConversationLifecyclePreflight,
): ConversationLifecycleStore {
  return {
    async execute(input) {
      const id = commitId(environment, input);
      const existing = await commits.find(id);
      if (existing !== null) {
        if (existing.payloadDigest !== input.payloadDigest) {
          throw new AuthoritativeCommitError("AUTHORITATIVE_COMMIT_CONFLICT");
        }
        return { ...envelope.open(existing).result, status: "replayed" };
      }
      const authority = await preflight.plan(input);
      const { result } = authority;
      const planned = planAuthoritativeCommit(
        {
          environment,
          aggregateKind: "conversation",
          aggregateId: input.feedbackId,
          operationId: input.command.eventId,
          commandKind: `conversation.${input.command.kind}`,
          workspaceId: authority.workspaceId,
          projectId: authority.projectId,
          actorKind: input.command.actorKind === "reporter" ? "reporter" : "user",
          actorId: input.command.actorId,
          payloadDigest: input.payloadDigest,
          sealedPayload: envelope.seal(id, { input, result }),
          acceptedAt: input.command.occurredAt,
        },
        () => id,
      );
      const accepted = await commits.accept(planned);
      if (accepted.commit.id !== id) {
        throw new Error("AUTHORITATIVE_CONVERSATION_COMMIT_INVALID");
      }
      return accepted.status === "replayed"
        ? { ...envelope.open(accepted.commit).result, status: "replayed" }
        : result;
    },
  };
}
