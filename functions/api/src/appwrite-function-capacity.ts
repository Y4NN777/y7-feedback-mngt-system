import type { ApplicationEnvironment } from "@y7-feedback/config/public";

export function resolveAppwriteFunctionRuntimeSpecification(
  environment: ApplicationEnvironment,
): string {
  return environment === "development" ? "s-1vcpu-1gb" : "s-4vcpu-4gb";
}
