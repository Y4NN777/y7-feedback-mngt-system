export interface ProviderMaintenanceCapability {
  runOnce(): Promise<Readonly<Record<string, unknown>>>;
}

export interface ProviderMaintenance {
  runOnce(): Promise<Readonly<Record<string, unknown>>>;
}

function capabilityStatus(value: Readonly<Record<string, unknown>>) {
  return typeof value.status === "string" ? value.status : "completed";
}

export function createProviderMaintenance(input: {
  readonly inbox: ProviderMaintenanceCapability;
  readonly outbox: ProviderMaintenanceCapability;
  readonly webhooks: ProviderMaintenanceCapability;
}): ProviderMaintenance {
  return {
    async runOnce() {
      const [inbox, outbox, webhooks] = await Promise.allSettled([
        input.inbox.runOnce(),
        input.outbox.runOnce(),
        input.webhooks.runOnce(),
      ]);
      if (
        inbox.status === "rejected" ||
        outbox.status === "rejected" ||
        webhooks.status === "rejected"
      ) {
        throw new Error("PROVIDER_MAINTENANCE_RETRYABLE");
      }
      return {
        status: "completed",
        inbox: capabilityStatus(inbox.value),
        outbox: capabilityStatus(outbox.value),
        webhooks: capabilityStatus(webhooks.value),
      };
    },
  };
}
