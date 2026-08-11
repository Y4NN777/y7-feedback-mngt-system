import { validateFeedbackSource, type FeedbackSource } from "./feedback";

export type FeedbackLifecycleState =
  "received" | "under_review" | "awaiting_reporter" | "resolved" | "closed";

export interface AccessGrant {
  readonly feedbackId: string;
  readonly reference: string;
  readonly verifier: string;
  readonly generation: number;
  readonly status: "active" | "revoked";
}

export interface IssuedAccessGrant {
  readonly grant: AccessGrant;
  readonly proof: string;
}

export interface AccessGrantDependencies {
  readonly createProof: () => string;
  readonly hashProof: (proof: string) => string;
}

export interface AccessRequest {
  readonly reference: string;
  readonly proof?: string;
}

export interface ReporterHistoryEntry {
  readonly id: string;
  readonly kind: string;
  readonly audience: "reporter" | "workspace";
  readonly actor: string;
  readonly occurredAt: string;
  readonly detail: string;
}

export interface ReporterMessage {
  readonly id: string;
  readonly audience: "reporter" | "workspace";
  readonly actor: string;
  readonly occurredAt: string;
  readonly content: string;
}

export interface ReporterAttachment {
  readonly id: string;
  readonly audience: "reporter" | "workspace";
  readonly name: string;
}

export interface SourceRevision {
  readonly id: string;
  readonly priorSource: FeedbackSource;
  readonly source: FeedbackSource;
  readonly actor: string;
  readonly occurredAt: string;
}

export interface DeletionRequest {
  readonly id: string;
  readonly status: "received";
  readonly reason: string;
  readonly actor: string;
  readonly occurredAt: string;
}

export interface ReporterFeedbackRecord {
  readonly feedbackId: string;
  readonly reference: string;
  readonly originalSource: FeedbackSource;
  readonly currentSource: FeedbackSource;
  readonly currentState: FeedbackLifecycleState;
  readonly history: readonly ReporterHistoryEntry[];
  readonly messages: readonly ReporterMessage[];
  readonly attachments: readonly ReporterAttachment[];
  readonly sourceRevisions: readonly SourceRevision[];
  readonly deletionRequests: readonly DeletionRequest[];
  readonly internalNotes: readonly string[];
  readonly workspaceClassification: string | null;
}

export type ReporterFeedbackView = Omit<
  ReporterFeedbackRecord,
  "internalNotes" | "workspaceClassification"
>;

export type ReporterAction =
  | {
      readonly kind: "clarify";
      readonly content: string;
      readonly actor: string;
      readonly occurredAt: string;
      readonly eventId: string;
    }
  | {
      readonly kind: "revise_source";
      readonly source: FeedbackSource;
      readonly actor: string;
      readonly occurredAt: string;
      readonly eventId: string;
    }
  | {
      readonly kind: "request_deletion";
      readonly reason: string;
      readonly actor: string;
      readonly occurredAt: string;
      readonly eventId: string;
    };

export class AccessPolicyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AccessPolicyError";
    this.code = code;
  }
}

function required(value: string, maximum: number, code: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new AccessPolicyError(code);
  }
  return normalized;
}

function issue(
  input: { readonly feedbackId: string; readonly reference: string },
  dependencies: AccessGrantDependencies,
  generation: number,
): IssuedAccessGrant {
  const feedbackId = required(input.feedbackId, 200, "ACCESS_CONFIGURATION_INVALID");
  const reference = required(input.reference, 100, "ACCESS_CONFIGURATION_INVALID");
  const proof = dependencies.createProof();
  const verifier = dependencies.hashProof(proof);
  if (
    proof.length < 43 ||
    proof.length > 512 ||
    !verifier.trim() ||
    verifier === proof ||
    verifier.length > 1_000
  ) {
    throw new AccessPolicyError("ACCESS_CONFIGURATION_INVALID");
  }
  return {
    proof,
    grant: { feedbackId, reference, verifier, generation, status: "active" },
  };
}

export function issueAccessGrant(
  input: { readonly feedbackId: string; readonly reference: string },
  dependencies: AccessGrantDependencies,
): IssuedAccessGrant {
  return issue(input, dependencies, 1);
}

export function rotateAccessGrant(
  grant: AccessGrant,
  dependencies: AccessGrantDependencies,
): IssuedAccessGrant {
  if (grant.status !== "active") {
    throw new AccessPolicyError("ACCESS_DENIED");
  }
  return issue(grant, dependencies, grant.generation + 1);
}

export function revokeAccessGrant(grant: AccessGrant): AccessGrant {
  return { ...grant, status: "revoked" };
}

export function authorizeAccess(
  grant: AccessGrant | undefined,
  request: AccessRequest,
  matchesProof: (proof: string, verifier: string) => boolean,
): string {
  let matches = false;
  if (
    grant &&
    grant.status === "active" &&
    request.reference === grant.reference &&
    request.proof
  ) {
    try {
      matches = matchesProof(request.proof, grant.verifier);
    } catch {
      matches = false;
    }
  }
  if (!matches || !grant) {
    throw new AccessPolicyError("ACCESS_DENIED");
  }
  return grant.feedbackId;
}

export function projectReporterFeedback(
  record: ReporterFeedbackRecord,
  authorizedFeedbackId: string,
): ReporterFeedbackView {
  if (record.feedbackId !== authorizedFeedbackId) {
    throw new AccessPolicyError("ACCESS_DENIED");
  }
  return {
    feedbackId: record.feedbackId,
    reference: record.reference,
    originalSource: record.originalSource,
    currentSource: record.currentSource,
    currentState: record.currentState,
    history: record.history.filter((item) => item.audience === "reporter"),
    messages: record.messages.filter((item) => item.audience === "reporter"),
    attachments: record.attachments.filter((item) => item.audience === "reporter"),
    sourceRevisions: [...record.sourceRevisions],
    deletionRequests: [...record.deletionRequests],
  };
}

function validateAction(action: ReporterAction) {
  const eventId = required(action.eventId, 200, "REPORTER_ACTION_INVALID");
  const actor = required(action.actor, 200, "REPORTER_ACTION_INVALID");
  const occurredAt = required(action.occurredAt, 40, "REPORTER_ACTION_INVALID");
  if (!occurredAt.endsWith("Z") || Number.isNaN(Date.parse(occurredAt))) {
    throw new AccessPolicyError("REPORTER_ACTION_INVALID");
  }
  return { eventId, actor, occurredAt };
}

export function applyReporterAction(
  record: ReporterFeedbackRecord,
  authorizedFeedbackId: string,
  action: ReporterAction,
): ReporterFeedbackRecord {
  if (record.feedbackId !== authorizedFeedbackId) {
    throw new AccessPolicyError("ACCESS_DENIED");
  }
  const common = validateAction(action);
  if (action.kind === "clarify") {
    const content = required(action.content, 5_000, "REPORTER_ACTION_INVALID");
    return {
      ...record,
      messages: [
        ...record.messages,
        {
          id: common.eventId,
          audience: "reporter",
          actor: common.actor,
          occurredAt: common.occurredAt,
          content,
        },
      ],
    };
  }
  if (action.kind === "revise_source") {
    const source = validateFeedbackSource(action.source);
    if (source.type !== record.currentSource.type) {
      throw new AccessPolicyError("REPORTER_ACTION_INVALID");
    }
    return {
      ...record,
      currentSource: source,
      sourceRevisions: [
        ...record.sourceRevisions,
        {
          id: common.eventId,
          priorSource: record.currentSource,
          source,
          actor: common.actor,
          occurredAt: common.occurredAt,
        },
      ],
    };
  }
  const reason = required(action.reason, 1_000, "REPORTER_ACTION_INVALID");
  return {
    ...record,
    deletionRequests: [
      ...record.deletionRequests,
      {
        id: common.eventId,
        status: "received",
        reason,
        actor: common.actor,
        occurredAt: common.occurredAt,
      },
    ],
  };
}
