import type { ExternalIssuePayload, SourceProvider } from "@y7-feedback/domain";

import {
  ProviderIssueError,
  type ProviderIssueAdapter,
  type ProviderIssueRepository,
} from "./provider-issue.js";

export interface ClaimedProviderIssue {
  readonly outboxId: string;
  readonly linkId: string;
  readonly operationId: string;
  readonly provider: SourceProvider;
  readonly encryptedGrantRef: string;
  readonly repository: ProviderIssueRepository;
  readonly payload: ExternalIssuePayload;
  readonly attempt: number;
}

export interface ProviderIssueOutboxStore {
  claim(input: {
    readonly workerId: string;
    readonly now: string;
    readonly staleBefore: string;
  }): Promise<ClaimedProviderIssue | null>;
  delivered(input: {
    readonly outboxId: string;
    readonly linkId: string;
    readonly attempt: number;
    readonly issueId: string;
    readonly issueUrl: string;
    readonly deliveredAt: string;
  }): Promise<void>;
  retry(input: {
    readonly outboxId: string;
    readonly linkId: string;
    readonly attempt: number;
    readonly failedAt: string;
    readonly nextAttemptAt: string;
    readonly errorCode: "provider_retryable";
  }): Promise<void>;
  failed(input: {
    readonly outboxId: string;
    readonly linkId: string;
    readonly attempt: number;
    readonly failedAt: string;
    readonly errorCode: "provider_permanent" | "attempts_exhausted";
  }): Promise<void>;
}

export interface ProviderIssueOutboxDependencies {
  readonly workerId: string;
  readonly store: ProviderIssueOutboxStore;
  readonly providers: readonly ProviderIssueAdapter[];
  readonly now: () => Date;
  readonly staleAfterMs: number;
  readonly maximumAttempts: number;
  readonly retryDelayMs: (attempt: number) => number;
}

const workerId = /^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u;

function iso(value: Date): string {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) throw new Error("PROVIDER_OUTBOX_CLOCK_INVALID");
  return value.toISOString();
}

export function createProviderIssueOutboxWorker(
  dependencies: ProviderIssueOutboxDependencies,
): { runOnce(): Promise<Readonly<Record<string, unknown>>> } {
  if (
    !workerId.test(dependencies.workerId) ||
    !Number.isSafeInteger(dependencies.staleAfterMs) ||
    dependencies.staleAfterMs < 1_000 ||
    !Number.isSafeInteger(dependencies.maximumAttempts) ||
    dependencies.maximumAttempts < 1 ||
    dependencies.maximumAttempts > 20
  ) {
    throw new Error("PROVIDER_OUTBOX_CONFIG_INVALID");
  }
  const providers = new Map(
    dependencies.providers.map((item) => [item.provider, item]),
  );
  if (providers.size !== 2 || !providers.has("github") || !providers.has("gitlab")) {
    throw new Error("PROVIDER_OUTBOX_CONFIG_INVALID");
  }
  return {
    async runOnce() {
      const started = dependencies.now();
      const now = iso(started);
      const claim = await dependencies.store.claim({
        workerId: dependencies.workerId,
        now,
        staleBefore: iso(new Date(started.getTime() - dependencies.staleAfterMs)),
      });
      if (!claim) return { status: "idle" };
      if (
        !Number.isSafeInteger(claim.attempt) ||
        claim.attempt < 1 ||
        claim.attempt > dependencies.maximumAttempts
      ) {
        throw new Error("PROVIDER_OUTBOX_CLAIM_INVALID");
      }
      const provider = providers.get(claim.provider);
      if (!provider) throw new Error("PROVIDER_OUTBOX_CLAIM_INVALID");
      try {
        const delivered = await provider.createIssue({
          encryptedGrantRef: claim.encryptedGrantRef,
          operationId: claim.operationId,
          repository: claim.repository,
          payload: claim.payload,
        });
        const deliveredAt = iso(dependencies.now());
        await dependencies.store.delivered({
          outboxId: claim.outboxId,
          linkId: claim.linkId,
          attempt: claim.attempt,
          issueId: delivered.issueId,
          issueUrl: delivered.issueUrl,
          deliveredAt,
        });
        return {
          status: "delivered",
          attempt: claim.attempt,
          replayed: delivered.replayed,
        };
      } catch (error) {
        const failure =
          error instanceof ProviderIssueError ? error.failure : "retryable";
        const failedAt = iso(dependencies.now());
        if (failure === "permanent" || claim.attempt === dependencies.maximumAttempts) {
          const errorCode =
            failure === "permanent" ? "provider_permanent" : "attempts_exhausted";
          await dependencies.store.failed({
            outboxId: claim.outboxId,
            linkId: claim.linkId,
            attempt: claim.attempt,
            failedAt,
            errorCode,
          });
          return { status: "failed", attempt: claim.attempt, errorCode };
        }
        const delay = dependencies.retryDelayMs(claim.attempt);
        if (!Number.isSafeInteger(delay) || delay < 1_000 || delay > 86_400_000) {
          throw new Error("PROVIDER_OUTBOX_RETRY_INVALID");
        }
        const nextAttemptAt = iso(new Date(Date.parse(failedAt) + delay));
        await dependencies.store.retry({
          outboxId: claim.outboxId,
          linkId: claim.linkId,
          attempt: claim.attempt,
          failedAt,
          nextAttemptAt,
          errorCode: "provider_retryable",
        });
        return { status: "retry_scheduled", attempt: claim.attempt, nextAttemptAt };
      }
    },
  };
}
