import {
  sloDefinitions,
  type SloMetric,
  type SloObservation,
} from "@y7-feedback/domain";

export type MonthlySloReport = ReturnType<
  typeof import("@y7-feedback/domain").buildMonthlySloReport
>;

const eligibilityValues = new Set([
  "authorization_denied",
  "client_rejected",
  "eligible",
  "rate_limited",
]);
const metrics = new Set<SloMetric>(sloDefinitions.map(({ metric }) => metric));
const safeRelease = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("SLO_MEASUREMENT_INVALID");
  return value as Readonly<Record<string, unknown>>;
}

export function parseSloMeasurement(value: unknown): SloObservation {
  const candidate = record(value);
  const metric = candidate.metricName;
  const metricValue = candidate.metricValue;
  const measuredAt = candidate.measuredAt;
  const environment = candidate.environment;
  const release = candidate.release;
  const eligibility = candidate.eligibility;
  if (
    candidate.event !== "slo.measurement" ||
    typeof metric !== "string" ||
    !metrics.has(metric as SloMetric) ||
    typeof metricValue !== "number" ||
    !Number.isFinite(metricValue) ||
    metricValue < 0 ||
    (metric === "availability" && metricValue !== 0 && metricValue !== 1) ||
    typeof measuredAt !== "string" ||
    !Number.isFinite(Date.parse(measuredAt)) ||
    !measuredAt.endsWith("Z") ||
    (environment !== "preview" && environment !== "production") ||
    typeof release !== "string" ||
    !safeRelease.test(release) ||
    typeof eligibility !== "string" ||
    !eligibilityValues.has(eligibility)
  )
    throw new Error("SLO_MEASUREMENT_INVALID");
  const observation: SloObservation = {
    metric: metric as SloMetric,
    value: metricValue,
    measuredAt,
    environment,
    release,
    eligible: eligibility === "eligible",
  };
  return observation;
}

export interface SloAlert {
  readonly event: "slo.alert";
  readonly alertId: string;
  readonly month: string;
  readonly sloId: string;
  readonly metric: SloMetric;
  readonly severity: "critical" | "warning";
  readonly observedValue: number;
  readonly target: number;
  readonly sampleCount: number;
  readonly reportStatus: MonthlySloReport["status"];
}

export interface SloAlertSink {
  send(alert: SloAlert): Promise<void>;
}

export async function routeSloAlerts(
  report: MonthlySloReport,
  sink: SloAlertSink,
): Promise<{ readonly sent: number }> {
  const alerts: SloAlert[] = report.series.flatMap(({ id, metric, result }) =>
    result.status === "failed"
      ? [
          {
            event: "slo.alert",
            alertId: `${report.month}:${id}:failed`,
            month: report.month,
            sloId: id,
            metric,
            severity: report.status === "provisional" ? "warning" : "critical",
            observedValue: result.value,
            target: result.target,
            sampleCount: result.sampleCount,
            reportStatus: report.status,
          } satisfies SloAlert,
        ]
      : [],
  );
  for (const alert of alerts) await sink.send(alert);
  return { sent: alerts.length };
}
