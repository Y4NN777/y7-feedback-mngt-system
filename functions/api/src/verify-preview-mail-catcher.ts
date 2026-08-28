import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

import { createSmtpMailCatcherSender } from "./smtp-mail-catcher-sender.js";

const testReference = "Y7-PREVIEW-MAIL-12345678";

export async function verifyPreviewMailCatcher(): Promise<{
  readonly captured: true;
  readonly delivered: true;
  readonly referenceMatched: true;
}> {
  const account = await nodemailer.createTestAccount();
  const transport = nodemailer.createTransport({
    auth: { pass: account.pass, user: account.user },
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
  });
  let messageInfo: SMTPTransport.SentMessageInfo | undefined;
  const sender = createSmtpMailCatcherSender(
    {
      sendMail: async (message) => {
        messageInfo = await transport.sendMail(message);
        return messageInfo;
      },
    },
    {
      from: "Y7 Feedback Preview <no-reply@y7-feedback.test>",
      to: "reporter@example.test",
    },
  );

  const outcome = await sender.deliver({
    deliveryId: "preview_mail_capture_1",
    channel: "email",
    payload: {
      kind: "feedback_accepted",
      locale: "fr",
      reference: testReference,
    },
  });
  if (outcome !== "delivered" || messageInfo === undefined) {
    throw new Error("MAIL_CATCHER_DELIVERY_FAILED");
  }
  const previewUrl = nodemailer.getTestMessageUrl(messageInfo);
  if (previewUrl === false) throw new Error("MAIL_CATCHER_DELIVERY_FAILED");
  const response = await fetch(previewUrl, {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok || !body.includes(testReference)) {
    throw new Error("MAIL_CATCHER_CAPTURE_FAILED");
  }
  return { captured: true, delivered: true, referenceMatched: true };
}

export async function verifyG3MailCatcher(): Promise<{
  readonly captured: true;
  readonly deliveries: 6;
  readonly forbiddenDataAbsent: true;
}> {
  const account = await nodemailer.createTestAccount();
  const transport = nodemailer.createTransport({
    auth: { pass: account.pass, user: account.user },
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
  });
  const bodies: string[] = [];
  const sender = createSmtpMailCatcherSender(
    {
      sendMail: async (message) => {
        const info: SMTPTransport.SentMessageInfo = await transport.sendMail(message);
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl === false) throw new Error("MAIL_G3_CAPTURE_FAILED");
        const response = await fetch(previewUrl, {
          headers: { accept: "text/html" },
          signal: AbortSignal.timeout(30_000),
        });
        const body = await response.text();
        if (!response.ok) throw new Error("MAIL_G3_CAPTURE_FAILED");
        bodies.push(body);
        return info;
      },
    },
    {
      from: "Y7 Feedback Preview <no-reply@y7-feedback.test>",
      to: "reporter@example.test",
    },
  );
  let delivery = 0;
  for (const locale of ["fr", "en"] as const) {
    for (const event of [
      "conversation_message",
      "lifecycle_changed",
      "assignment_changed",
    ] as const) {
      const outcome = await sender.deliver({
        deliveryId: `g3_mail_${String(++delivery)}`,
        channel: "email",
        payload: {
          kind: "notification_event",
          event,
          locale,
          reference: testReference,
        },
      });
      if (outcome !== "delivered") throw new Error("MAIL_G3_DELIVERY_FAILED");
    }
  }
  const forbidden = [
    "accessProof",
    "Internal Note",
    "providerToken",
    "attachment",
    "person@example",
  ];
  if (
    bodies.length !== 6 ||
    bodies.some((body) =>
      forbidden.some((sentinel) => body.toLowerCase().includes(sentinel.toLowerCase())),
    ) ||
    bodies.some((body) => !body.includes(testReference))
  ) {
    throw new Error("MAIL_G3_PAYLOAD_POLICY_FAILED");
  }
  return { captured: true, deliveries: 6, forbiddenDataAbsent: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = process.argv.includes("--g3")
    ? await verifyG3MailCatcher()
    : await verifyPreviewMailCatcher();
  console.log(JSON.stringify(result));
}
