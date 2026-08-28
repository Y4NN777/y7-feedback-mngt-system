import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

import { createSmtpMailCatcherSender } from "./smtp-mail-catcher-sender.js";

const testReference = "Y7-PREVIEW-MAIL-12345678";
const kinds = [
  "feedback_received",
  "message_added",
  "feedback_under_review",
  "clarification_requested",
  "reporter_answered",
  "feedback_resolved",
  "feedback_closed",
  "feedback_reopened",
  "assignment_changed",
] as const;
const prohibited = [
  "access-proof-value",
  "private-contact-value@example.test",
  "internal-note-value",
  "attachment-private-url",
  "provider-token-value",
  "private-context-value",
];

export async function verifyPreviewMailCatcher(): Promise<{
  readonly captured: true;
  readonly delivered: true;
  readonly referenceMatched: true;
  readonly localizedTemplates: 18;
  readonly providerHandoffP95Ms: number;
  readonly prohibitedDataAbsent: true;
}> {
  const account = await nodemailer.createTestAccount();
  const transport = nodemailer.createTransport({
    auth: { pass: account.pass, user: account.user },
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
  });
  const capturedBodies: string[] = [];
  const handoffDurations: number[] = [];
  const sender = createSmtpMailCatcherSender(
    {
      sendMail: async (message) => {
        const startedAt = performance.now();
        const messageInfo: SMTPTransport.SentMessageInfo =
          await transport.sendMail(message);
        handoffDurations.push(performance.now() - startedAt);
        const previewUrl = nodemailer.getTestMessageUrl(messageInfo);
        if (previewUrl === false) throw new Error("MAIL_CATCHER_DELIVERY_FAILED");
        const response = await fetch(previewUrl, {
          headers: { accept: "text/html" },
          signal: AbortSignal.timeout(30_000),
        });
        const body = await response.text();
        if (!response.ok) throw new Error("MAIL_CATCHER_CAPTURE_FAILED");
        capturedBodies.push(body);
        return messageInfo;
      },
    },
    {
      from: "Y7 Feedback Preview <no-reply@y7-feedback.test>",
      to: "reporter@example.test",
    },
  );

  for (const kind of kinds) {
    for (const locale of ["fr", "en"] as const) {
      const outcome = await sender.deliver({
        deliveryId: `mail_${kind}_${locale}`,
        channel: "email",
        payload: {
          kind,
          locale,
          reference: testReference,
          recipient: { kind: "reporter", id: "reporter_preview" },
        },
      });
      if (outcome !== "delivered") throw new Error("MAIL_CATCHER_DELIVERY_FAILED");
    }
  }
  if (
    capturedBodies.length !== 18 ||
    capturedBodies.some((body) => !body.includes(testReference)) ||
    capturedBodies.some((body) => prohibited.some((value) => body.includes(value)))
  ) {
    throw new Error("MAIL_CATCHER_CAPTURE_FAILED");
  }
  const sorted = [...handoffDurations].sort((left, right) => left - right);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  if (p95 === undefined || p95 > 30_000) {
    throw new Error("MAIL_CATCHER_HANDOFF_SLO");
  }
  return {
    captured: true,
    delivered: true,
    referenceMatched: true,
    localizedTemplates: 18,
    providerHandoffP95Ms: Math.round(p95),
    prohibitedDataAbsent: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyPreviewMailCatcher();
  console.log(JSON.stringify(result));
}
