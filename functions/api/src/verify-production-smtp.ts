/* v8 ignore file -- live SMTP authority is exercised only by protected Production CI. */
import { parseServerConfig } from "@y7-feedback/config/server";

import { proveProductionSmtpEvidence } from "./production-smtp-evidence.js";
import { createSmtpNotificationSender } from "./smtp-mail-catcher-sender.js";
import { createNodeSmtpNotificationSender } from "./smtp-notification-node.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("PRODUCTION_SMTP_CONFIGURATION_MISSING");
  return value;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply") || !process.argv.includes("--production")) {
    throw new Error("PRODUCTION_SMTP_EXPLICIT_VERIFICATION_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment !== "production" || !config.notificationEmail) {
    throw new Error("PRODUCTION_SMTP_CONFIGURATION_INVALID");
  }
  const emailConfig = config.notificationEmail;
  const recipient = required("Y7_PRODUCTION_EMAIL_VERIFICATION_RECIPIENT");
  const delivery = {
    deliveryId: "production_smtp_probe",
    channel: "email" as const,
    payload: {
      kind: "feedback_received",
      locale: "en",
      reference: "Y7-PROD-SMTP-12345678",
      recipient: { kind: "workspace", id: "production_smtp_probe" },
    },
  };
  const real = createNodeSmtpNotificationSender(emailConfig, {
    resolve: () => Promise.resolve(recipient),
  });
  const classified = (responseCode: number) =>
    createSmtpNotificationSender(
      {
        sendMail: () =>
          Promise.reject(
            Object.assign(new Error("classified SMTP failure"), { responseCode }),
          ),
      },
      { from: emailConfig.from },
      { resolve: () => Promise.resolve(recipient) },
    );
  await proveProductionSmtpEvidence({
    handoff: () => real.deliver(delivery),
    retry: () => classified(421).deliver(delivery),
    terminal: () => classified(550).deliver(delivery),
  });
  process.stdout.write(
    '{"result":"PRODUCTION_SMTP_EVIDENCE_PASSED","handoff":"delivered","retry":"retryable","terminal":"permanent"}\n',
  );
}

main().catch(() => {
  process.stderr.write('{"error":"PRODUCTION_SMTP_EVIDENCE_FAILED"}\n');
  process.exitCode = 1;
});
