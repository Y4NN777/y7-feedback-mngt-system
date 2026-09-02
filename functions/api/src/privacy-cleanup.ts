export interface PrivacyPurgeCandidate {
  readonly deletionId: string;
  readonly feedbackId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly purgeEligibleAt: string;
}

export interface PrivacyPurgeRepository {
  claimDue(input: {
    readonly now: string;
    readonly limit: number;
    readonly workerId: string;
  }): Promise<readonly PrivacyPurgeCandidate[]>;
  markPurged(input: {
    readonly deletionId: string;
    readonly expectedRevision: number;
    readonly operationId: string;
    readonly purgedAt: string;
  }): Promise<"purged" | "replayed" | "stale">;
}

export interface PrivacyCleanupPort {
  cleanup(candidate: PrivacyPurgeCandidate): Promise<void>;
}

export interface PrivacyPurgeDependencies {
  readonly createOperationId: (deletionId: string) => string;
  readonly now: () => string;
  readonly workerId: string;
  readonly batchSize: number;
}

export interface PrivacyPurgeReport {
  readonly claimed: number;
  readonly purged: number;
  readonly replayed: number;
  readonly stale: number;
  readonly failed: number;
}

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function createPrivacyPurgeWorker(
  repository: PrivacyPurgeRepository,
  cleanupPorts: readonly PrivacyCleanupPort[],
  dependencies: PrivacyPurgeDependencies,
) {
  if (
    !id.test(dependencies.workerId) ||
    !Number.isSafeInteger(dependencies.batchSize) ||
    dependencies.batchSize < 1 ||
    dependencies.batchSize > 100 ||
    cleanupPorts.length === 0
  )
    throw new Error("PRIVACY_PURGE_CONFIGURATION_INVALID");
  return {
    async runOnce(): Promise<PrivacyPurgeReport> {
      const now = dependencies.now();
      const candidates = await repository.claimDue({
        now,
        limit: dependencies.batchSize,
        workerId: dependencies.workerId,
      });
      const report = {
        claimed: candidates.length,
        purged: 0,
        replayed: 0,
        stale: 0,
        failed: 0,
      };
      for (const candidate of candidates) {
        try {
          for (const port of cleanupPorts) await port.cleanup(candidate);
          const outcome = await repository.markPurged({
            deletionId: candidate.deletionId,
            expectedRevision: candidate.revision,
            operationId: dependencies.createOperationId(candidate.deletionId),
            purgedAt: now,
          });
          report[outcome] += 1;
        } catch {
          report.failed += 1;
        }
      }
      return report;
    },
  };
}
