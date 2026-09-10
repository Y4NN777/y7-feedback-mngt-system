import {
  buildCapacityReport,
  type SloMetric,
  type SloObservation,
} from "@y7-feedback/domain";

const loadMetrics = [
  "critical_api_ms",
  "feedback_commit_ms",
  "dashboard_ms",
  "attachment_processing_ms",
  "notification_visibility_ms",
  "email_handoff_ms",
] as const satisfies readonly SloMetric[];

export type SloLoadMetric = (typeof loadMetrics)[number];
export type SloLoadProbe = () => Promise<void>;

export async function runSloLoadEnvelope(input: {
  readonly concurrency: number;
  readonly iterations: number;
  readonly probes: Readonly<Record<SloLoadMetric, SloLoadProbe>>;
  readonly release: string;
  readonly nowIso?: () => string;
  readonly nowMs?: () => number;
}) {
  if (
    !Number.isSafeInteger(input.concurrency) ||
    input.concurrency < 1 ||
    !Number.isSafeInteger(input.iterations) ||
    input.iterations < loadMetrics.length ||
    input.iterations % loadMetrics.length !== 0
  )
    throw new Error("SLO_LOAD_ENVELOPE_INVALID");
  const nowIso = input.nowIso ?? (() => new Date().toISOString());
  const nowMs = input.nowMs ?? Date.now;
  const startedAt = nowIso();
  const observations: SloObservation[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= input.iterations) return;
      const metric = loadMetrics[index % loadMetrics.length] as SloLoadMetric;
      const started = nowMs();
      try {
        await input.probes[metric]();
      } catch (error: unknown) {
        throw new Error("SLO_LOAD_PROBE_FAILED", { cause: error });
      }
      observations.push({
        metric,
        value: Math.max(0, nowMs() - started),
        measuredAt: nowIso(),
        environment: "preview",
        release: input.release,
        eligible: true,
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(input.concurrency, input.iterations) }, worker),
  );
  const completedAt = nowIso();
  return {
    observations,
    report: buildCapacityReport({
      environment: "preview",
      release: input.release,
      startedAt,
      completedAt,
      concurrency: input.concurrency,
      iterations: input.iterations,
      observations,
    }),
  } as const;
}
