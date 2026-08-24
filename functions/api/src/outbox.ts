export type OutboxChannel = "email" | "in_product";

export interface ClaimedOutboxDelivery {
  readonly outboxId: string;
  readonly deliveryId: string;
  readonly channel: OutboxChannel;
  readonly payload: unknown;
  readonly attempt: number;
  readonly leaseToken: string;
}

export interface OutboxClaimRequest {
  readonly workerId: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly leaseUntil: string;
}

export interface OutboxDeliveryStore {
  claim(request: OutboxClaimRequest): Promise<ClaimedOutboxDelivery | null>;
  markDelivered(input: {
    readonly outboxId: string;
    readonly leaseToken: string;
    readonly deliveredAt: string;
  }): Promise<void>;
  reschedule(input: {
    readonly outboxId: string;
    readonly leaseToken: string;
    readonly nextAttemptAt: string;
  }): Promise<void>;
  markFailed(input: {
    readonly outboxId: string;
    readonly leaseToken: string;
    readonly failedAt: string;
    readonly reason: "permanent" | "attempts_exhausted";
  }): Promise<void>;
}

export interface OutboxDeliverySender {
  deliver(input: {
    readonly deliveryId: string;
    readonly channel: OutboxChannel;
    readonly payload: unknown;
  }): Promise<"delivered" | "retryable" | "permanent">;
}

export interface OutboxSafeEvent {
  readonly event: "outbox_delivery";
  readonly channel: OutboxChannel;
  readonly attempt: number;
  readonly outcome: "delivered" | "retry_scheduled" | "failed";
}

export interface OutboxWorkerDependencies {
  readonly store: OutboxDeliveryStore;
  readonly sender: OutboxDeliverySender;
  readonly workerId: string;
  readonly createLeaseToken: () => string;
  readonly now: () => Date;
  readonly leaseDurationMs: number;
  readonly retryDelayMs: (attempt: number) => number;
  readonly maximumAttempts: number;
  readonly log: (event: OutboxSafeEvent) => void;
}

export type OutboxRunResult =
  | { readonly status: "idle" }
  | {
      readonly status: "delivered" | "retry_scheduled" | "failed";
      readonly attempt: number;
    };

function validToken(value: string, error = "OUTBOX_WORKER_CONFIG_INVALID"): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(value)) {
    throw new Error(error);
  }
  return value;
}

function iso(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("OUTBOX_CLOCK_INVALID");
  return date.toISOString();
}

export function createOutboxWorker(dependencies: OutboxWorkerDependencies): {
  readonly runOnce: () => Promise<OutboxRunResult>;
} {
  const workerId = validToken(dependencies.workerId);
  if (
    !Number.isSafeInteger(dependencies.leaseDurationMs) ||
    dependencies.leaseDurationMs < 1_000 ||
    !Number.isSafeInteger(dependencies.maximumAttempts) ||
    dependencies.maximumAttempts < 1
  ) {
    throw new Error("OUTBOX_WORKER_CONFIG_INVALID");
  }

  return {
    async runOnce() {
      const startedAt = dependencies.now();
      const now = iso(startedAt);
      const leaseUntil = iso(
        new Date(startedAt.getTime() + dependencies.leaseDurationMs),
      );
      const leaseToken = validToken(dependencies.createLeaseToken());
      let claim: ClaimedOutboxDelivery | null;
      try {
        claim = await dependencies.store.claim({
          workerId,
          leaseToken,
          now,
          leaseUntil,
        });
      } catch (error: unknown) {
        throw new Error("OUTBOX_CLAIM_UNAVAILABLE", { cause: error });
      }
      if (!claim) return { status: "idle" };
      validToken(claim.leaseToken, "OUTBOX_CLAIM_INVALID");
      if (
        !Number.isSafeInteger(claim.attempt) ||
        claim.attempt < 1 ||
        claim.attempt > dependencies.maximumAttempts
      ) {
        throw new Error("OUTBOX_CLAIM_INVALID");
      }

      let delivery: "delivered" | "retryable" | "permanent";
      try {
        delivery = await dependencies.sender.deliver({
          deliveryId: claim.deliveryId,
          channel: claim.channel,
          payload: claim.payload,
        });
      } catch {
        delivery = "retryable";
      }

      if (delivery === "delivered") {
        try {
          await dependencies.store.markDelivered({
            outboxId: claim.outboxId,
            leaseToken: claim.leaseToken,
            deliveredAt: iso(dependencies.now()),
          });
        } catch (error: unknown) {
          throw new Error("OUTBOX_DELIVERED_WRITE_UNAVAILABLE", { cause: error });
        }
        dependencies.log({
          event: "outbox_delivery",
          channel: claim.channel,
          attempt: claim.attempt,
          outcome: "delivered",
        });
        return { status: "delivered", attempt: claim.attempt };
      }

      if (delivery === "permanent" || claim.attempt === dependencies.maximumAttempts) {
        try {
          await dependencies.store.markFailed({
            outboxId: claim.outboxId,
            leaseToken: claim.leaseToken,
            failedAt: iso(dependencies.now()),
            reason: delivery === "permanent" ? "permanent" : "attempts_exhausted",
          });
        } catch (error: unknown) {
          throw new Error("OUTBOX_FAILED_WRITE_UNAVAILABLE", { cause: error });
        }
        dependencies.log({
          event: "outbox_delivery",
          channel: claim.channel,
          attempt: claim.attempt,
          outcome: "failed",
        });
        return { status: "failed", attempt: claim.attempt };
      }

      const delay = dependencies.retryDelayMs(claim.attempt);
      if (!Number.isSafeInteger(delay) || delay < 1_000) {
        throw new Error("OUTBOX_RETRY_DELAY_INVALID");
      }
      try {
        await dependencies.store.reschedule({
          outboxId: claim.outboxId,
          leaseToken: claim.leaseToken,
          nextAttemptAt: iso(new Date(dependencies.now().getTime() + delay)),
        });
      } catch (error: unknown) {
        throw new Error("OUTBOX_RETRY_WRITE_UNAVAILABLE", { cause: error });
      }
      dependencies.log({
        event: "outbox_delivery",
        channel: claim.channel,
        attempt: claim.attempt,
        outcome: "retry_scheduled",
      });
      return { status: "retry_scheduled", attempt: claim.attempt };
    },
  };
}
