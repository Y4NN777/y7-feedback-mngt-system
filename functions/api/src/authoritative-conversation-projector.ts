import type { AuthoritativeCommit } from "@y7-feedback/domain";

import type { ConversationLifecycleStore } from "./appwrite-conversation-lifecycle-store.js";
import type { AuthoritativeConversationPayload } from "./authoritative-conversation-envelope.js";
import type { AuthoritativeProjectionHandler } from "./authoritative-projector.js";

export function authoritativeProjectionErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "AUTHORITATIVE_PROJECTION_RETRYABLE";
  const known = new Set([
    "AUTHORITATIVE_CONVERSATION_COMMAND_UNSUPPORTED",
    "AUTHORITATIVE_CONVERSATION_ENVELOPE_INVALID",
    "AUTHORITATIVE_CONVERSATION_PROJECTION_CONFLICT",
  ]);
  if (known.has(error.message)) return error.message;
  if (error.message.startsWith("ERR-CONV-")) {
    return `CONVERSATION_PROJECTION_${error.message.slice("ERR-CONV-".length).replaceAll("-", "_")}`;
  }
  return "AUTHORITATIVE_PROJECTION_RETRYABLE";
}

export interface AuthoritativeConversationEnvelopeReader {
  open(commit: AuthoritativeCommit): AuthoritativeConversationPayload;
}

export function createAuthoritativeConversationProjectionHandler(
  envelope: AuthoritativeConversationEnvelopeReader,
  normalizedStore: ConversationLifecycleStore,
): AuthoritativeProjectionHandler {
  return {
    async project(commit) {
      if (
        commit.aggregateKind !== "conversation" ||
        !commit.commandKind.startsWith("conversation.")
      ) {
        throw new Error("AUTHORITATIVE_CONVERSATION_COMMAND_UNSUPPORTED");
      }
      const payload = envelope.open(commit);
      const projected = await normalizedStore.execute(payload.input);
      if (
        projected.feedbackId !== payload.result.feedbackId ||
        projected.action !== payload.result.action ||
        projected.state !== payload.result.state ||
        projected.version !== payload.result.version
      ) {
        throw new Error("AUTHORITATIVE_CONVERSATION_PROJECTION_CONFLICT");
      }
    },
  };
}
