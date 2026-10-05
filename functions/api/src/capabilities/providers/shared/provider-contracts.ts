import type { SourceProvider } from "@y7-feedback/domain";

import type { ProviderMessageObservation } from "./provider-message-event.js";
import type { ProviderWebhookCredential } from "./provider-webhook-auth.js";

export interface ProviderConsentCleanup {
  request(input: {
    readonly feedbackId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly consentOperationId: string;
    readonly occurredAt: string;
  }): Promise<{ readonly queued: number; readonly guarantee: "best_effort" }>;
}

export interface ProviderMessageReconciliationCandidate {
  readonly observation: ProviderMessageObservation;
}

export interface ProviderMessageReconciliationReader {
  list(): Promise<readonly ProviderMessageReconciliationCandidate[]>;
}

export interface ProviderWebhookCredentialWriter {
  readonly save: (input: {
    readonly provider: SourceProvider;
    readonly encryptedGrantRef: string;
    readonly credential: ProviderWebhookCredential;
  }) => Promise<void>;
}
