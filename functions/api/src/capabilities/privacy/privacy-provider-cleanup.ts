export interface PrivacyProviderCleanupCandidate {
  readonly linkId: string;
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly provider: "github" | "gitlab";
  readonly repositoryId: string;
  readonly issueUrl: string;
}

export interface PrivacyProviderCleanupStore {
  listPending(limit: number): Promise<readonly PrivacyProviderCleanupCandidate[]>;
  markCompleted(linkId: string, completedAt: string): Promise<void>;
}

export interface PrivacyProviderIssueCloser {
  close(candidate: PrivacyProviderCleanupCandidate): Promise<void>;
}

export interface PrivacyProviderCleanupReport {
  readonly inspected: number;
  readonly completed: number;
  readonly failed: number;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function createPrivacyProviderCleanup(
  store: PrivacyProviderCleanupStore,
  closer: PrivacyProviderIssueCloser,
  options: { readonly limit: number; readonly now: () => string },
) {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100)
    throw new Error("PRIVACY_PROVIDER_CLEANUP_CONFIGURATION_INVALID");
  return {
    async runOnce(): Promise<PrivacyProviderCleanupReport> {
      const candidates = await store.listPending(options.limit);
      const report = { inspected: candidates.length, completed: 0, failed: 0 };
      for (const candidate of candidates) {
        if (
          !identifier.test(candidate.linkId) ||
          !identifier.test(candidate.connectionId) ||
          !identifier.test(candidate.workspaceId) ||
          !identifier.test(candidate.projectId) ||
          !identifier.test(candidate.repositoryId)
        ) {
          report.failed += 1;
          continue;
        }
        try {
          await closer.close(candidate);
          await store.markCompleted(candidate.linkId, options.now());
          report.completed += 1;
        } catch {
          report.failed += 1;
        }
      }
      return report;
    },
  };
}
