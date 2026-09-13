import { z } from "zod";

import type { AuthoritativeCommit } from "@y7-feedback/domain";

import type {
  ConversationLifecycleStoreInput,
  ConversationLifecycleStoreResult,
} from "./appwrite-conversation-lifecycle-store.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

const required = z.string().min(1).max(10_000);
const timestamp = z.iso.datetime({ offset: false, precision: 3 });

const command = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("append_message"),
      eventId: required,
      actorId: required,
      actorKind: z.enum(["workspace", "reporter"]),
      occurredAt: timestamp,
      audience: z.enum(["reporter", "workspace"]),
      content: required,
    })
    .strict(),
  z
    .object({
      kind: z.literal("append_internal_note"),
      eventId: required,
      actorId: required,
      actorKind: z.literal("workspace"),
      occurredAt: timestamp,
      content: required,
    })
    .strict(),
  ...(
    [
      "start_review",
      "request_clarification",
      "reporter_answer",
      "resolve",
      "close",
      "reopen",
    ] as const
  ).map((kind) =>
    z
      .object({
        kind: z.literal(kind),
        eventId: required,
        actorId: required,
        actorKind: z.enum(["workspace", "reporter"]),
        occurredAt: timestamp,
        expectedVersion: z.number().int().min(1),
        reason: required,
      })
      .strict(),
  ),
]);

const input = z
  .object({
    feedbackId: required,
    workspaceId: required.optional(),
    projectId: required.optional(),
    payloadDigest: required,
    locale: z.enum(["fr", "en"]),
    command,
  })
  .strict();

const result = z
  .object({
    status: z.literal("applied"),
    feedbackId: required,
    action: z.enum([
      "append_message",
      "append_internal_note",
      "start_review",
      "request_clarification",
      "reporter_answer",
      "resolve",
      "close",
      "reopen",
    ]),
    state: z
      .enum(["received", "under_review", "awaiting_reporter", "resolved", "closed"])
      .optional(),
    version: z.number().int().min(1).optional(),
  })
  .strict();

const envelope = z.object({ version: z.literal(1), input, result }).strict();

export interface AuthoritativeConversationPayload {
  readonly input: ConversationLifecycleStoreInput;
  readonly result: ConversationLifecycleStoreResult & { readonly status: "applied" };
}

export function createAuthoritativeConversationEnvelope(
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
    seal(commitId: string, value: AuthoritativeConversationPayload): string {
      return persistence.protector.seal(
        context(commitId),
        JSON.stringify({ version: 1, ...value }),
      );
    },
    open(commit: AuthoritativeCommit): AuthoritativeConversationPayload {
      try {
        const parsedEnvelope = envelope.parse(
          JSON.parse(
            persistence.protector.open(context(commit.id), commit.sealedPayload),
          ),
        );
        const parsed = {
          input: parsedEnvelope.input,
          result: parsedEnvelope.result,
        } as unknown as AuthoritativeConversationPayload;
        if (
          commit.aggregateKind !== "conversation" ||
          parsed.input.feedbackId !== commit.aggregateId ||
          parsed.input.command.eventId !== commit.operationId ||
          parsed.input.command.kind !==
            commit.commandKind.slice("conversation.".length) ||
          parsed.input.payloadDigest !== commit.payloadDigest ||
          parsed.input.command.occurredAt !== commit.acceptedAt ||
          parsed.result.feedbackId !== commit.aggregateId ||
          parsed.result.action !== parsed.input.command.kind
        ) {
          throw new Error();
        }
        return parsed;
      } catch {
        throw new Error("AUTHORITATIVE_CONVERSATION_ENVELOPE_INVALID");
      }
    },
  };
}
