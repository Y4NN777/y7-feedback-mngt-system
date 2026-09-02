import type {
  ActiveSourceGrant,
  SourceWebhookProvisioner,
} from "./source-connection-coordinator.js";

export interface ActiveSourceGrantReader {
  list(limit: number): Promise<readonly ActiveSourceGrant[]>;
}

export interface ProviderWebhookReconciliation {
  runOnce(): Promise<{
    readonly status: "reconciled";
    readonly inspected: number;
    readonly repaired: number;
  }>;
}

export function createProviderWebhookReconciliation(
  connections: ActiveSourceGrantReader,
  webhooks: SourceWebhookProvisioner,
  batchSize: number,
): ProviderWebhookReconciliation {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("PROVIDER_WEBHOOK_RECONCILIATION_CONFIG_INVALID");
  }
  return {
    async runOnce() {
      const active = await connections.list(batchSize);
      const outcomes = await Promise.allSettled(
        active.map((connection) => webhooks.ensure(connection)),
      );
      if (outcomes.some(({ status }) => status === "rejected")) {
        throw new Error("PROVIDER_WEBHOOK_RECONCILIATION_RETRYABLE");
      }
      return {
        status: "reconciled",
        inspected: active.length,
        repaired: outcomes.length,
      };
    },
  };
}
