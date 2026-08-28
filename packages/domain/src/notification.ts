export type NotificationEventKind =
  | "feedback_received"
  | "conversation_message"
  | "internal_note"
  | "lifecycle_changed"
  | "assignment_changed";

export type NotificationRecipientKind =
  "reporter" | "workspace_owner" | "assigned_maintainer";

export type NotificationChannel = "email" | "in_product";

export interface NotificationParticipants {
  readonly reporterId: string;
  readonly ownerId: string;
  readonly assignedMaintainerId?: string;
}

export interface NotificationSourceFact {
  readonly eventId: string;
  readonly kind: NotificationEventKind;
  readonly actorId: string;
  readonly actorKind: "reporter" | "workspace";
  readonly feedbackId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly occurredAt: string;
  readonly visibility: "public" | "workspace";
}

export interface NotificationRecipient {
  readonly principalId: string;
  readonly kind: NotificationRecipientKind;
  readonly channels: readonly NotificationChannel[];
}

export class NotificationPolicyError extends Error {
  readonly code:
    "ERR-NOTIFICATION-FACT-INVALID" | "ERR-NOTIFICATION-VISIBILITY-INVALID";

  constructor(code: NotificationPolicyError["code"]) {
    super(code);
    this.name = "NotificationPolicyError";
    this.code = code;
  }
}

function required(value: string, maximum = 128): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new NotificationPolicyError("ERR-NOTIFICATION-FACT-INVALID");
  }
  return normalized;
}

function validateInstant(value: string): string {
  const normalized = required(value, 40);
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) {
    throw new NotificationPolicyError("ERR-NOTIFICATION-FACT-INVALID");
  }
  return normalized;
}

function workspaceRecipients(
  participants: NotificationParticipants,
): readonly NotificationRecipient[] {
  const recipients: NotificationRecipient[] = [
    {
      principalId: required(participants.ownerId),
      kind: "workspace_owner",
      channels: ["in_product", "email"],
    },
  ];
  if (participants.assignedMaintainerId !== undefined) {
    const principalId = required(participants.assignedMaintainerId);
    if (principalId !== participants.ownerId) {
      recipients.push({
        principalId,
        kind: "assigned_maintainer",
        channels: ["in_product", "email"],
      });
    }
  }
  return recipients;
}

/**
 * Plans recipients from the current authoritative assignment only. The source
 * fact remains unchanged when downstream delivery fails or is retried.
 */
export function planNotificationRecipients(
  fact: NotificationSourceFact,
  participants: NotificationParticipants,
): readonly NotificationRecipient[] {
  required(fact.eventId);
  required(fact.actorId);
  required(fact.feedbackId);
  required(fact.workspaceId);
  required(fact.projectId);
  validateInstant(fact.occurredAt);
  const reporterId = required(participants.reporterId);

  if (fact.kind === "internal_note" && fact.visibility !== "workspace") {
    throw new NotificationPolicyError("ERR-NOTIFICATION-VISIBILITY-INVALID");
  }
  if (fact.kind !== "internal_note" && fact.visibility !== "public") {
    throw new NotificationPolicyError("ERR-NOTIFICATION-VISIBILITY-INVALID");
  }

  const candidates =
    fact.visibility === "workspace"
      ? workspaceRecipients(participants)
      : [
          {
            principalId: reporterId,
            kind: "reporter" as const,
            channels: ["email"] as const,
          },
          ...workspaceRecipients(participants),
        ];

  return candidates.filter((recipient) => recipient.principalId !== fact.actorId);
}
