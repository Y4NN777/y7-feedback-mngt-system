export interface ProviderMaintenanceCapability {
  runOnce(): Promise<object>;
}

export interface ProviderMaintenance {
  runOnce(): Promise<Readonly<Record<string, unknown>>>;
}

function capabilityStatus(value: object) {
  const status = "status" in value ? value.status : undefined;
  return typeof status === "string" ? status : "completed";
}

export function createProviderMaintenance(input: {
  readonly inbox?: ProviderMaintenanceCapability;
  readonly outbox?: ProviderMaintenanceCapability;
  readonly webhooks?: ProviderMaintenanceCapability;
  readonly privacy?: ProviderMaintenanceCapability;
}): ProviderMaintenance {
  const capabilities = Object.entries(input) as Array<
    ["inbox" | "outbox" | "webhooks" | "privacy", ProviderMaintenanceCapability]
  >;
  if (capabilities.length === 0)
    throw new Error("PROVIDER_MAINTENANCE_CONFIGURATION_INVALID");
  return {
    async runOnce() {
      const outcomes = await Promise.allSettled(
        capabilities.map(([, capability]) => capability.runOnce()),
      );
      if (outcomes.some(({ status }) => status === "rejected")) {
        throw new Error("PROVIDER_MAINTENANCE_RETRYABLE");
      }
      const fulfilled = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<object> =>
          outcome.status === "fulfilled",
      );
      const result: Record<string, unknown> = {
        status: "completed",
      };
      for (const [index, outcome] of fulfilled.entries())
        result[capabilities[index]![0]] = capabilityStatus(outcome.value);
      return result;
    },
  };
}
