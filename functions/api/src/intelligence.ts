import {
  aggregateIntelligenceFeedback,
  filterIntelligenceFeedback,
  intelligenceTrend,
  IntelligencePolicyError,
  type IntelligenceFeedback,
  type IntelligenceFilter,
  type IntelligenceTrendWindow,
} from "@y7-feedback/domain";

import type { WorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope.js";
import type { AppwritePrincipalVerifier } from "./workspace-attachment-download.js";

export interface IntelligenceStore {
  list(input: {
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<readonly IntelligenceFeedback[]>;
}

export type IntelligenceOutcome =
  | {
      readonly status: "ok";
      readonly result: {
        readonly ids: readonly string[];
        readonly nextCursor: string | null;
        readonly aggregate: ReturnType<typeof aggregateIntelligenceFeedback>;
        readonly trend: ReturnType<typeof intelligenceTrend> | null;
      };
    }
  | { readonly status: "denied" | "invalid" | "retryable" };

interface IntelligenceRequest {
  readonly filter: IntelligenceFilter;
  readonly trendWindow?: IntelligenceTrendWindow;
  readonly pageSize: number;
  readonly cursor?: string;
}

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function window(value: unknown): IntelligenceTrendWindow | undefined {
  if (!object(value) || !object(value.current) || !object(value.baseline))
    return undefined;
  const { current, baseline } = value;
  if (
    typeof current.from !== "string" ||
    typeof current.to !== "string" ||
    typeof baseline.from !== "string" ||
    typeof baseline.to !== "string"
  )
    return undefined;
  return {
    current: { from: current.from, to: current.to },
    baseline: { from: baseline.from, to: baseline.to },
  };
}

function request(value: unknown): IntelligenceRequest | undefined {
  if (!object(value)) return undefined;
  const filterValue = value.filter ?? {};
  if (!object(filterValue)) return undefined;
  const types = strings(filterValue.types);
  const states = strings(filterValue.states);
  const reporterKinds = strings(filterValue.reporterKinds);
  const versions = strings(filterValue.versions);
  const places = strings(filterValue.places);
  const features = strings(filterValue.features);
  if (
    (filterValue.types !== undefined && types === undefined) ||
    (filterValue.states !== undefined && states === undefined) ||
    (filterValue.reporterKinds !== undefined && reporterKinds === undefined) ||
    (filterValue.versions !== undefined && versions === undefined) ||
    (filterValue.places !== undefined && places === undefined) ||
    (filterValue.features !== undefined && features === undefined) ||
    (filterValue.reviewedContext !== undefined &&
      !object(filterValue.reviewedContext)) ||
    (filterValue.from !== undefined && typeof filterValue.from !== "string") ||
    (filterValue.to !== undefined && typeof filterValue.to !== "string")
  )
    return undefined;
  const pageSize = value.pageSize ?? 50;
  if (
    !Number.isInteger(pageSize) ||
    Number(pageSize) < 1 ||
    Number(pageSize) > 100 ||
    (value.cursor !== undefined && typeof value.cursor !== "string")
  )
    return undefined;
  const trendWindow =
    value.trendWindow === undefined ? undefined : window(value.trendWindow);
  if (value.trendWindow !== undefined && trendWindow === undefined) return undefined;
  const filter: IntelligenceFilter = {
    ...(types ? { types: types as NonNullable<IntelligenceFilter["types"]> } : {}),
    ...(states ? { states: states as NonNullable<IntelligenceFilter["states"]> } : {}),
    ...(reporterKinds
      ? {
          reporterKinds: reporterKinds as NonNullable<
            IntelligenceFilter["reporterKinds"]
          >,
        }
      : {}),
    ...(versions ? { versions } : {}),
    ...(places ? { places } : {}),
    ...(features ? { features } : {}),
    ...(object(filterValue.reviewedContext)
      ? {
          reviewedContext: filterValue.reviewedContext as Readonly<
            Record<string, string | number | boolean>
          >,
        }
      : {}),
    ...(typeof filterValue.from === "string" ? { from: filterValue.from } : {}),
    ...(typeof filterValue.to === "string" ? { to: filterValue.to } : {}),
  };
  return {
    filter,
    pageSize: Number(pageSize),
    ...(typeof value.cursor === "string" ? { cursor: value.cursor } : {}),
    ...(trendWindow ? { trendWindow } : {}),
  };
}

export function createIntelligenceCoordinator(
  principal: AppwritePrincipalVerifier,
  scope: WorkspaceCapabilityScopeResolver,
  store: IntelligenceStore,
) {
  return {
    async analyze(input: {
      readonly jwt: string;
      readonly workspaceId: string;
      readonly projectId: string;
      readonly query: unknown;
    }): Promise<IntelligenceOutcome> {
      const parsed = request(input.query);
      if (!parsed) return { status: "invalid" };
      const verification = await principal.verify(input.jwt);
      if (verification.status !== "verified") return { status: "denied" };
      const authorization = await scope.resolve({
        principalId: verification.principalId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        capability: "feedback.aggregate",
      });
      if (authorization.status !== "authorized") return { status: "denied" };
      try {
        const records = await store.list({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
        });
        const selected = [
          ...filterIntelligenceFeedback(records, input, parsed.filter),
        ].sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            left.feedbackId.localeCompare(right.feedbackId),
        );
        const start =
          parsed.cursor === undefined
            ? 0
            : selected.findIndex(({ feedbackId }) => feedbackId === parsed.cursor) + 1;
        if (start === 0 && parsed.cursor !== undefined) return { status: "invalid" };
        const page = selected.slice(start, start + parsed.pageSize);
        const hasNext = start + page.length < selected.length;
        return {
          status: "ok",
          result: {
            ids: page.map(({ feedbackId }) => feedbackId),
            /* v8 ignore next -- a positive validated page size makes an empty page impossible when hasNext is true */
            nextCursor: hasNext ? (page.at(-1)?.feedbackId ?? null) : null,
            aggregate: aggregateIntelligenceFeedback(records, input, parsed.filter),
            trend: parsed.trendWindow
              ? intelligenceTrend(records, input, parsed.filter, parsed.trendWindow)
              : null,
          },
        };
      } catch (error: unknown) {
        return error instanceof IntelligencePolicyError
          ? { status: "invalid" }
          : { status: "retryable" };
      }
    },
  };
}
