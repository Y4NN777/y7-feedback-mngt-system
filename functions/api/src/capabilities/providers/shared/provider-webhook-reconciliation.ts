import type {
  ActiveSourceGrant,
  SourceWebhookProvisioner,
} from "./source-connection-coordinator.js";
import { ProviderWebhookAuthorityDeniedError } from "./provider-webhook-provisioner.js";

export interface ActiveSourceGrantReader {
  list(limit: number): Promise<readonly ActiveSourceGrant[]>;
  suspend(connectionId: string, updatedAt: string): Promise<void>;
}

export interface ProviderWebhookReconciliation {
  runOnce(): Promise<{
    readonly status: "reconciled";
    readonly inspected: number;
    readonly repaired: number;
    readonly suspended: number;
  }>;
}

export function createProviderWebhookReconciliation(
  connections: ActiveSourceGrantReader,
  webhooks: SourceWebhookProvisioner,
  batchSize: number,
  nowIso: () => string,
): ProviderWebhookReconciliation {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("PROVIDER_WEBHOOK_RECONCILIATION_CONFIG_INVALID");
  }
  return {
    async runOnce() {
      const active = await connections.list(batchSize);
      const outcomes = await Promise.allSettled(
        active.map(async (connection) => {
          try {
            await webhooks.ensure(connection);
            return "repaired" as const;
          } catch (error: unknown) {
            if (!(error instanceof ProviderWebhookAuthorityDeniedError)) throw error;
            await connections.suspend(connection.id, nowIso());
            return "suspended" as const;
          }
        }),
      );
      if (outcomes.some(({ status }) => status === "rejected")) {
        throw new Error("PROVIDER_WEBHOOK_RECONCILIATION_RETRYABLE");
      }
      return {
        status: "reconciled",
        inspected: active.length,
        repaired: outcomes.filter(
          (outcome) => outcome.status === "fulfilled" && outcome.value === "repaired",
        ).length,
        suspended: outcomes.filter(
          (outcome) => outcome.status === "fulfilled" && outcome.value === "suspended",
        ).length,
      };
    },
  };
}
