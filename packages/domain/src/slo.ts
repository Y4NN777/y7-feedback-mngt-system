export type SloMetric =
  | "attachment_processing_ms"
  | "availability"
  | "cls"
  | "critical_api_ms"
  | "dashboard_ms"
  | "email_handoff_ms"
  | "feedback_commit_ms"
  | "inp_ms"
  | "lcp_ms"
  | "notification_visibility_ms";

export interface SloObservation {
  readonly metric: SloMetric;
  readonly value: number;
  readonly measuredAt: string;
  readonly environment: "preview" | "production";
  readonly release: string;
  readonly eligible: boolean;
}

export interface SloDefinition {
  readonly id: `NFR-SLO-${string}`;
  readonly metric: SloMetric;
  readonly statistic: "ratio" | "p75" | "p95";
  readonly comparison: "maximum" | "minimum";
  readonly target: number;
  readonly unit: "milliseconds" | "ratio";
}

export const sloDefinitions: readonly SloDefinition[] = [
  {
    id: "NFR-SLO-001",
    metric: "availability",
    statistic: "ratio",
    comparison: "minimum",
    target: 0.999,
    unit: "ratio",
  },
  {
    id: "NFR-SLO-002",
    metric: "lcp_ms",
    statistic: "p75",
    comparison: "maximum",
    target: 2_500,
    unit: "milliseconds",
  },
  {
    id: "NFR-SLO-003",
    metric: "inp_ms",
    statistic: "p75",
    comparison: "maximum",
    target: 200,
    unit: "milliseconds",
  },
  {
    id: "NFR-SLO-004",
    metric: "cls",
    statistic: "p75",
    comparison: "maximum",
    target: 0.1,
    unit: "ratio",
  },
  {
    id: "NFR-SLO-005",
    metric: "critical_api_ms",
    statistic: "p95",
    comparison: "maximum",
    target: 500,
    unit: "milliseconds",
  },
  {
    id: "NFR-SLO-006",
    metric: "feedback_commit_ms",
    statistic: "p95",
    comparison: "maximum",
    target: 1_000,
    unit: "milliseconds",
  },
  {
    id: "NFR-SLO-007",
    metric: "dashboard_ms",
    statistic: "p95",
    comparison: "maximum",
    target: 1_000,
    unit: "milliseconds",
  },
  {
    id: "NFR-SLO-008",
    metric: "attachment_processing_ms",
    statistic: "p95",
    comparison: "maximum",
    target: 2_000,
    unit: "milliseconds",
  },
  {
    id: "NFR-SLO-009",
    metric: "notification_visibility_ms",
    statistic: "p95",
    comparison: "maximum",
    target: 5_000,
    unit: "milliseconds",
  },
  {
    id: "NFR-SLO-010",
    metric: "email_handoff_ms",
    statistic: "p95",
    comparison: "maximum",
    target: 30_000,
    unit: "milliseconds",
  },
];

const safeLabel = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function instant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value.endsWith("Z") ? parsed : undefined;
}

function assertObservation(definition: SloDefinition, observation: SloObservation) {
  if (
    observation.metric !== definition.metric ||
    !Number.isFinite(observation.value) ||
    observation.value < 0 ||
    (observation.metric === "availability" &&
      observation.value !== 0 &&
      observation.value !== 1) ||
    instant(observation.measuredAt) === undefined ||
    !safeLabel.test(observation.release)
  )
    throw new Error("SLO_OBSERVATION_INVALID");
}

function nearestRank(values: readonly number[], percentile: 75 | 95): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil((percentile / 100) * ordered.length) - 1] as number;
}

export function evaluateSloSeries(
  definition: SloDefinition,
  observations: readonly SloObservation[],
):
  | {
      readonly status: "failed" | "passed";
      readonly sampleCount: number;
      readonly excludedCount: number;
      readonly value: number;
      readonly target: number;
    }
  | {
      readonly status: "insufficient_data";
      readonly sampleCount: 0;
      readonly excludedCount: number;
    } {
  for (const observation of observations) assertObservation(definition, observation);
  const eligible = observations.filter(({ eligible }) => eligible);
  const excludedCount = observations.length - eligible.length;
  if (eligible.length === 0)
    return { status: "insufficient_data", sampleCount: 0, excludedCount };
  const values = eligible.map(({ value }) => value);
  const value =
    definition.statistic === "ratio"
      ? values.reduce((sum, candidate) => sum + candidate, 0) / values.length
      : nearestRank(values, definition.statistic === "p75" ? 75 : 95);
  const passed =
    definition.comparison === "minimum"
      ? value >= definition.target
      : value <= definition.target;
  return {
    status: passed ? "passed" : "failed",
    sampleCount: eligible.length,
    excludedCount,
    value,
    target: definition.target,
  };
}

function monthWindow(month: string): { readonly start: number; readonly end: number } {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month)) throw new Error("SLO_MONTH_INVALID");
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  return {
    start: Date.UTC(year, monthIndex, 1),
    end: Date.UTC(year, monthIndex + 1, 1),
  };
}

export function buildMonthlySloReport(input: {
  readonly month: string;
  readonly generatedAt: string;
  readonly observations: readonly SloObservation[];
}) {
  const window = monthWindow(input.month);
  const generatedAt = instant(input.generatedAt);
  if (generatedAt === undefined) throw new Error("SLO_REPORT_TIME_INVALID");
  const production = input.observations.filter((observation) => {
    const measuredAt = instant(observation.measuredAt);
    if (measuredAt === undefined) throw new Error("SLO_OBSERVATION_INVALID");
    return (
      observation.environment === "production" &&
      measuredAt >= window.start &&
      measuredAt < window.end
    );
  });
  const series = sloDefinitions.map((definition) => ({
    id: definition.id,
    metric: definition.metric,
    result: evaluateSloSeries(
      definition,
      production.filter(({ metric }) => metric === definition.metric),
    ),
  }));
  const status =
    generatedAt < window.end
      ? "provisional"
      : series.some(({ result }) => result.status === "insufficient_data")
        ? "insufficient_data"
        : series.some(({ result }) => result.status === "failed")
          ? "failed"
          : "passed";
  return {
    month: input.month,
    generatedAt: input.generatedAt,
    status,
    series,
  } as const;
}

const loadDefinitions = sloDefinitions.filter(({ id }) => Number(id.slice(-3)) >= 5);

export interface CapacityReportInput {
  readonly environment: "preview";
  readonly release: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly concurrency: number;
  readonly iterations: number;
  readonly observations: readonly SloObservation[];
}

export function buildCapacityReport(input: CapacityReportInput) {
  const startedAt = instant(input.startedAt);
  const completedAt = instant(input.completedAt);
  if (
    startedAt === undefined ||
    completedAt === undefined ||
    completedAt < startedAt ||
    !safeLabel.test(input.release) ||
    !Number.isSafeInteger(input.concurrency) ||
    input.concurrency < 1 ||
    !Number.isSafeInteger(input.iterations) ||
    input.iterations < 1
  )
    throw new Error("SLO_CAPACITY_INPUT_INVALID");
  if (
    input.observations.some((observation) => {
      const measuredAt = instant(observation.measuredAt);
      return (
        observation.environment !== input.environment ||
        observation.release !== input.release ||
        measuredAt === undefined ||
        measuredAt < startedAt ||
        measuredAt > completedAt
      );
    })
  )
    throw new Error("SLO_CAPACITY_OBSERVATION_INVALID");
  if (input.observations.length > 0 && input.observations.length !== input.iterations)
    throw new Error("SLO_CAPACITY_SAMPLE_COUNT_INVALID");
  const series = loadDefinitions.map((definition) => ({
    id: definition.id,
    metric: definition.metric,
    result: evaluateSloSeries(
      definition,
      input.observations.filter(({ metric }) => metric === definition.metric),
    ),
  }));
  const status = series.every(({ result }) => result.status === "passed")
    ? "passed"
    : "failed";
  return {
    status,
    environment: input.environment,
    release: input.release,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    envelope: { concurrency: input.concurrency, iterations: input.iterations },
    series,
  } as const;
}
