import type { SloMetric } from "@y7-feedback/domain";

type Environment = "development" | "preview" | "production";
type Eligibility =
  "authorization_denied" | "client_rejected" | "eligible" | "rate_limited";

export interface HttpSloInput {
  readonly method: string;
  readonly path: string;
  readonly operation: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly measuredAt: string;
  readonly environment: Environment;
  readonly release: string;
}

export interface HttpSloMeasurement {
  readonly event: "slo.measurement";
  readonly metricName: SloMetric;
  readonly metricValue: number;
  readonly measuredAt: string;
  readonly environment: Exclude<Environment, "development">;
  readonly release: string;
  readonly eligibility: Eligibility;
}

const intake = /^\/v1\/projects\/[^/]+\/feedback$/u;
const reporterControl =
  /^\/v1\/feedback\/(?:retrieve|access-proof\/(?:rotate|revoke)|attachments\/download)$/u;
const workspaceAttachmentControl =
  /^\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/attachments\/[^/]+/u;

function eligibility(statusCode: number): Eligibility {
  if (statusCode === 401 || statusCode === 403 || statusCode === 404)
    return "authorization_denied";
  if (statusCode === 429) return "rate_limited";
  if (statusCode >= 400 && statusCode < 500) return "client_rejected";
  return "eligible";
}

function metrics(input: HttpSloInput): readonly SloMetric[] {
  const critical =
    (input.operation === "public_api" &&
      (intake.test(input.path) ||
        reporterControl.test(input.path) ||
        workspaceAttachmentControl.test(input.path))) ||
    input.operation === "conversation_lifecycle" ||
    input.operation === "workbench";
  if (!critical) return [];
  return [
    "critical_api_ms",
    ...(intake.test(input.path) && input.method.toUpperCase() === "POST"
      ? (["feedback_commit_ms"] as const)
      : []),
    ...(input.operation === "workbench" && input.method.toUpperCase() === "GET"
      ? (["dashboard_ms"] as const)
      : []),
  ];
}

export function classifyHttpSloMeasurements(
  input: HttpSloInput,
): readonly HttpSloMeasurement[] {
  if (
    !Number.isFinite(input.durationMs) ||
    input.durationMs < 0 ||
    !Number.isFinite(Date.parse(input.measuredAt)) ||
    !input.measuredAt.endsWith("Z")
  )
    throw new Error("HTTP_SLO_INPUT_INVALID");
  if (input.environment === "development" || input.operation === "unknown") return [];
  const environment = input.environment;
  const observationEligibility = eligibility(input.statusCode);
  return metrics(input).map((metricName) => ({
    event: "slo.measurement",
    metricName,
    metricValue: input.durationMs,
    measuredAt: input.measuredAt,
    environment,
    release: input.release,
    eligibility: observationEligibility,
  }));
}
