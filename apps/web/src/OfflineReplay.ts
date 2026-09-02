import type { OfflineOperation, OfflineScope } from "./OfflineStore";

export interface OfflineReplayStore {
  recoverOperations(
    scope: OfflineScope,
    staleBefore: string,
  ): Promise<{ readonly recovered: number }>;
  listOperations(scope: OfflineScope): Promise<readonly OfflineOperation[]>;
  claimOperation(scope: OfflineScope, id: string): Promise<OfflineOperation>;
  completeOperation(scope: OfflineScope, id: string): Promise<void>;
  retryOperation(
    scope: OfflineScope,
    id: string,
    nextAttemptAt: string,
    lastErrorCode: string,
  ): Promise<void>;
  conflictOperation(scope: OfflineScope, id: string): Promise<void>;
}

export type OfflineSendOutcome =
  | { readonly status: "accepted" }
  | { readonly status: "retryable"; readonly retryAfterMs?: number }
  | { readonly status: "conflict" };

const maximumRetryMs = 5 * 60 * 1_000;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export function createHttpConnectivityProbe(
  value: string,
  fetcher: Fetcher = globalThis.fetch,
) {
  const endpoint = new URL(value.endsWith("/") ? value : `${value}/`);
  const local =
    endpoint.protocol === "http:" &&
    (endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1");
  if (
    (endpoint.protocol !== "https:" && !local) ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error("OFFLINE_PROBE_ENDPOINT_INVALID");
  return async () => {
    try {
      const response = await fetcher(new URL("health", endpoint).toString(), {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      return response.status === 200;
    } catch {
      return false;
    }
  };
}

export function parseRetryAfter(value: string | null, now: Date): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(maximumRetryMs, Math.ceil(seconds * 1_000));
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  const delay = instant - now.getTime();
  return delay > 0 ? Math.min(maximumRetryMs, delay) : null;
}

function retryDelay(attempt: number, requested?: number): number {
  if (requested !== undefined && Number.isFinite(requested) && requested > 0) {
    return Math.min(maximumRetryMs, Math.ceil(requested));
  }
  return Math.min(maximumRetryMs, 2 ** Math.min(attempt - 1, 20) * 1_000);
}

export function createOfflineReplay(input: {
  readonly store: OfflineReplayStore;
  readonly probe: () => Promise<boolean>;
  readonly send: (operation: OfflineOperation) => Promise<OfflineSendOutcome>;
  readonly now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  return {
    async runOnce(scope: OfflineScope) {
      const current = now();
      await input.store.recoverOperations(
        scope,
        new Date(current.getTime() - 30_000).toISOString(),
      );
      const operations = await input.store.listOperations(scope);
      const terminal = operations.find(({ status }) => status === "conflict");
      if (terminal)
        return {
          status: "conflict" as const,
          operationId: terminal.clientOperationId,
        };
      if (operations.length === 0) return { status: "idle" as const };
      const pendingIds = new Set(
        operations.map(({ clientOperationId }) => clientOperationId),
      );
      const candidate = operations.find(
        (operation) =>
          operation.status === "queued" &&
          (operation.nextAttemptAt === undefined ||
            Date.parse(operation.nextAttemptAt) <= current.getTime()) &&
          operation.dependencies.every((dependency) => !pendingIds.has(dependency)),
      );
      if (!candidate) {
        const nextAttemptAt = operations
          .flatMap(({ nextAttemptAt }) =>
            nextAttemptAt === undefined ? [] : [nextAttemptAt],
          )
          .sort()[0];
        return nextAttemptAt
          ? { status: "waiting" as const, nextAttemptAt }
          : { status: "dependency_blocked" as const };
      }
      if (!(await input.probe())) return { status: "offline" as const };
      const claimed = await input.store.claimOperation(
        scope,
        candidate.clientOperationId,
      );
      let outcome: OfflineSendOutcome;
      try {
        outcome = await input.send(claimed);
      } catch {
        outcome = { status: "retryable" };
      }
      if (outcome.status === "accepted") {
        await input.store.completeOperation(scope, claimed.clientOperationId);
        return {
          status: "synchronized" as const,
          operationId: claimed.clientOperationId,
        };
      }
      if (outcome.status === "conflict") {
        await input.store.conflictOperation(scope, claimed.clientOperationId);
        return {
          status: "conflict" as const,
          operationId: claimed.clientOperationId,
        };
      }
      const nextAttemptAt = new Date(
        current.getTime() + retryDelay(claimed.attempts, outcome.retryAfterMs),
      ).toISOString();
      await input.store.retryOperation(
        scope,
        claimed.clientOperationId,
        nextAttemptAt,
        "transport_retryable",
      );
      return {
        status: "retry_scheduled" as const,
        operationId: claimed.clientOperationId,
        nextAttemptAt,
      };
    },
  };
}
