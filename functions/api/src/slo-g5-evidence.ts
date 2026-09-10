import type { SloMetric } from "@y7-feedback/domain";

const fields = [
  ["critical_api_ms", "criticalApiSamplesMs"],
  ["feedback_commit_ms", "feedbackCommitSamplesMs"],
  ["dashboard_ms", "dashboardSamplesMs"],
  ["attachment_processing_ms", "attachmentProcessingSamplesMs"],
  ["notification_visibility_ms", "notificationVisibilitySamplesMs"],
  ["email_handoff_ms", "emailHandoffSamplesMs"],
] as const satisfies readonly (readonly [SloMetric, string])[];

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("SLO_G5_EVIDENCE_INVALID");
  return value as Readonly<Record<string, unknown>>;
}

export function collectSloEvidenceSamples(
  value: unknown,
): readonly (readonly [SloMetric, number])[] {
  const candidate = record(value);
  const result: Array<readonly [SloMetric, number]> = [];
  for (const [metric, field] of fields) {
    const samples = candidate[field];
    if (!Array.isArray(samples)) continue;
    if (
      samples.some(
        (sample) =>
          typeof sample !== "number" || !Number.isFinite(sample) || sample < 0,
      )
    )
      throw new Error("SLO_G5_EVIDENCE_INVALID");
    result.push(...samples.map((sample) => [metric, sample] as const));
  }
  if (result.length === 0) throw new Error("SLO_G5_EVIDENCE_INVALID");
  return result;
}
