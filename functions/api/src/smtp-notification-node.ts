import nodemailer from "nodemailer";

import type { ServerConfig } from "@y7-feedback/config/server";

import {
  createSmtpNotificationSender,
  type NotificationRecipientResolver,
} from "./smtp-mail-catcher-sender.js";

export function createNodeSmtpNotificationSender(
  config: NonNullable<ServerConfig["notificationEmail"]>,
  recipients: NotificationRecipientResolver,
) {
  const transport = nodemailer.createTransport({
    auth: { user: config.user, pass: config.password },
    host: config.host,
    port: config.port,
    secure: config.secure,
  });
  return createSmtpNotificationSender(transport, { from: config.from }, recipients);
}
