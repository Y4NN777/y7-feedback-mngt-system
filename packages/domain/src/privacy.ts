export type PrivacyRequesterKind = "principal" | "access_proof";
export type PrivacyDeletionState = "soft_deleted" | "restored" | "purged";

interface PrivacyEventBase {
  readonly eventId: string;
  readonly operationId: string;
  readonly feedbackId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorDigest: string;
  readonly occurredAt: string;
  readonly revision: number;
}

export type PrivacyDeletionEvent =
  | (PrivacyEventBase & {
      readonly type: "deletion_requested";
      readonly requesterKind: PrivacyRequesterKind;
      readonly requesterDigest: string;
      readonly reasonCode: string;
      readonly purgeEligibleAt: string;
    })
  | (PrivacyEventBase & { readonly type: "feedback_restored" })
  | (PrivacyEventBase & { readonly type: "feedback_purged" });

export interface PrivacyDeletionRecord {
  readonly feedbackId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly state: PrivacyDeletionState;
  readonly requesterKind: PrivacyRequesterKind;
  readonly requesterDigest: string;
  readonly reasonCode: string;
  readonly requestedAt: string;
  readonly purgeEligibleAt: string;
  readonly revision: number;
  readonly identityErased: true;
  readonly restoredAt?: string;
  readonly purgedAt?: string;
  readonly events: readonly PrivacyDeletionEvent[];
}

export type PrivacyCommand =
  | {
      readonly type: "request_deletion";
      readonly operationId: string;
      readonly feedbackId: string;
      readonly workspaceId: string;
      readonly projectId: string;
      readonly requesterKind: PrivacyRequesterKind;
      readonly requesterDigest: string;
      readonly reasonCode: string;
    }
  | {
      readonly type: "restore_feedback";
      readonly operationId: string;
      readonly expectedRevision: number;
    }
  | {
      readonly type: "purge_feedback";
      readonly operationId: string;
      readonly expectedRevision: number;
    };

export interface PrivacyDependencies {
  readonly createEventId: () => string;
  readonly actorDigest: string;
  readonly now: () => string;
}

export type PrivacyDecision =
  | {
      readonly status: "accepted" | "replayed";
      readonly record: PrivacyDeletionRecord;
      readonly event: PrivacyDeletionEvent;
    }
  | {
      readonly status:
        "invalid" | "conflict" | "too_early" | "expired" | "irreversible";
    };

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const digest = /^[A-Za-z0-9_-]{32,128}$/u;
const reason = /^[a-z][a-z0-9_]{1,63}$/u;
const retentionMs = 30 * 24 * 60 * 60 * 1_000;

function instant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && /(?:Z|[+-]00:00)$/u.test(value)
    ? parsed
    : undefined;
}

function commonValid(
  command: PrivacyCommand,
  dependencies: PrivacyDependencies,
  now: string,
) {
  return (
    id.test(command.operationId) &&
    digest.test(dependencies.actorDigest) &&
    instant(now) !== undefined
  );
}

function sameRequest(
  event: PrivacyDeletionEvent,
  command: Extract<PrivacyCommand, { type: "request_deletion" }>,
) {
  return (
    event.type === "deletion_requested" &&
    event.feedbackId === command.feedbackId &&
    event.workspaceId === command.workspaceId &&
    event.projectId === command.projectId &&
    event.requesterKind === command.requesterKind &&
    event.requesterDigest === command.requesterDigest &&
    event.reasonCode === command.reasonCode
  );
}

function replay(
  record: PrivacyDeletionRecord,
  command: PrivacyCommand,
): PrivacyDecision | undefined {
  const event = record.events.find(
    ({ operationId }) => operationId === command.operationId,
  );
  if (!event) return undefined;
  const matches =
    command.type === "request_deletion"
      ? sameRequest(event, command)
      : command.type === "restore_feedback"
        ? event.type === "feedback_restored" &&
          event.revision === command.expectedRevision + 1
        : event.type === "feedback_purged" &&
          event.revision === command.expectedRevision + 1;
  return matches ? { status: "replayed", record, event } : { status: "conflict" };
}

export function decidePrivacyDeletion(
  record: PrivacyDeletionRecord | undefined,
  command: PrivacyCommand,
  dependencies: PrivacyDependencies,
): PrivacyDecision {
  const now = dependencies.now();
  if (!commonValid(command, dependencies, now)) return { status: "invalid" };
  if (record) {
    const repeated = replay(record, command);
    if (repeated) return repeated;
  }
  const nowMs = instant(now) as number;
  if (command.type === "request_deletion") {
    if (
      record ||
      !id.test(command.feedbackId) ||
      !id.test(command.workspaceId) ||
      !id.test(command.projectId) ||
      !digest.test(command.requesterDigest) ||
      !reason.test(command.reasonCode)
    )
      return record ? { status: "conflict" } : { status: "invalid" };
    const purgeEligibleAt = new Date(nowMs + retentionMs).toISOString();
    const event: PrivacyDeletionEvent = {
      type: "deletion_requested",
      eventId: dependencies.createEventId(),
      operationId: command.operationId,
      feedbackId: command.feedbackId,
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      actorDigest: dependencies.actorDigest,
      occurredAt: now,
      revision: 1,
      requesterKind: command.requesterKind,
      requesterDigest: command.requesterDigest,
      reasonCode: command.reasonCode,
      purgeEligibleAt,
    };
    if (!id.test(event.eventId)) return { status: "invalid" };
    return {
      status: "accepted",
      event,
      record: {
        feedbackId: command.feedbackId,
        workspaceId: command.workspaceId,
        projectId: command.projectId,
        state: "soft_deleted",
        requesterKind: command.requesterKind,
        requesterDigest: command.requesterDigest,
        reasonCode: command.reasonCode,
        requestedAt: now,
        purgeEligibleAt,
        revision: 1,
        identityErased: true,
        events: [event],
      },
    };
  }
  if (!record || command.expectedRevision !== record.revision)
    return { status: "conflict" };
  if (record.state === "purged") return { status: "irreversible" };
  const eligibleMs = instant(record.purgeEligibleAt);
  if (eligibleMs === undefined) return { status: "invalid" };
  if (command.type === "restore_feedback") {
    if (record.state !== "soft_deleted") return { status: "conflict" };
    if (nowMs >= eligibleMs) return { status: "expired" };
    const event: PrivacyDeletionEvent = {
      type: "feedback_restored",
      eventId: dependencies.createEventId(),
      operationId: command.operationId,
      feedbackId: record.feedbackId,
      workspaceId: record.workspaceId,
      projectId: record.projectId,
      actorDigest: dependencies.actorDigest,
      occurredAt: now,
      revision: record.revision + 1,
    };
    if (!id.test(event.eventId)) return { status: "invalid" };
    return {
      status: "accepted",
      event,
      record: {
        ...record,
        state: "restored",
        restoredAt: now,
        revision: event.revision,
        events: [...record.events, event],
      },
    };
  }
  if (record.state !== "soft_deleted") return { status: "conflict" };
  if (nowMs < eligibleMs) return { status: "too_early" };
  const event: PrivacyDeletionEvent = {
    type: "feedback_purged",
    eventId: dependencies.createEventId(),
    operationId: command.operationId,
    feedbackId: record.feedbackId,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    actorDigest: dependencies.actorDigest,
    occurredAt: now,
    revision: record.revision + 1,
  };
  if (!id.test(event.eventId)) return { status: "invalid" };
  return {
    status: "accepted",
    event,
    record: {
      ...record,
      state: "purged",
      purgedAt: now,
      revision: event.revision,
      events: [...record.events, event],
    },
  };
}

export function privacyAllowsMaterialization(
  record: PrivacyDeletionRecord | undefined,
): boolean {
  return record === undefined || record.state === "restored";
}

export function privacyAllowsIdentityMaterialization(
  record: PrivacyDeletionRecord | undefined,
): boolean {
  return record === undefined;
}
