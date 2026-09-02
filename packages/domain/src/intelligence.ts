import type { FeedbackType } from "./feedback.js";
import type { FeedbackLifecycleState } from "./access.js";

export type IntelligenceReporterKind = "unidentified" | "contact" | "external";

export interface IntelligenceContextValue {
  readonly name: string;
  readonly value: string | number | boolean;
  readonly reviewed: boolean;
}

export interface IntelligenceFeedback {
  readonly feedbackId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly type: FeedbackType;
  readonly state: FeedbackLifecycleState;
  readonly createdAt: string;
  readonly reporterKind: IntelligenceReporterKind;
  readonly version?: string;
  readonly place?: string;
  readonly feature?: string;
  readonly context: readonly IntelligenceContextValue[];
  readonly deletedAt?: string;
}

export interface IntelligenceScope {
  readonly workspaceId: string;
  readonly projectId: string;
}

export interface IntelligenceFilter {
  readonly types?: readonly FeedbackType[];
  readonly states?: readonly FeedbackLifecycleState[];
  readonly reporterKinds?: readonly IntelligenceReporterKind[];
  readonly versions?: readonly string[];
  readonly places?: readonly string[];
  readonly features?: readonly string[];
  readonly reviewedContext?: Readonly<Record<string, string | number | boolean>>;
  readonly from?: string;
  readonly to?: string;
}

export interface IntelligenceTrendWindow {
  readonly current: { readonly from: string; readonly to: string };
  readonly baseline: { readonly from: string; readonly to: string };
}

export class IntelligencePolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "IntelligencePolicyError";
  }
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !value.endsWith("Z"))
    throw new IntelligencePolicyError("INTELLIGENCE_TIME_INVALID");
  return parsed;
}

function bounded(values: readonly string[] | undefined): boolean {
  return (
    values === undefined ||
    (values.length <= 20 &&
      new Set(values).size === values.length &&
      values.every((value) => value.length > 0 && value.length <= 200))
  );
}

function validate(scope: IntelligenceScope, filter: IntelligenceFilter): void {
  if (!identifier.test(scope.workspaceId) || !identifier.test(scope.projectId))
    throw new IntelligencePolicyError("INTELLIGENCE_SCOPE_INVALID");
  if (
    !bounded(filter.types) ||
    !bounded(filter.states) ||
    !bounded(filter.reporterKinds) ||
    !bounded(filter.versions) ||
    !bounded(filter.places) ||
    !bounded(filter.features)
  )
    throw new IntelligencePolicyError("INTELLIGENCE_FILTER_INVALID");
  const context = Object.entries(filter.reviewedContext ?? {});
  if (
    context.length > 20 ||
    context.some(
      ([name, value]) =>
        !identifier.test(name) ||
        (typeof value === "string" && (value.length === 0 || value.length > 500)) ||
        (typeof value === "number" && !Number.isFinite(value)),
    )
  )
    throw new IntelligencePolicyError("INTELLIGENCE_FILTER_INVALID");
  if (filter.from !== undefined && filter.to !== undefined) {
    if (instant(filter.from) >= instant(filter.to))
      throw new IntelligencePolicyError("INTELLIGENCE_WINDOW_INVALID");
  } else if (filter.from !== undefined || filter.to !== undefined) {
    throw new IntelligencePolicyError("INTELLIGENCE_WINDOW_INVALID");
  }
}

function includes<T>(values: readonly T[] | undefined, value: T): boolean {
  return values === undefined || values.includes(value);
}

function contextMatches(
  actual: readonly IntelligenceContextValue[],
  expected: Readonly<Record<string, string | number | boolean>> | undefined,
): boolean {
  return Object.entries(expected ?? {}).every(([name, value]) =>
    actual.some(
      (entry) => entry.reviewed && entry.name === name && entry.value === value,
    ),
  );
}

export function filterIntelligenceFeedback(
  records: readonly IntelligenceFeedback[],
  scope: IntelligenceScope,
  filter: IntelligenceFilter,
): readonly IntelligenceFeedback[] {
  validate(scope, filter);
  const from = filter.from === undefined ? undefined : instant(filter.from);
  const to = filter.to === undefined ? undefined : instant(filter.to);
  return records.filter((record) => {
    if (
      record.workspaceId !== scope.workspaceId ||
      record.projectId !== scope.projectId ||
      record.deletedAt !== undefined
    )
      return false;
    const created = instant(record.createdAt);
    return (
      (from === undefined || created >= from) &&
      (to === undefined || created < to) &&
      includes(filter.types, record.type) &&
      includes(filter.states, record.state) &&
      includes(filter.reporterKinds, record.reporterKind) &&
      includes(filter.versions, record.version ?? "") &&
      includes(filter.places, record.place ?? "") &&
      includes(filter.features, record.feature ?? "") &&
      contextMatches(record.context, filter.reviewedContext)
    );
  });
}

export interface IntelligenceAggregate {
  readonly total: number;
  readonly byType: Readonly<Record<FeedbackType, number>>;
  readonly byState: Readonly<Record<FeedbackLifecycleState, number>>;
}

export function aggregateIntelligenceFeedback(
  records: readonly IntelligenceFeedback[],
  scope: IntelligenceScope,
  filter: IntelligenceFilter,
): IntelligenceAggregate {
  const selected = filterIntelligenceFeedback(records, scope, filter);
  const byType: Record<FeedbackType, number> = {
    bug: 0,
    suggestion: 0,
    review: 0,
  };
  const byState: Record<FeedbackLifecycleState, number> = {
    received: 0,
    under_review: 0,
    awaiting_reporter: 0,
    resolved: 0,
    closed: 0,
  };
  for (const record of selected) {
    byType[record.type] += 1;
    byState[record.state] += 1;
  }
  return { total: selected.length, byType, byState };
}

export interface IntelligenceTrend {
  readonly currentCount: number;
  readonly baselineCount: number;
  readonly changePercent: number | null;
  readonly direction: "empty" | "new" | "stable" | "up" | "down";
}

export function intelligenceTrend(
  records: readonly IntelligenceFeedback[],
  scope: IntelligenceScope,
  filter: IntelligenceFilter,
  window: IntelligenceTrendWindow,
): IntelligenceTrend {
  const currentFrom = instant(window.current.from);
  const currentTo = instant(window.current.to);
  const baselineFrom = instant(window.baseline.from);
  const baselineTo = instant(window.baseline.to);
  if (
    currentFrom >= currentTo ||
    baselineFrom >= baselineTo ||
    currentFrom - baselineFrom !== currentTo - baselineTo
  )
    throw new IntelligencePolicyError("INTELLIGENCE_WINDOW_INVALID");
  const currentCount = filterIntelligenceFeedback(records, scope, {
    ...filter,
    from: window.current.from,
    to: window.current.to,
  }).length;
  const baselineCount = filterIntelligenceFeedback(records, scope, {
    ...filter,
    from: window.baseline.from,
    to: window.baseline.to,
  }).length;
  if (currentCount === 0 && baselineCount === 0)
    return {
      currentCount,
      baselineCount,
      changePercent: null,
      direction: "empty",
    };
  if (baselineCount === 0)
    return {
      currentCount,
      baselineCount,
      changePercent: null,
      direction: "new",
    };
  const changePercent = ((currentCount - baselineCount) / baselineCount) * 100;
  return {
    currentCount,
    baselineCount,
    changePercent,
    direction: changePercent === 0 ? "stable" : changePercent > 0 ? "up" : "down",
  };
}
