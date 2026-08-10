import {
  issueAccessGrant,
  type AccessGrant,
  type ReporterAttribution,
  type ValidatedContext,
  type ValidatedFeedbackDraft,
  type FeedbackSource,
  type FeedbackType,
} from "@y7-feedback/domain";

export interface AcceptedFeedbackRecord {
  readonly id: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly reporterId: string;
  readonly type: FeedbackType;
  readonly originalSource: FeedbackSource;
  readonly context: readonly ValidatedContext[];
  readonly attachmentNames: readonly string[];
  readonly state: "received";
  readonly acceptedAt: string;
}

export interface AcceptedReporterRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly attribution: ReporterAttribution;
}

export interface InitialLifecycleRecord {
  readonly id: string;
  readonly feedbackId: string;
  readonly priorState: null;
  readonly state: "received";
  readonly actor: "system:intake";
  readonly occurredAt: string;
  readonly sequence: 1;
}

export interface AcceptanceNotification {
  readonly id: string;
  readonly feedbackId: string;
  readonly reporterId: string;
  readonly kind: "feedback_accepted";
  readonly reference: string;
  readonly createdAt: string;
}

export interface AcceptanceOutboxRecord {
  readonly id: string;
  readonly notificationId: string;
  readonly channel: "email" | "in_product";
  readonly status: "pending";
  readonly createdAt: string;
  readonly payload: {
    readonly kind: "feedback_accepted";
    readonly reference: string;
    readonly locale: "fr" | "en";
  };
}

export interface IdempotencyRecord {
  readonly scopeKey: string;
  readonly clientOperationId: string;
  readonly payloadDigest: string;
  readonly feedbackId: string;
  readonly reference: string;
  readonly protectedProof: string;
  readonly proofVerifier: string;
  readonly createdAt: string;
}

export interface AcceptanceCommit {
  readonly feedback: AcceptedFeedbackRecord;
  readonly reporter: AcceptedReporterRecord;
  readonly lifecycle: InitialLifecycleRecord;
  readonly accessGrant: AccessGrant;
  readonly notification: AcceptanceNotification;
  readonly outbox: AcceptanceOutboxRecord;
  readonly idempotency: IdempotencyRecord;
}

export interface IntakeStore {
  findIdempotency(
    scopeKey: string,
    clientOperationId: string,
  ): Promise<IdempotencyRecord | null>;
  commit(input: AcceptanceCommit): Promise<void>;
}

export interface IntakeDependencies {
  readonly createFeedbackId: () => string;
  readonly createReporterId: () => string;
  readonly createHistoryId: () => string;
  readonly createNotificationId: () => string;
  readonly createOutboxId: () => string;
  readonly createReference: () => string;
  readonly createProof: () => string;
  readonly hashProof: (proof: string) => string;
  readonly sealProof: (proof: string) => string;
  readonly openProof: (protectedProof: string) => string;
  readonly digestPayload: (draft: ValidatedFeedbackDraft) => string;
  readonly now: () => string;
}

export interface IntakeCommand {
  readonly clientOperationId: string;
  readonly draft: ValidatedFeedbackDraft;
  readonly locale?: "fr" | "en";
}

export type IntakeOutcome =
  | {
      readonly status: "accepted";
      readonly feedbackId: string;
      readonly reference: string;
      readonly accessProof: string;
      readonly replayed: boolean;
    }
  | {
      readonly status: "rejected";
      readonly code: "INTAKE_INVALID" | "OPERATION_CONFLICT";
    }
  | { readonly status: "retryable"; readonly code: "INTAKE_UNAVAILABLE" };

export interface IntakeCoordinator {
  accept(command: IntakeCommand): Promise<IntakeOutcome>;
}

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function retryable(): IntakeOutcome {
  return { status: "retryable", code: "INTAKE_UNAVAILABLE" };
}

function accepted(
  record: Pick<IdempotencyRecord, "feedbackId" | "reference">,
  accessProof: string,
  replayed: boolean,
): IntakeOutcome {
  return {
    status: "accepted",
    feedbackId: record.feedbackId,
    reference: record.reference,
    accessProof,
    replayed,
  };
}

function required(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 1_000) throw new Error("invalid dependency");
  return normalized;
}

export function createIntakeCoordinator(
  store: IntakeStore,
  dependencies: IntakeDependencies,
): IntakeCoordinator {
  return {
    async accept(command) {
      if (!operationIdPattern.test(command.clientOperationId)) {
        return { status: "rejected", code: "INTAKE_INVALID" };
      }

      const scopeKey = `${command.draft.workspaceId}:${command.draft.projectId}`;
      let payloadDigest: string;
      let existing: IdempotencyRecord | null;
      try {
        payloadDigest = required(dependencies.digestPayload(command.draft));
        existing = await store.findIdempotency(scopeKey, command.clientOperationId);
      } catch {
        return retryable();
      }

      if (existing) {
        if (existing.payloadDigest !== payloadDigest) {
          return { status: "rejected", code: "OPERATION_CONFLICT" };
        }
        try {
          const proof = dependencies.openProof(existing.protectedProof);
          if (
            proof.length < 43 ||
            dependencies.hashProof(proof) !== existing.proofVerifier
          ) {
            return retryable();
          }
          return accepted(existing, proof, true);
        } catch {
          return retryable();
        }
      }

      try {
        const acceptedAt = required(dependencies.now());
        const feedbackId = required(dependencies.createFeedbackId());
        const reporterId = required(dependencies.createReporterId());
        const reference = required(dependencies.createReference());
        const issued = issueAccessGrant(
          { feedbackId, reference },
          {
            createProof: dependencies.createProof,
            hashProof: dependencies.hashProof,
          },
        );
        const protectedProof = required(dependencies.sealProof(issued.proof));
        if (protectedProof === issued.proof) return retryable();
        const notificationId = required(dependencies.createNotificationId());
        const commit: AcceptanceCommit = {
          feedback: {
            id: feedbackId,
            projectId: command.draft.projectId,
            workspaceId: command.draft.workspaceId,
            reporterId,
            type: command.draft.type,
            originalSource: command.draft.originalSource,
            context: [...command.draft.context],
            attachmentNames: [...command.draft.attachmentNames],
            state: "received",
            acceptedAt,
          },
          reporter: {
            id: reporterId,
            workspaceId: command.draft.workspaceId,
            attribution: command.draft.reporter,
          },
          lifecycle: {
            id: required(dependencies.createHistoryId()),
            feedbackId,
            priorState: null,
            state: "received",
            actor: "system:intake",
            occurredAt: acceptedAt,
            sequence: 1,
          },
          accessGrant: issued.grant,
          notification: {
            id: notificationId,
            feedbackId,
            reporterId,
            kind: "feedback_accepted",
            reference,
            createdAt: acceptedAt,
          },
          outbox: {
            id: required(dependencies.createOutboxId()),
            notificationId,
            channel: command.draft.reporter.kind === "contact" ? "email" : "in_product",
            status: "pending",
            createdAt: acceptedAt,
            payload: {
              kind: "feedback_accepted",
              reference,
              locale: command.locale ?? "fr",
            },
          },
          idempotency: {
            scopeKey,
            clientOperationId: command.clientOperationId,
            payloadDigest,
            feedbackId,
            reference,
            protectedProof,
            proofVerifier: issued.grant.verifier,
            createdAt: acceptedAt,
          },
        };
        await store.commit(commit);
        return accepted(commit.idempotency, issued.proof, false);
      } catch {
        return retryable();
      }
    },
  };
}
