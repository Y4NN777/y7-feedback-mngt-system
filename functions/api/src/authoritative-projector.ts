import type { AuthoritativeCommit } from "@y7-feedback/domain";

export interface ClaimedAuthoritativeCommit {
  readonly commit: AuthoritativeCommit;
  readonly attempt: number;
  readonly leaseToken: string;
}

export interface AuthoritativeProjectionStore {
  claim(input: {
    readonly workerId: string;
    readonly now: string;
    readonly leaseUntil: string;
  }): Promise<ClaimedAuthoritativeCommit | null>;
  projected(input: {
    readonly commitId: string;
    readonly leaseToken: string;
    readonly attempt: number;
    readonly projectedAt: string;
  }): Promise<void>;
  retry(input: {
    readonly commitId: string;
    readonly leaseToken: string;
    readonly attempt: number;
    readonly availableAt: string;
    readonly errorCode: string;
  }): Promise<void>;
}

export interface AuthoritativeProjectionHandler {
  project(commit: AuthoritativeCommit): Promise<void>;
}

export interface AuthoritativeProjectorDependencies {
  readonly now: () => string;
  readonly leaseUntil: (now: string) => string;
  readonly retryAt: (now: string, attempt: number) => string;
  readonly errorCode: (error: unknown) => string;
}

export type AuthoritativeProjectionResult =
  | { readonly status: "idle" }
  | { readonly status: "projected"; readonly commitId: string }
  | { readonly status: "retry_scheduled"; readonly commitId: string };

export interface AuthoritativeProjectionBatchResult {
  readonly status: "completed";
  readonly processed: number;
  readonly projected: number;
  readonly retryScheduled: number;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const errorCode = /^[A-Z][A-Z0-9_]{2,63}$/u;

function requiredInstant(value: string): string {
  if (!instant.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("AUTHORITATIVE_PROJECTOR_CLOCK_INVALID");
  }
  return value;
}

export function createAuthoritativeProjector(
  store: AuthoritativeProjectionStore,
  handler: AuthoritativeProjectionHandler,
  dependencies: AuthoritativeProjectorDependencies,
) {
  async function runOnce(workerId: string): Promise<AuthoritativeProjectionResult> {
    if (!identifier.test(workerId)) {
      throw new Error("AUTHORITATIVE_PROJECTOR_WORKER_INVALID");
    }
    const now = requiredInstant(dependencies.now());
    const leaseUntil = requiredInstant(dependencies.leaseUntil(now));
    const claimed = await store.claim({ workerId, now, leaseUntil });
    if (claimed === null) return { status: "idle" };
    if (
      !identifier.test(claimed.commit.id) ||
      !identifier.test(claimed.leaseToken) ||
      !Number.isSafeInteger(claimed.attempt) ||
      claimed.attempt < 1
    ) {
      throw new Error("AUTHORITATIVE_PROJECTOR_CLAIM_INVALID");
    }
    try {
      await handler.project(claimed.commit);
    } catch (error: unknown) {
      const failedAt = requiredInstant(dependencies.now());
      const availableAt = requiredInstant(
        dependencies.retryAt(failedAt, claimed.attempt),
      );
      const code = dependencies.errorCode(error);
      if (!errorCode.test(code)) {
        throw new Error("AUTHORITATIVE_PROJECTOR_ERROR_CODE_INVALID");
      }
      await store.retry({
        commitId: claimed.commit.id,
        leaseToken: claimed.leaseToken,
        attempt: claimed.attempt,
        availableAt,
        errorCode: code,
      });
      return { status: "retry_scheduled", commitId: claimed.commit.id };
    }
    const projectedAt = requiredInstant(dependencies.now());
    await store.projected({
      commitId: claimed.commit.id,
      leaseToken: claimed.leaseToken,
      attempt: claimed.attempt,
      projectedAt,
    });
    return { status: "projected", commitId: claimed.commit.id };
  }
  return {
    runOnce,
    async runBatch(
      workerId: string,
      maximum: number,
    ): Promise<AuthoritativeProjectionBatchResult> {
      if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 100) {
        throw new Error("AUTHORITATIVE_PROJECTOR_BATCH_INVALID");
      }
      let projected = 0;
      let retryScheduled = 0;
      for (let processed = 0; processed < maximum; processed += 1) {
        const result = await runOnce(workerId);
        if (result.status === "idle") {
          return { status: "completed", processed, projected, retryScheduled };
        }
        if (result.status === "projected") projected += 1;
        else retryScheduled += 1;
      }
      return {
        status: "completed",
        processed: maximum,
        projected,
        retryScheduled,
      };
    },
  };
}
