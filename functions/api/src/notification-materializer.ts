import {
  planNotificationRecipients,
  type NotificationParticipants,
  type NotificationRecipientKind,
  type NotificationSourceFact,
} from "@y7-feedback/domain";

export interface MaterializedNotification {
  readonly id: string;
  readonly eventId: string;
  readonly feedbackId: string;
  readonly reporterId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly recipientId: string;
  readonly recipientKind: NotificationRecipientKind;
  readonly kind: NotificationSourceFact["kind"];
  readonly reference: string;
  readonly createdAt: string;
  readonly readAt: null;
}

export interface MaterializedNotificationDelivery {
  readonly id: string;
  readonly notificationId: string;
  readonly channel: "email" | "in_product";
  readonly status: "pending";
  readonly createdAt: string;
  readonly payload:
    | { readonly kind: "in_product_invalidation" }
    | {
        readonly kind: "notification_event";
        readonly event:
          "conversation_message" | "lifecycle_changed" | "assignment_changed";
        readonly locale: "fr" | "en";
        readonly reference: string;
      };
}

export interface NotificationMaterializationCommit {
  readonly notification: MaterializedNotification;
  readonly deliveries: readonly MaterializedNotificationDelivery[];
}

export interface NotificationMaterializationStore {
  hasEventRecipient(eventId: string, recipientId: string): Promise<boolean>;
  commit(input: NotificationMaterializationCommit): Promise<void>;
}

export interface NotificationMaterializerDependencies {
  readonly createNotificationId: () => string;
  readonly createDeliveryId: () => string;
  readonly localeFor: (recipientId: string) => "fr" | "en";
}

export interface NotificationMaterializationCommand {
  readonly fact: NotificationSourceFact;
  readonly participants: NotificationParticipants;
  readonly reference: string;
}

export type NotificationMaterializationResult =
  | { readonly status: "materialized"; readonly count: number }
  | { readonly status: "retryable" };

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const reference = /^Y7-[A-Z0-9][A-Z0-9-]{6,78}[A-Z0-9]$/u;

function id(value: string): string {
  if (!identifier.test(value)) throw new Error("NOTIFICATION_ID_INVALID");
  return value;
}

export function createNotificationMaterializer(
  store: NotificationMaterializationStore,
  dependencies: NotificationMaterializerDependencies,
): {
  readonly reconcile: (
    command: NotificationMaterializationCommand,
  ) => Promise<NotificationMaterializationResult>;
} {
  return {
    async reconcile(command) {
      if (
        !reference.test(command.reference) ||
        [
          command.fact.eventId,
          command.fact.actorId,
          command.fact.feedbackId,
          command.fact.workspaceId,
          command.fact.projectId,
        ].some((value) => !identifier.test(value))
      ) {
        return { status: "retryable" };
      }
      let recipients;
      try {
        recipients = planNotificationRecipients(command.fact, command.participants);
      } catch {
        return { status: "retryable" };
      }
      let count = 0;
      for (const recipient of recipients) {
        try {
          id(recipient.principalId);
          if (
            await store.hasEventRecipient(command.fact.eventId, recipient.principalId)
          ) {
            continue;
          }
          const notificationId = id(dependencies.createNotificationId());
          const deliveries = recipient.channels.map((channel) => ({
            id: id(dependencies.createDeliveryId()),
            notificationId,
            channel,
            status: "pending" as const,
            createdAt: command.fact.occurredAt,
            payload:
              channel === "in_product"
                ? ({ kind: "in_product_invalidation" } as const)
                : ({
                    kind: "notification_event",
                    event: command.fact.kind as
                      | "conversation_message"
                      | "lifecycle_changed"
                      | "assignment_changed",
                    locale: dependencies.localeFor(recipient.principalId),
                    reference: command.reference,
                  } as const),
          }));
          if (
            deliveries.some(
              (delivery) =>
                delivery.channel === "email" &&
                (command.fact.kind === "feedback_received" ||
                  command.fact.kind === "internal_note"),
            )
          ) {
            throw new Error("NOTIFICATION_EMAIL_EVENT_INVALID");
          }
          await store.commit({
            notification: {
              id: notificationId,
              eventId: command.fact.eventId,
              feedbackId: command.fact.feedbackId,
              reporterId: command.participants.reporterId,
              workspaceId: command.fact.workspaceId,
              projectId: command.fact.projectId,
              recipientId: recipient.principalId,
              recipientKind: recipient.kind,
              kind: command.fact.kind,
              reference: command.reference,
              createdAt: command.fact.occurredAt,
              readAt: null,
            },
            deliveries,
          });
          count += 1;
        } catch {
          return { status: "retryable" };
        }
      }
      return { status: "materialized", count };
    },
  };
}
