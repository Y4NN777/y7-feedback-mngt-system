export interface ProviderMessageSyncEvidenceTarget {
  readonly environment: "preview" | "production";
  readonly functionDomain: string;
  readonly functionId: string;
}

export function resolveProviderMessageSyncEvidenceTarget(input: {
  readonly arguments: readonly string[];
  readonly configuredEnvironment: "development" | "preview" | "production";
  readonly functionDomain: string | undefined;
  readonly functionId: string | undefined;
}): ProviderMessageSyncEvidenceTarget {
  const environment = input.arguments.includes("--production")
    ? "production"
    : "preview";
  const functionDomain = input.functionDomain?.trim();
  if (input.configuredEnvironment !== environment || !functionDomain)
    throw new Error("MESSAGE_SYNC_VERIFY_CONFIG_INVALID");
  return {
    environment,
    functionDomain,
    functionId: input.functionId?.trim() || `y7-feedback-api-${environment}`,
  };
}
