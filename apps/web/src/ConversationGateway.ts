import type { FeedbackLifecycleState } from "@y7-feedback/domain";

export interface ReporterConversationMessage {
  readonly id: string;
  readonly actorKind: "workspace" | "reporter";
  readonly audience: "reporter";
  readonly occurredAt: string;
  readonly content: string;
}

export interface ReporterConversationLifecycleFact {
  readonly id: string;
  readonly priorState: FeedbackLifecycleState;
  readonly state: FeedbackLifecycleState;
  readonly actorKind: "workspace" | "reporter";
  readonly occurredAt: string;
  readonly reason: string;
  readonly sequence: number;
}

export interface ReporterConversationProjection {
  readonly feedbackId: string;
  readonly state: FeedbackLifecycleState;
  readonly messages: readonly ReporterConversationMessage[];
  readonly lifecycle: readonly ReporterConversationLifecycleFact[];
}

export type ConversationGatewayOutcome<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "denied" | "invalid" | "conflict" | "retryable" };

export interface ConversationGateway {
  retrieve(input: {
    readonly feedbackId: string;
    readonly reference: string;
    readonly proof: string;
  }): Promise<ConversationGatewayOutcome<ReporterConversationProjection>>;
  execute(input: {
    readonly feedbackId: string;
    readonly reference: string;
    readonly proof: string;
    readonly command:
      | {
          readonly kind: "append_message";
          readonly eventId: string;
          readonly audience: "reporter";
          readonly content: string;
        }
      | {
          readonly kind: "reporter_answer" | "reopen";
          readonly eventId: string;
          readonly expectedVersion: number;
          readonly reason: string;
        };
  }): Promise<ConversationGatewayOutcome<"applied" | "replayed">>;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const states = new Set<FeedbackLifecycleState>([
  "received",
  "under_review",
  "awaiting_reporter",
  "resolved",
  "closed",
]);

function endpoint(value: string): URL {
  const parsed = new URL(value.endsWith("/") ? value : `${value}/`);
  const local =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (
    (parsed.protocol !== "https:" && !local) ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("CONVERSATION_ENDPOINT_INVALID");
  }
  return parsed;
}

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum = 10_000): string {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new Error("CONVERSATION_RESPONSE_INVALID");
  }
  return value;
}

function actor(value: unknown): "workspace" | "reporter" {
  if (value !== "workspace" && value !== "reporter") {
    throw new Error("CONVERSATION_RESPONSE_INVALID");
  }
  return value;
}

function projection(value: unknown): ReporterConversationProjection {
  if (
    !object(value) ||
    "internalNotes" in value ||
    !states.has(value.state as FeedbackLifecycleState) ||
    !Array.isArray(value.messages) ||
    !Array.isArray(value.lifecycle)
  ) {
    throw new Error("CONVERSATION_RESPONSE_INVALID");
  }
  return {
    feedbackId: text(value.feedbackId, 36),
    state: value.state as FeedbackLifecycleState,
    messages: (value.messages as readonly unknown[]).map((entry) => {
      if (!object(entry) || entry.audience !== "reporter") {
        throw new Error("CONVERSATION_RESPONSE_INVALID");
      }
      return {
        id: text(entry.id, 36),
        actorKind: actor(entry.actorKind),
        audience: entry.audience,
        occurredAt: text(entry.occurredAt, 40),
        content: text(entry.content),
      };
    }),
    lifecycle: (value.lifecycle as readonly unknown[]).map((entry) => {
      if (
        !object(entry) ||
        !states.has(entry.priorState as FeedbackLifecycleState) ||
        !states.has(entry.state as FeedbackLifecycleState) ||
        typeof entry.sequence !== "number" ||
        !Number.isSafeInteger(entry.sequence) ||
        entry.sequence < 2
      ) {
        throw new Error("CONVERSATION_RESPONSE_INVALID");
      }
      return {
        id: text(entry.id, 36),
        priorState: entry.priorState as FeedbackLifecycleState,
        state: entry.state as FeedbackLifecycleState,
        actorKind: actor(entry.actorKind),
        occurredAt: text(entry.occurredAt, 40),
        reason: text(entry.reason, 500),
        sequence: entry.sequence,
      };
    }),
  };
}

function failure(status: number): ConversationGatewayOutcome<never> {
  if (status === 404) return { status: "denied" };
  if (status === 400) return { status: "invalid" };
  if (status === 409) return { status: "conflict" };
  return { status: "retryable" };
}

export function createHttpConversationGateway(
  rawEndpoint: string,
  fetcher: Fetcher = globalThis.fetch,
): ConversationGateway {
  const base = endpoint(rawEndpoint);
  return {
    async retrieve(input) {
      try {
        const response = await fetcher(
          new URL(
            `v1/feedback/${encodeURIComponent(input.feedbackId)}/conversation/retrieve`,
            base,
          ).toString(),
          {
            method: "POST",
            cache: "no-store",
            credentials: "omit",
            headers: {
              "content-type": "application/json",
              authorization: `FeedbackProof ${input.proof}`,
            },
            body: JSON.stringify({ reference: input.reference }),
          },
        );
        if (response.status !== 200) return failure(response.status);
        const body: unknown = await response.json();
        if (!object(body) || body.status !== "ok") {
          throw new Error("CONVERSATION_RESPONSE_INVALID");
        }
        const value = projection(body.conversation);
        if (value.feedbackId !== input.feedbackId) {
          throw new Error("CONVERSATION_RESPONSE_INVALID");
        }
        return { status: "ok", value };
      } catch {
        return { status: "retryable" };
      }
    },
    async execute(input) {
      try {
        const response = await fetcher(
          new URL(
            `v1/feedback/${encodeURIComponent(input.feedbackId)}/conversation/commands`,
            base,
          ).toString(),
          {
            method: "POST",
            cache: "no-store",
            credentials: "omit",
            headers: {
              "content-type": "application/json",
              authorization: `FeedbackProof ${input.proof}`,
            },
            body: JSON.stringify({
              reference: input.reference,
              command: input.command,
            }),
          },
        );
        if (response.status !== 200 && response.status !== 201) {
          return failure(response.status);
        }
        const body: unknown = await response.json();
        if (
          !object(body) ||
          (body.status !== "applied" && body.status !== "replayed")
        ) {
          throw new Error("CONVERSATION_RESPONSE_INVALID");
        }
        return { status: "ok", value: body.status };
      } catch {
        return { status: "retryable" };
      }
    },
  };
}
