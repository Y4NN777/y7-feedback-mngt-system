import type { OutboxDeliverySender } from "./outbox.js";

export interface SmtpMailCatcherTransport {
  readonly sendMail: (message: {
    readonly envelope: { readonly from: string; readonly to: string };
    readonly from: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly subject: string;
    readonly text: string;
    readonly to: string;
  }) => Promise<unknown>;
}

export interface SmtpMailCatcherConfig {
  readonly from: string;
  readonly to: string;
}

const deliveryId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const reference = /^Y7-[A-Z0-9][A-Z0-9-]{6,78}[A-Z0-9]$/u;
const testAddress = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+[.]test$/u;

function address(value: string): string {
  const match = /(?:^|<)([^<>\s]+@[^<>\s]+)(?:>|$)/u.exec(value);
  if (!match?.[1] || !testAddress.test(match[1])) {
    throw new Error("MAIL_CATCHER_CONFIG_INVALID");
  }
  return match[1];
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(
  value: unknown,
): { readonly locale: "fr" | "en"; readonly reference: string } | undefined {
  if (!isObject(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "kind,locale,reference") return undefined;
  if (
    value.kind !== "feedback_accepted" ||
    (value.locale !== "fr" && value.locale !== "en") ||
    typeof value.reference !== "string" ||
    !reference.test(value.reference)
  ) {
    return undefined;
  }
  return { locale: value.locale, reference: value.reference };
}

function responseCode(error: unknown): number | undefined {
  if (!isObject(error) || !Number.isSafeInteger(error.responseCode)) return undefined;
  return Number(error.responseCode);
}

export function validateSmtpMailCatcherConfig(config: SmtpMailCatcherConfig): {
  readonly envelopeFrom: string;
  readonly envelopeTo: string;
} {
  return { envelopeFrom: address(config.from), envelopeTo: address(config.to) };
}

export function createSmtpMailCatcherSender(
  transport: SmtpMailCatcherTransport,
  config: SmtpMailCatcherConfig,
): OutboxDeliverySender {
  const { envelopeFrom, envelopeTo } = validateSmtpMailCatcherConfig(config);
  if (typeof transport.sendMail !== "function") {
    throw new Error("MAIL_CATCHER_CONFIG_INVALID");
  }

  return {
    async deliver(input) {
      if (input.channel === "in_product") return "delivered";
      const parsed = message(input.payload);
      if (!deliveryId.test(input.deliveryId) || !parsed) return "permanent";

      const french = parsed.locale === "fr";
      try {
        await transport.sendMail({
          envelope: { from: envelopeFrom, to: envelopeTo },
          from: config.from,
          headers: { "X-Y7-Delivery-ID": input.deliveryId },
          subject: french ? "Votre retour a été reçu" : "Your feedback was received",
          text: french
            ? `Votre retour a été reçu. Référence : ${parsed.reference}`
            : `Your feedback was received. Reference: ${parsed.reference}`,
          to: config.to,
        });
        return "delivered";
      } catch (error: unknown) {
        const code = responseCode(error);
        return code !== undefined && code >= 500 ? "permanent" : "retryable";
      }
    },
  };
}
