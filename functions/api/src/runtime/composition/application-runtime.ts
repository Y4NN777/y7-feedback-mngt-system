import { createHash } from "node:crypto";

import type { Storage, TablesDB, Users } from "node-appwrite";

import type { OutboxSafeEvent } from "../../outbox.js";
import type { AppwritePrincipalVerifier } from "../../capabilities/platform-access/access-contracts.js";

export interface ApplicationRuntime {
  readonly tables: TablesDB;
  readonly storage: Storage;
  readonly users?: Users;
  readonly createId: () => string;
  readonly createReference: () => string;
  readonly createCorrelationId: () => string;
  readonly nowIso: () => string;
  readonly nowMs: () => number;
  readonly startedAt: () => number;
  readonly createProviderNonce?: () => string;
  readonly digestProviderNonce?: (nonce: string) => string;
  readonly providerDiagnostic?: (event: {
    readonly provider: "github";
    readonly stage:
      "token_exchange" | "installations" | "repositories" | "metadata" | "releases";
    readonly status: number;
  }) => void;
  readonly principalVerifier?: AppwritePrincipalVerifier;
  readonly notificationDiagnostic?: (event: OutboxSafeEvent) => void;
  readonly conversationLifecycleDiagnostic?: (event: {
    readonly phase:
      | "transaction_create"
      | "initial_reads"
      | "transactional_writes"
      | "transaction_commit";
    readonly outcome: "succeeded" | "failed";
    readonly durationMs: number;
  }) => void;
}

export function digestExternalIssueCommand(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

export function createProtectedFeedbackUrl(
  webOrigin: string,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
  },
): string {
  const query = new URLSearchParams(input);
  return `${webOrigin}/workbench?${query.toString()}`;
}

export function deriveReporterActorId(reference: string): string {
  return `reporter_${createHash("sha256").update(reference).digest("hex").slice(0, 27)}`;
}
