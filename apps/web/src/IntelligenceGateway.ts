import type {
  FeedbackLifecycleState,
  FeedbackType,
  IntelligenceAggregate,
  IntelligenceFilter,
  IntelligenceReporterKind,
  IntelligenceRelationType,
  IntelligenceTrend,
  IntelligenceTrendWindow,
} from "@y7-feedback/domain";

export interface IntelligenceResult {
  readonly ids: readonly string[];
  readonly nextCursor: string | null;
  readonly aggregate: IntelligenceAggregate;
  readonly trend: IntelligenceTrend | null;
}

export type IntelligenceGatewayOutcome =
  | { readonly status: "ok"; readonly result: IntelligenceResult }
  | { readonly status: "invalid" | "denied" | "retryable" };

export type IntelligenceProvenanceCommand =
  | {
      readonly kind: "record_theme";
      readonly operationId: string;
      readonly feedbackId: string;
      readonly label: string;
    }
  | {
      readonly kind: "record_relationship";
      readonly operationId: string;
      readonly feedbackId: string;
      readonly relatedFeedbackId: string;
      readonly relationType: IntelligenceRelationType;
    }
  | {
      readonly kind: "correct_theme";
      readonly operationId: string;
      readonly associationId: string;
      readonly expectedRevision: number;
      readonly label: string;
    }
  | {
      readonly kind: "correct_relationship";
      readonly operationId: string;
      readonly associationId: string;
      readonly expectedRevision: number;
      readonly relatedFeedbackId: string;
      readonly relationType: IntelligenceRelationType;
    }
  | {
      readonly kind: "remove_association";
      readonly operationId: string;
      readonly associationId: string;
      readonly expectedRevision: number;
    };

export type IntelligenceProvenanceOutcome =
  | {
      readonly status: "ok";
      readonly result: {
        readonly disposition: "applied" | "replayed";
        readonly associationId: string;
        readonly eventId: string;
        readonly revision: number;
      };
    }
  | { readonly status: "invalid" | "denied" | "conflict" | "retryable" };

export interface IntelligenceGateway {
  analyze(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly filter: IntelligenceFilter;
    readonly trendWindow?: IntelligenceTrendWindow;
    readonly pageSize?: number;
    readonly cursor?: string;
  }): Promise<IntelligenceGatewayOutcome>;
  mutate(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly command: IntelligenceProvenanceCommand;
  }): Promise<IntelligenceProvenanceOutcome>;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function counts<T extends string>(
  value: unknown,
  keys: readonly T[],
): Readonly<Record<T, number>> | undefined {
  if (!object(value)) return undefined;
  const result = {} as Record<T, number>;
  for (const key of keys) {
    const count = value[key];
    if (!Number.isSafeInteger(count) || Number(count) < 0) return undefined;
    result[key] = Number(count);
  }
  return result;
}

function result(value: unknown): IntelligenceResult | undefined {
  if (
    !object(value) ||
    !Array.isArray(value.ids) ||
    value.ids.some((id) => typeof id !== "string") ||
    (value.nextCursor !== null && typeof value.nextCursor !== "string") ||
    !object(value.aggregate) ||
    !Number.isSafeInteger(value.aggregate.total) ||
    Number(value.aggregate.total) < 0
  )
    return undefined;
  const byType = counts<FeedbackType>(value.aggregate.byType, [
    "bug",
    "suggestion",
    "review",
  ]);
  const byState = counts<FeedbackLifecycleState>(value.aggregate.byState, [
    "received",
    "under_review",
    "awaiting_reporter",
    "resolved",
    "closed",
  ]);
  if (!byType || !byState) return undefined;
  let trend: IntelligenceTrend | null = null;
  if (value.trend !== null) {
    if (
      !object(value.trend) ||
      !Number.isSafeInteger(value.trend.currentCount) ||
      Number(value.trend.currentCount) < 0 ||
      !Number.isSafeInteger(value.trend.baselineCount) ||
      Number(value.trend.baselineCount) < 0 ||
      (value.trend.changePercent !== null &&
        (typeof value.trend.changePercent !== "number" ||
          !Number.isFinite(value.trend.changePercent))) ||
      !(["empty", "new", "stable", "up", "down"] as const).includes(
        value.trend.direction as IntelligenceTrend["direction"],
      )
    )
      return undefined;
    trend = value.trend as unknown as IntelligenceTrend;
  }
  return {
    ids: value.ids as readonly string[],
    nextCursor: value.nextCursor,
    aggregate: { total: Number(value.aggregate.total), byType, byState },
    trend,
  };
}

function provenanceResult(value: unknown) {
  if (
    !object(value) ||
    (value.disposition !== "applied" && value.disposition !== "replayed") ||
    typeof value.associationId !== "string" ||
    typeof value.eventId !== "string" ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1
  )
    return undefined;
  return {
    disposition: value.disposition,
    associationId: value.associationId,
    eventId: value.eventId,
    revision: Number(value.revision),
  } as const;
}

export function createHttpIntelligenceGateway(
  endpoint: string,
  getJwt: () => Promise<string>,
  fetcher: Fetcher = fetch,
): IntelligenceGateway {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  return {
    async analyze(input) {
      let jwt: string;
      try {
        jwt = await getJwt();
      } catch {
        return { status: "denied" };
      }
      try {
        const path = `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/intelligence`;
        const response = await fetcher(`${base}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${jwt}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            filter: input.filter,
            pageSize: input.pageSize ?? 50,
            ...(input.trendWindow ? { trendWindow: input.trendWindow } : {}),
            ...(input.cursor ? { cursor: input.cursor } : {}),
          }),
        });
        if (response.status === 404) return { status: "denied" };
        if (response.status === 400) return { status: "invalid" };
        const body: unknown = await response.json();
        if (response.ok && object(body)) {
          const parsed = result(body.result);
          if (parsed) return { status: "ok", result: parsed };
        }
      } catch {
        // Network and malformed transport failures are safely retryable.
      }
      return { status: "retryable" };
    },
    async mutate(input) {
      let jwt: string;
      try {
        jwt = await getJwt();
      } catch {
        return { status: "denied" };
      }
      try {
        const path = `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/intelligence/provenance`;
        const response = await fetcher(`${base}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${jwt}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input.command),
        });
        if (response.status === 404) return { status: "denied" };
        if (response.status === 400) return { status: "invalid" };
        if (response.status === 409) return { status: "conflict" };
        const body: unknown = await response.json();
        if (response.ok && object(body)) {
          const parsed = provenanceResult(body.result);
          if (parsed) return { status: "ok", result: parsed };
        }
      } catch {
        // Network and malformed transport failures are safely retryable.
      }
      return { status: "retryable" };
    },
  };
}

export const intelligenceFilterKinds = {
  types: ["bug", "suggestion", "review"] as readonly FeedbackType[],
  states: [
    "received",
    "under_review",
    "awaiting_reporter",
    "resolved",
    "closed",
  ] as readonly FeedbackLifecycleState[],
  reporters: [
    "unidentified",
    "contact",
    "external",
  ] as readonly IntelligenceReporterKind[],
};
