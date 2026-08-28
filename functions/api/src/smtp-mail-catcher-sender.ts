import type { OutboxDeliverySender } from "./outbox.js";
import type { NotificationEventKind } from "@y7-feedback/domain";

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
const recipientKinds = new Set(["reporter", "workspace"]);

type MailKind = NotificationEventKind | "feedback_accepted";

const templates: Readonly<
  Record<MailKind, Readonly<Record<"fr" | "en", { subject: string; text: string }>>>
> = {
  feedback_accepted: {
    fr: { subject: "Votre retour a été reçu", text: "Votre retour a été reçu." },
    en: { subject: "Your feedback was received", text: "Your feedback was received." },
  },
  feedback_received: {
    fr: { subject: "Nouveau retour reçu", text: "Un nouveau retour a été reçu." },
    en: { subject: "New feedback received", text: "New feedback was received." },
  },
  message_added: {
    fr: { subject: "Nouveau message", text: "Un nouveau message est disponible." },
    en: { subject: "New message", text: "A new message is available." },
  },
  feedback_under_review: {
    fr: {
      subject: "Retour en cours d’analyse",
      text: "Votre retour est en cours d’analyse.",
    },
    en: { subject: "Feedback under review", text: "Your feedback is under review." },
  },
  clarification_requested: {
    fr: {
      subject: "Précision demandée",
      text: "Une précision est demandée pour ce retour.",
    },
    en: {
      subject: "Clarification requested",
      text: "Clarification is requested for this feedback.",
    },
  },
  reporter_answered: {
    fr: { subject: "Nouvelle réponse", text: "Une nouvelle réponse est disponible." },
    en: { subject: "New reply", text: "A new reply is available." },
  },
  feedback_resolved: {
    fr: { subject: "Retour résolu", text: "Ce retour a été résolu." },
    en: { subject: "Feedback resolved", text: "This feedback was resolved." },
  },
  feedback_closed: {
    fr: { subject: "Retour clôturé", text: "Ce retour a été clôturé." },
    en: { subject: "Feedback closed", text: "This feedback was closed." },
  },
  feedback_reopened: {
    fr: { subject: "Retour rouvert", text: "Ce retour a été rouvert." },
    en: { subject: "Feedback reopened", text: "This feedback was reopened." },
  },
  assignment_changed: {
    fr: {
      subject: "Attribution modifiée",
      text: "L’attribution de ce retour a été modifiée.",
    },
    en: {
      subject: "Assignment changed",
      text: "This feedback assignment was changed.",
    },
  },
};

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

function message(value: unknown):
  | {
      readonly kind: MailKind;
      readonly locale: "fr" | "en";
      readonly reference: string;
    }
  | undefined {
  if (!isObject(value)) return undefined;
  const keys = Object.keys(value).sort();
  const legacy = keys.join(",") === "kind,locale,reference";
  const event = keys.join(",") === "kind,locale,recipient,reference";
  if (!legacy && !event) return undefined;
  if (event) {
    const recipient = value.recipient;
    if (
      !isObject(recipient) ||
      Object.keys(recipient).sort().join(",") !== "id,kind" ||
      typeof recipient.id !== "string" ||
      !deliveryId.test(recipient.id) ||
      typeof recipient.kind !== "string" ||
      !recipientKinds.has(recipient.kind)
    ) {
      return undefined;
    }
  }
  if (
    typeof value.kind !== "string" ||
    !(value.kind in templates) ||
    (legacy && value.kind !== "feedback_accepted") ||
    (value.locale !== "fr" && value.locale !== "en") ||
    typeof value.reference !== "string" ||
    !reference.test(value.reference)
  ) {
    return undefined;
  }
  return {
    kind: value.kind as MailKind,
    locale: value.locale,
    reference: value.reference,
  };
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
      const template = templates[parsed.kind][parsed.locale];
      try {
        await transport.sendMail({
          envelope: { from: envelopeFrom, to: envelopeTo },
          from: config.from,
          headers: { "X-Y7-Delivery-ID": input.deliveryId },
          subject: template.subject,
          text: french
            ? `${template.text} Référence : ${parsed.reference}`
            : `${template.text} Reference: ${parsed.reference}`,
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
