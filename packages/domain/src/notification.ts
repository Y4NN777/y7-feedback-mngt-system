export type NotificationEventKind =
  | "feedback_received"
  | "clarification_requested"
  | "reporter_answered"
  | "message_added"
  | "feedback_under_review"
  | "feedback_resolved"
  | "feedback_closed"
  | "feedback_reopened"
  | "assignment_changed";

export type NotificationRecipient =
  | { readonly kind: "reporter"; readonly id: string }
  | { readonly kind: "workspace"; readonly id: string };

export interface NotificationFact {
  readonly eventId: string;
  readonly feedbackId: string;
  readonly reference: string;
  readonly kind: NotificationEventKind;
  readonly occurredAt: string;
  readonly locale: "fr" | "en";
  readonly audience: "reporter" | "workspace" | "both";
}

export interface NotificationRecipientState {
  readonly reporterId: string;
  readonly workspaceOwnerIds: readonly string[];
  readonly assignedMaintainerIds: readonly string[];
  readonly removedMaintainerIds: readonly string[];
  readonly emailRecipientIds: readonly string[];
}

export interface NotificationActor {
  readonly kind: "reporter" | "workspace" | "system";
  readonly id: string;
}

export interface PlannedNotification {
  readonly notificationKey: string;
  readonly fact: NotificationFact;
  readonly recipient: NotificationRecipient;
  readonly channels: readonly ("in_product" | "email")[];
}

export class NotificationPolicyError extends Error {
  readonly code: "ERR-NOTIFICATION-INVALID";

  constructor() {
    super("ERR-NOTIFICATION-INVALID");
    this.name = "NotificationPolicyError";
    this.code = "ERR-NOTIFICATION-INVALID";
  }
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const reference = /^Y7-[A-Z0-9][A-Z0-9-]{6,78}[A-Z0-9]$/u;
const kinds = new Set<NotificationEventKind>([
  "feedback_received",
  "clarification_requested",
  "reporter_answered",
  "message_added",
  "feedback_under_review",
  "feedback_resolved",
  "feedback_closed",
  "feedback_reopened",
  "assignment_changed",
]);

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validInstant(value: string): boolean {
  return (
    /(?:Z|[+]00:00)$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function uniqueIdentifiers(values: readonly string[]): readonly string[] {
  if (values.some((value) => !identifier.test(value))) {
    throw new NotificationPolicyError();
  }
  return [...new Set(values)].sort();
}

function notificationKey(eventId: string, recipient: NotificationRecipient): string {
  return `${eventId}:${recipient.kind}:${recipient.id}`;
}

export function planNotifications(input: {
  readonly fact: unknown;
  readonly actor: NotificationActor;
  readonly recipients: NotificationRecipientState;
}): readonly PlannedNotification[] {
  const { actor, recipients } = input;
  if (
    !object(input.fact) ||
    typeof input.fact.eventId !== "string" ||
    !identifier.test(input.fact.eventId) ||
    typeof input.fact.feedbackId !== "string" ||
    !identifier.test(input.fact.feedbackId) ||
    typeof input.fact.reference !== "string" ||
    !reference.test(input.fact.reference) ||
    !kinds.has(input.fact.kind as NotificationEventKind) ||
    typeof input.fact.occurredAt !== "string" ||
    !validInstant(input.fact.occurredAt) ||
    (input.fact.locale !== "fr" && input.fact.locale !== "en") ||
    (input.fact.audience !== "reporter" &&
      input.fact.audience !== "workspace" &&
      input.fact.audience !== "both") ||
    !identifier.test(actor.id) ||
    !identifier.test(recipients.reporterId)
  ) {
    throw new NotificationPolicyError();
  }
  const fact = input.fact as unknown as NotificationFact;

  const owners = uniqueIdentifiers(recipients.workspaceOwnerIds);
  const assigned = uniqueIdentifiers(recipients.assignedMaintainerIds);
  const removed = new Set(uniqueIdentifiers(recipients.removedMaintainerIds));
  const email = new Set(uniqueIdentifiers(recipients.emailRecipientIds));
  const result: PlannedNotification[] = [];

  if (
    (fact.audience === "reporter" || fact.audience === "both") &&
    !(actor.kind === "reporter" && actor.id === recipients.reporterId)
  ) {
    const recipient = { kind: "reporter", id: recipients.reporterId } as const;
    result.push({
      notificationKey: notificationKey(fact.eventId, recipient),
      fact,
      recipient,
      channels: email.has(recipient.id) ? ["in_product", "email"] : ["in_product"],
    });
  }

  if (fact.audience === "workspace" || fact.audience === "both") {
    const workspaceRecipients = [...new Set([...owners, ...assigned])]
      .filter((id) => !removed.has(id))
      .filter((id) => !(actor.kind === "workspace" && actor.id === id))
      .sort();
    for (const id of workspaceRecipients) {
      const recipient = { kind: "workspace", id } as const;
      result.push({
        notificationKey: notificationKey(fact.eventId, recipient),
        fact,
        recipient,
        channels: email.has(id) ? ["in_product", "email"] : ["in_product"],
      });
    }
  }

  return result;
}
