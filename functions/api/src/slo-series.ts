import { sloDefinitions } from "@y7-feedback/domain";

export interface LatencyHistogram {
  readonly count: number;
  readonly sum: number;
  readonly buckets: readonly {
    readonly upperBoundMs: number | null;
    readonly cumulativeCount: number;
  }[];
}

export function buildLatencyHistogram(
  observationsMs: readonly number[],
  boundariesMs: readonly number[],
): LatencyHistogram {
  const validObservations = observationsMs.every(
    (value) => Number.isFinite(value) && value >= 0,
  );
  const validBoundaries = boundariesMs.every(
    (value, index) =>
      Number.isFinite(value) &&
      value > 0 &&
      (index === 0 || value > (boundariesMs[index - 1] as number)),
  );
  if (!validObservations || boundariesMs.length === 0 || !validBoundaries)
    throw new Error("SLO_HISTOGRAM_INVALID");

  return {
    count: observationsMs.length,
    sum: observationsMs.reduce((sum, value) => sum + value, 0),
    buckets: [
      ...boundariesMs.map((upperBoundMs) => ({
        upperBoundMs,
        cumulativeCount: observationsMs.filter((value) => value <= upperBoundMs).length,
      })),
      { upperBoundMs: null, cumulativeCount: observationsMs.length },
    ],
  };
}

type Collector =
  | "mail_handoff_probe"
  | "synthetic_uptime_probe"
  | "trusted_api_histogram"
  | "vercel_web_vitals";

const collectors = {
  availability: "synthetic_uptime_probe",
  lcp_ms: "vercel_web_vitals",
  inp_ms: "vercel_web_vitals",
  cls: "vercel_web_vitals",
  critical_api_ms: "trusted_api_histogram",
  feedback_commit_ms: "trusted_api_histogram",
  dashboard_ms: "trusted_api_histogram",
  attachment_processing_ms: "trusted_api_histogram",
  notification_visibility_ms: "trusted_api_histogram",
  email_handoff_ms: "mail_handoff_probe",
} as const satisfies Readonly<
  Record<(typeof sloDefinitions)[number]["metric"], Collector>
>;

const prohibitedFields = [
  "accessProof",
  "attachmentContent",
  "contact",
  "internalNote",
  "providerToken",
  "workspaceId",
] as const;

export function buildMeasurementSeriesIndex() {
  return sloDefinitions.map((definition) => ({
    id: definition.id,
    metric: definition.metric,
    statistic: definition.statistic,
    target: definition.target,
    unit: definition.unit,
    collector: collectors[definition.metric],
    evidenceScope: "preview_load_and_production_monthly" as const,
    prohibitedFields,
  }));
}
