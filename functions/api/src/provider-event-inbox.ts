import type { SourceProvider } from "@y7-feedback/domain";

export interface ClaimedProviderEvent {
  readonly inboxId: string;
  readonly provider: SourceProvider;
  readonly deliveryId: string;
  readonly eventType: string;
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly payloadEnvelope: string;
  readonly attempt: number;
}

export interface ProviderEventInboxWorkerStore {
  claim(input: {
    readonly workerId: string;
    readonly now: string;
    readonly staleBefore: string;
  }): Promise<ClaimedProviderEvent | null>;
  complete(input: {
    readonly inboxId: string;
    readonly attempt: number;
    readonly completedAt: string;
  }): Promise<void>;
  retry(input: {
    readonly inboxId: string;
    readonly attempt: number;
    readonly availableAt: string;
    readonly errorCode: "handler_retryable";
  }): Promise<void>;
  fail(input: {
    readonly inboxId: string;
    readonly attempt: number;
    readonly failedAt: string;
    readonly errorCode: "handler_permanent" | "attempts_exhausted";
  }): Promise<void>;
}

export interface ProviderEventHandler {
  handle(
    event: ClaimedProviderEvent,
  ): Promise<"applied" | "ignored" | "retryable" | "permanent">;
}

export interface ProviderEventInboxWorkerDependencies {
  readonly store: ProviderEventInboxWorkerStore;
  readonly handler: ProviderEventHandler;
  readonly workerId: string;
  readonly now: () => Date;
  readonly staleAfterMs: number;
  readonly maximumAttempts: number;
  readonly retryDelayMs: (attempt: number) => number;
}

const workerId = /^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u;

function iso(value: Date, code: string): string {
  if (!Number.isFinite(value.getTime())) throw new Error(code);
  return value.toISOString();
}

export function createProviderEventInboxWorker(
  dependencies: ProviderEventInboxWorkerDependencies,
): { readonly runOnce: () => Promise<Readonly<Record<string, unknown>>> } {
  if (
    !workerId.test(dependencies.workerId) ||
    !Number.isSafeInteger(dependencies.staleAfterMs) ||
    dependencies.staleAfterMs < 1_000 ||
    !Number.isSafeInteger(dependencies.maximumAttempts) ||
    dependencies.maximumAttempts < 1 ||
    dependencies.maximumAttempts > 20
  ) {
    throw new Error("PROVIDER_INBOX_CONFIG_INVALID");
  }
  return {
    async runOnce() {
      const started = dependencies.now();
      const now = iso(started, "PROVIDER_INBOX_CLOCK_INVALID");
      const claim = await dependencies.store.claim({
        workerId: dependencies.workerId,
        now,
        staleBefore: iso(
          new Date(started.getTime() - dependencies.staleAfterMs),
          "PROVIDER_INBOX_CLOCK_INVALID",
        ),
      });
      if (!claim) return { status: "idle" };
      if (
        !Number.isSafeInteger(claim.attempt) ||
        claim.attempt < 1 ||
        claim.attempt > dependencies.maximumAttempts
      ) {
        throw new Error("PROVIDER_INBOX_CLAIM_INVALID");
      }
      let outcome: "applied" | "ignored" | "retryable" | "permanent";
      try {
        outcome = await dependencies.handler.handle(claim);
      } catch {
        outcome = "retryable";
      }
      if (outcome === "applied" || outcome === "ignored") {
        await dependencies.store.complete({
          inboxId: claim.inboxId,
          attempt: claim.attempt,
          completedAt: iso(dependencies.now(), "PROVIDER_INBOX_CLOCK_INVALID"),
        });
        return { status: "completed", outcome, attempt: claim.attempt };
      }
      const failedAt = dependencies.now();
      if (outcome === "permanent" || claim.attempt === dependencies.maximumAttempts) {
        const errorCode =
          outcome === "permanent" ? "handler_permanent" : "attempts_exhausted";
        await dependencies.store.fail({
          inboxId: claim.inboxId,
          attempt: claim.attempt,
          failedAt: iso(failedAt, "PROVIDER_INBOX_CLOCK_INVALID"),
          errorCode,
        });
        return { status: "failed", errorCode, attempt: claim.attempt };
      }
      const delay = dependencies.retryDelayMs(claim.attempt);
      if (!Number.isSafeInteger(delay) || delay < 1_000 || delay > 86_400_000) {
        throw new Error("PROVIDER_INBOX_RETRY_INVALID");
      }
      const availableAt = iso(
        new Date(failedAt.getTime() + delay),
        "PROVIDER_INBOX_CLOCK_INVALID",
      );
      await dependencies.store.retry({
        inboxId: claim.inboxId,
        attempt: claim.attempt,
        availableAt,
        errorCode: "handler_retryable",
      });
      return { status: "retry_scheduled", attempt: claim.attempt, availableAt };
    },
  };
}
