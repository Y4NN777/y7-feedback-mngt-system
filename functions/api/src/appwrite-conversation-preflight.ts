import { Query, type TablesDB } from "node-appwrite";

import {
  ConversationLifecycleError,
  planLifecycleTransition,
  type FeedbackLifecycleState,
} from "@y7-feedback/domain";

import {
  AppwriteConversationLifecycleError,
  type ConversationLifecycleStoreInput,
  type ConversationLifecycleStoreResult,
} from "./appwrite-conversation-lifecycle-store.js";
import type { ConversationLifecyclePreflight } from "./authoritative-conversation-store.js";
import type { AuthoritativeConversationEnvelopeReader } from "./authoritative-conversation-projector.js";
import type { ConversationPendingCommitReader } from "./appwrite-conversation-pending-commits.js";

export interface ConversationPreflightTablesPort {
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
  }): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface ConversationPreflightSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly lifecycleTableId: string;
}

export interface ConversationPreflightQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  orderDesc(attribute: string): string;
  limit(value: number): string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const states = new Set<FeedbackLifecycleState>([
  "received",
  "under_review",
  "awaiting_reporter",
  "resolved",
  "closed",
]);

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapDomain(
  error: ConversationLifecycleError,
): AppwriteConversationLifecycleError {
  return new AppwriteConversationLifecycleError(
    error.code === "ERR-LIFECYCLE-STALE" ? "ERR-CONV-STALE" : "ERR-CONV-INVALID",
  );
}

function appendResult(
  input: ConversationLifecycleStoreInput,
): ConversationLifecycleStoreResult & { readonly status: "applied" } {
  return {
    status: "applied",
    feedbackId: input.feedbackId,
    action: input.command.kind,
  };
}

export function createAppwriteConversationPreflight(
  tables: ConversationPreflightTablesPort,
  schema: ConversationPreflightSchema,
  queries: ConversationPreflightQueryPort,
  pending?: {
    readonly commits: ConversationPendingCommitReader;
    readonly envelope: AuthoritativeConversationEnvelopeReader;
  },
): ConversationLifecyclePreflight {
  if (
    !identifier.test(schema.databaseId) ||
    !identifier.test(schema.feedbackTableId) ||
    !identifier.test(schema.lifecycleTableId) ||
    schema.feedbackTableId === schema.lifecycleTableId
  ) {
    throw new Error("APPWRITE_CONVERSATION_PREFLIGHT_SCHEMA_INVALID");
  }
  return {
    async plan(input) {
      const feedback = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.feedbackTableId,
        rowId: input.feedbackId,
      });
      if (
        !object(feedback) ||
        feedback.$id !== input.feedbackId ||
        typeof feedback.workspaceId !== "string" ||
        typeof feedback.projectId !== "string" ||
        (input.workspaceId !== undefined &&
          feedback.workspaceId !== input.workspaceId) ||
        (input.projectId !== undefined && feedback.projectId !== input.projectId) ||
        typeof feedback.state !== "string" ||
        !states.has(feedback.state as FeedbackLifecycleState)
      ) {
        throw new AppwriteConversationLifecycleError("ERR-CONV-DENIED");
      }
      if (
        input.command.kind === "append_message" ||
        input.command.kind === "append_internal_note"
      ) {
        return {
          result: appendResult(input),
          workspaceId: feedback.workspaceId,
          projectId: feedback.projectId,
        };
      }
      const facts = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.lifecycleTableId,
        queries: [
          queries.equal("feedbackId", [input.feedbackId]),
          queries.orderDesc("sequence"),
          queries.limit(2),
        ],
        total: false,
      });
      if (facts.rows.length > 2) {
        throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
      }
      const latest = facts.rows[0];
      let state = feedback.state as FeedbackLifecycleState;
      let version = 1;
      if (latest !== undefined) {
        if (
          !object(latest) ||
          latest.feedbackId !== input.feedbackId ||
          typeof latest.sequence !== "number" ||
          !Number.isSafeInteger(latest.sequence) ||
          typeof latest.state !== "string" ||
          !states.has(latest.state as FeedbackLifecycleState) ||
          latest.state !== feedback.state
        ) {
          throw new AppwriteConversationLifecycleError("ERR-CONV-RETRYABLE");
        }
        state = latest.state as FeedbackLifecycleState;
        version = latest.sequence;
      }
      if (pending !== undefined) {
        const commits = await pending.commits.list(input.feedbackId);
        for (const commit of commits) {
          const accepted = pending.envelope.open(commit);
          const acceptedCommand = accepted.input.command;
          if (
            acceptedCommand.kind === "append_message" ||
            acceptedCommand.kind === "append_internal_note" ||
            accepted.result.version === undefined ||
            accepted.result.version <= version
          ) {
            continue;
          }
          try {
            const transition = planLifecycleTransition(
              { feedbackId: input.feedbackId, state, version },
              acceptedCommand,
            );
            if (
              transition.next.version !== accepted.result.version ||
              transition.next.state !== accepted.result.state
            ) {
              throw new Error("AUTHORITATIVE_CONVERSATION_PENDING_CONFLICT");
            }
            state = transition.next.state;
            version = transition.next.version;
          } catch (error: unknown) {
            if (
              error instanceof Error &&
              error.message === "AUTHORITATIVE_CONVERSATION_PENDING_CONFLICT"
            ) {
              throw error;
            }
            throw new Error("AUTHORITATIVE_CONVERSATION_PENDING_INVALID");
          }
        }
      }
      try {
        const transition = planLifecycleTransition(
          { feedbackId: input.feedbackId, state, version },
          input.command,
        );
        return {
          result: {
            status: "applied",
            feedbackId: input.feedbackId,
            action: input.command.kind,
            state: transition.next.state,
            version: transition.next.version,
          },
          workspaceId: feedback.workspaceId,
          projectId: feedback.projectId,
        };
      } catch (error: unknown) {
        /* v8 ignore else -- domain planner exposes only ConversationLifecycleError */
        if (error instanceof ConversationLifecycleError) throw mapDomain(error);
        /* v8 ignore next -- defensive propagation for an undocumented planner failure */
        throw error;
      }
    },
  };
}

export function createNodeAppwriteConversationPreflight(
  tables: TablesDB,
  schema: ConversationPreflightSchema,
  pending?: {
    readonly commits: ConversationPendingCommitReader;
    readonly envelope: AuthoritativeConversationEnvelopeReader;
  },
): ConversationLifecyclePreflight {
  return createAppwriteConversationPreflight(
    {
      getRow: (input) => tables.getRow(input),
      listRows: async (input) => {
        const listed = await tables.listRows({
          ...input,
          queries: [...input.queries],
          total: false,
        });
        return { rows: listed.rows };
      },
    },
    schema,
    {
      equal: (attribute, values) => Query.equal(attribute, [...values]),
      orderDesc: (attribute) => Query.orderDesc(attribute),
      limit: (value) => Query.limit(value),
    },
    pending,
  );
}
