import {
  ProviderMessageError,
  type ProviderMessageAdapter,
  type ProviderMessageRepository,
} from "./provider-message.js";
import type { SourceProvider } from "@y7-feedback/domain";

export type ClaimedProviderMessage = {
  readonly outboxId: string;
  readonly linkId: string;
  readonly operationId: string;
  readonly provider: SourceProvider;
  readonly encryptedGrantRef: string;
  readonly repository: ProviderMessageRepository;
  readonly issueId: string;
  readonly attempt: number;
} & (
  | { readonly kind: "publish_message"; readonly content: string }
  | { readonly kind: "remove_message"; readonly commentId: string }
);

export interface ProviderMessageOutboxStore {
  claim(input: {
    readonly workerId: string;
    readonly now: string;
    readonly staleBefore: string;
  }): Promise<ClaimedProviderMessage | null>;
  delivered(input: {
    readonly outboxId: string;
    readonly linkId: string;
    readonly attempt: number;
    readonly deliveredAt: string;
    readonly providerObjectId?: string;
    readonly missing?: boolean;
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

export function createProviderMessageOutboxWorker(dependencies: {
  readonly workerId: string;
  readonly store: ProviderMessageOutboxStore;
  readonly providers: readonly ProviderMessageAdapter[];
  readonly now: () => Date;
  readonly staleAfterMs: number;
  readonly maximumAttempts: number;
  readonly retryDelayMs: (attempt: number) => number;
}) {
  const providers = new Map(
    dependencies.providers.map((item) => [item.provider, item]),
  );
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u.test(dependencies.workerId) ||
    providers.size !== 2 ||
    !providers.has("github") ||
    !providers.has("gitlab") ||
    !Number.isSafeInteger(dependencies.staleAfterMs) ||
    dependencies.staleAfterMs < 1_000 ||
    !Number.isSafeInteger(dependencies.maximumAttempts) ||
    dependencies.maximumAttempts < 1 ||
    dependencies.maximumAttempts > 20
  )
    throw new Error("PROVIDER_MESSAGE_OUTBOX_CONFIG_INVALID");
  const iso = (value: Date) => {
    if (!Number.isFinite(value.getTime()))
      throw new Error("PROVIDER_MESSAGE_OUTBOX_CLOCK_INVALID");
    return value.toISOString();
  };
  return {
    async runOnce(): Promise<Readonly<Record<string, unknown>>> {
      const started = dependencies.now();
      const claim = await dependencies.store.claim({
        workerId: dependencies.workerId,
        now: iso(started),
        staleBefore: iso(new Date(started.getTime() - dependencies.staleAfterMs)),
      });
      if (!claim) return { status: "idle" };
      if (claim.attempt < 1 || claim.attempt > dependencies.maximumAttempts)
        throw new Error("PROVIDER_MESSAGE_OUTBOX_CLAIM_INVALID");
      const adapter = providers.get(claim.provider);
      if (!adapter) throw new Error("PROVIDER_MESSAGE_OUTBOX_CLAIM_INVALID");
      try {
        if (claim.kind === "publish_message") {
          const result = await adapter.publish(claim);
          await dependencies.store.delivered({
            outboxId: claim.outboxId,
            linkId: claim.linkId,
            attempt: claim.attempt,
            deliveredAt: iso(dependencies.now()),
            providerObjectId: result.commentId,
          });
          return { status: "delivered", kind: claim.kind, replayed: result.replayed };
        }
        const result = await adapter.remove(claim);
        await dependencies.store.delivered({
          outboxId: claim.outboxId,
          linkId: claim.linkId,
          attempt: claim.attempt,
          deliveredAt: iso(dependencies.now()),
          missing: result.missing,
        });
        return { status: "delivered", kind: claim.kind, missing: result.missing };
      } catch (error) {
        const failure =
          error instanceof ProviderMessageError ? error.failure : "retryable";
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
          return { status: "failed", errorCode };
        }
        const delay = dependencies.retryDelayMs(claim.attempt);
        if (!Number.isSafeInteger(delay) || delay < 1_000 || delay > 86_400_000)
          throw new Error("PROVIDER_MESSAGE_OUTBOX_RETRY_INVALID");
        const nextAttemptAt = iso(new Date(Date.parse(failedAt) + delay));
        await dependencies.store.retry({
          outboxId: claim.outboxId,
          linkId: claim.linkId,
          attempt: claim.attempt,
          failedAt,
          nextAttemptAt,
          errorCode: "provider_retryable",
        });
        return { status: "retry_scheduled", nextAttemptAt };
      }
    },
  };
}
