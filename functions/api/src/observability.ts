const allowedEvents = new Set([
  "api.request.completed",
  "probe.completed",
  "rum.web_vital",
]);

const allowedFields = [
  "event",
  "correlationId",
  "environment",
  "release",
  "operation",
  "outcome",
  "statusCode",
  "durationMs",
  "metricName",
  "metricValue",
  "rating",
  "navigationType",
] as const;

function isSafeValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

export function serializeOperationalEvent(
  fields: Readonly<Record<string, unknown>>,
): string {
  if (typeof fields.event !== "string" || !allowedEvents.has(fields.event)) {
    throw new Error("TELEMETRY_EVENT_INVALID");
  }

  const safeFields: Record<string, string | number | boolean> = {};
  for (const field of allowedFields) {
    const value = fields[field];
    if (isSafeValue(value)) {
      safeFields[field] = value;
    }
  }

  return JSON.stringify(safeFields);
}
