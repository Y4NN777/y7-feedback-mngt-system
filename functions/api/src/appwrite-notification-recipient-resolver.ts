import type { TablesDB, Users } from "node-appwrite";

import type { NotificationRecipientResolver } from "./smtp-mail-catcher-sender.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface NotificationRecipientSchema {
  readonly databaseId: string;
  readonly notificationsTableId: string;
  readonly reportersTableId: string;
  readonly feedbackTableId: string;
}

export interface NotificationRecipientTablesPort {
  readonly getRow: (input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }) => Promise<unknown>;
}

export interface NotificationRecipientUsersPort {
  readonly get: (input: { readonly userId: string }) => Promise<unknown>;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const emailAddress =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?[.][A-Za-z]{2,63}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function id(value: unknown): string {
  if (typeof value !== "string" || !appwriteId.test(value)) {
    throw new Error("NOTIFICATION_RECIPIENT_AUTHORITY_INVALID");
  }
  return value;
}

function email(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return emailAddress.test(normalized) ? normalized : null;
}

export function createAppwriteNotificationRecipientResolver(
  tables: NotificationRecipientTablesPort,
  users: NotificationRecipientUsersPort,
  schema: NotificationRecipientSchema,
  sensitive: AppwriteSensitivePersistence,
): NotificationRecipientResolver {
  if (
    !appwriteId.test(schema.databaseId) ||
    !appwriteId.test(schema.notificationsTableId) ||
    !appwriteId.test(schema.reportersTableId) ||
    !appwriteId.test(schema.feedbackTableId) ||
    new Set([
      schema.notificationsTableId,
      schema.reportersTableId,
      schema.feedbackTableId,
    ]).size !== 3
  ) {
    throw new Error("NOTIFICATION_RECIPIENT_SCHEMA_INVALID");
  }

  return {
    async resolve(deliveryId) {
      const notification = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.notificationsTableId,
        rowId: id(deliveryId),
      });
      if (!object(notification) || notification.$id !== deliveryId) {
        throw new Error("NOTIFICATION_RECIPIENT_AUTHORITY_INVALID");
      }
      const feedbackId = id(notification.feedbackId);
      const feedback = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.feedbackTableId,
        rowId: feedbackId,
      });
      if (!object(feedback) || feedback.$id !== feedbackId) {
        throw new Error("NOTIFICATION_RECIPIENT_AUTHORITY_INVALID");
      }
      const workspaceId = id(feedback.workspaceId);
      const recipientKind = notification.recipientKind;
      const recipientId = id(
        recipientKind === undefined
          ? notification.reporterId
          : notification.recipientId,
      );

      if (recipientKind === undefined || recipientKind === "reporter") {
        if (
          notification.workspaceId !== undefined &&
          notification.workspaceId !== workspaceId
        ) {
          throw new Error("NOTIFICATION_RECIPIENT_AUTHORITY_INVALID");
        }
        const reporter = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.reportersTableId,
          rowId: recipientId,
        });
        if (
          !object(reporter) ||
          reporter.$id !== recipientId ||
          reporter.workspaceId !== workspaceId ||
          typeof reporter.attributionJson !== "string"
        ) {
          throw new Error("NOTIFICATION_RECIPIENT_AUTHORITY_INVALID");
        }
        let attribution: unknown;
        try {
          attribution = JSON.parse(
            sensitive.protector.open(
              {
                environment: sensitive.environment,
                tableId: schema.reportersTableId,
                rowId: recipientId,
                field: "attributionJson",
              },
              reporter.attributionJson,
            ),
          ) as unknown;
        } catch {
          throw new Error("NOTIFICATION_RECIPIENT_AUTHORITY_INVALID");
        }
        return object(attribution) && attribution.kind === "contact"
          ? email(attribution.value)
          : null;
      }

      if (recipientKind !== "workspace") {
        throw new Error("NOTIFICATION_RECIPIENT_AUTHORITY_INVALID");
      }
      const user = await users.get({ userId: recipientId });
      if (!object(user) || user.$id !== recipientId) {
        throw new Error("NOTIFICATION_RECIPIENT_AUTHORITY_INVALID");
      }
      return email(user.email);
    },
  };
}

export function createNodeAppwriteNotificationRecipientResolver(
  tables: TablesDB,
  users: Users,
  schema: NotificationRecipientSchema,
  sensitive: AppwriteSensitivePersistence,
): NotificationRecipientResolver {
  return createAppwriteNotificationRecipientResolver(
    { getRow: (input) => tables.getRow(input) },
    { get: (input) => users.get(input) },
    schema,
    sensitive,
  );
}
