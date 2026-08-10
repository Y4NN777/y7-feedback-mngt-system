import type {
  DeletionRequest,
  FeedbackLifecycleState,
  FeedbackSource,
  ReporterAttachment,
  ReporterFeedbackView,
  ReporterHistoryEntry,
  ReporterMessage,
  SourceRevision,
} from "@y7-feedback/domain";

import type { AccountlessGateway } from "./RetrieveFeedback";

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const states = new Set<FeedbackLifecycleState>([
  "received",
  "under_review",
  "awaiting_reporter",
  "resolved",
  "closed",
]);

function endpoint(value: string): URL {
  try {
    const parsed = new URL(value.endsWith("/") ? value : `${value}/`);
    const local =
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (parsed.protocol !== "https:" && !local) {
      throw new Error("ACCESS_ENDPOINT_INVALID");
    }
    return parsed;
  } catch {
    throw new Error("ACCESS_ENDPOINT_INVALID");
  }
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function required(value: unknown, maximum = 10_000): string {
  if (typeof value !== "string") throw new Error("ACCESS_RESPONSE_INVALID");
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error("ACCESS_RESPONSE_INVALID");
  }
  return normalized;
}

function optional(value: unknown): string | undefined {
  return value === undefined ? undefined : required(value, 5_000);
}

function source(value: unknown): FeedbackSource {
  if (!isObject(value)) throw new Error("ACCESS_RESPONSE_INVALID");
  if (value.type === "bug") {
    const expectedBehavior = optional(value.expectedBehavior);
    const observedBehavior = optional(value.observedBehavior);
    const reproductionSteps = optional(value.reproductionSteps);
    return {
      type: "bug",
      problem: required(value.problem, 5_000),
      ...(expectedBehavior === undefined ? {} : { expectedBehavior }),
      ...(observedBehavior === undefined ? {} : { observedBehavior }),
      ...(reproductionSteps === undefined ? {} : { reproductionSteps }),
    };
  }
  if (value.type === "suggestion") {
    const usageContext = optional(value.usageContext);
    return {
      type: "suggestion",
      proposal: required(value.proposal, 5_000),
      rationale: required(value.rationale, 5_000),
      ...(usageContext === undefined ? {} : { usageContext }),
    };
  }
  if (value.type === "review") {
    return {
      type: "review",
      experience: required(value.experience, 5_000),
      appreciation: required(value.appreciation, 5_000),
    };
  }
  throw new Error("ACCESS_RESPONSE_INVALID");
}

function array<T>(value: unknown, parse: (entry: unknown) => T): readonly T[] {
  if (!Array.isArray(value)) throw new Error("ACCESS_RESPONSE_INVALID");
  return (value as readonly unknown[]).map(parse);
}

function audience(value: unknown): "reporter" | "workspace" {
  if (value !== "reporter" && value !== "workspace") {
    throw new Error("ACCESS_RESPONSE_INVALID");
  }
  return value;
}

function history(value: unknown): readonly ReporterHistoryEntry[] {
  return array(value, (entry) => {
    if (!isObject(entry)) throw new Error("ACCESS_RESPONSE_INVALID");
    return {
      id: required(entry.id),
      kind: required(entry.kind),
      audience: audience(entry.audience),
      actor: required(entry.actor),
      occurredAt: required(entry.occurredAt),
      detail: required(entry.detail),
    };
  });
}

function messages(value: unknown): readonly ReporterMessage[] {
  return array(value, (entry) => {
    if (!isObject(entry)) throw new Error("ACCESS_RESPONSE_INVALID");
    return {
      id: required(entry.id),
      audience: audience(entry.audience),
      actor: required(entry.actor),
      occurredAt: required(entry.occurredAt),
      content: required(entry.content),
    };
  });
}

function attachments(value: unknown): readonly ReporterAttachment[] {
  return array(value, (entry) => {
    if (!isObject(entry)) throw new Error("ACCESS_RESPONSE_INVALID");
    return {
      id: required(entry.id),
      audience: audience(entry.audience),
      name: required(entry.name, 255),
    };
  });
}

function revisions(value: unknown): readonly SourceRevision[] {
  return array(value, (entry) => {
    if (!isObject(entry)) throw new Error("ACCESS_RESPONSE_INVALID");
    return {
      id: required(entry.id),
      priorSource: source(entry.priorSource),
      source: source(entry.source),
      actor: required(entry.actor),
      occurredAt: required(entry.occurredAt),
    };
  });
}

function deletions(value: unknown): readonly DeletionRequest[] {
  return array(value, (entry) => {
    if (!isObject(entry) || entry.status !== "received") {
      throw new Error("ACCESS_RESPONSE_INVALID");
    }
    return {
      id: required(entry.id),
      status: entry.status,
      reason: required(entry.reason),
      actor: required(entry.actor),
      occurredAt: required(entry.occurredAt),
    };
  });
}

function view(value: unknown): ReporterFeedbackView {
  if (
    !isObject(value) ||
    "internalNotes" in value ||
    "workspaceClassification" in value ||
    !states.has(value.currentState as FeedbackLifecycleState)
  ) {
    throw new Error("ACCESS_RESPONSE_INVALID");
  }
  return {
    feedbackId: required(value.feedbackId),
    reference: required(value.reference, 100),
    originalSource: source(value.originalSource),
    currentSource: source(value.currentSource),
    currentState: value.currentState as FeedbackLifecycleState,
    history: history(value.history),
    messages: messages(value.messages),
    attachments: attachments(value.attachments),
    sourceRevisions: revisions(value.sourceRevisions),
    deletionRequests: deletions(value.deletionRequests),
  };
}

function parseSuccess(value: unknown): ReporterFeedbackView {
  if (!isObject(value) || value.status !== "ok") {
    throw new Error("ACCESS_RESPONSE_INVALID");
  }
  return view(value.feedback);
}

export function createHttpAccountlessGateway(
  rawEndpoint: string,
  fetcher: Fetcher = globalThis.fetch,
): AccountlessGateway {
  const base = endpoint(rawEndpoint);
  return {
    async retrieve(input) {
      try {
        const response = await fetcher(
          new URL("v1/feedback/retrieve", base).toString(),
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
        if (response.status === 404) return { status: "denied" };
        if (response.status !== 200) return { status: "retryable" };
        return {
          status: "ok",
          view: parseSuccess((await response.json()) as unknown),
        };
      } catch {
        return { status: "retryable" };
      }
    },
  };
}
