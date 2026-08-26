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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyPreviewMailCatcher();
  console.log(JSON.stringify(result));
}
