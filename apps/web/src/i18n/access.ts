import type { FeedbackLifecycleState, Locale } from "@y7-feedback/domain";

interface AccessMessages {
  readonly acceptedHint: string;
  readonly acceptedTitle: string;
  readonly accessProof: string;
  readonly accessProofConfidential: string;
  readonly attachments: string;
  readonly back: string;
  readonly brandLabel: string;
  readonly denied: string;
  readonly hideProof: string;
  readonly intro: string;
  readonly languageLabel: string;
  readonly lookupAnother: string;
  readonly messages: string;
  readonly preserve: string;
  readonly reference: string;
  readonly retrieve: string;
  readonly retryable: string;
  readonly showProof: string;
  readonly source: string;
  readonly state: string;
  readonly stateLabels: Readonly<Record<FeedbackLifecycleState, string>>;
  readonly title: string;
  readonly viewTitle: string;
}

export const accessMessages = {
  fr: {
    acceptedHint: "L’acceptation durable a créé deux éléments distincts.",
    acceptedTitle: "Retour accepté",
    accessProof: "Preuve d’accès",
    accessProofConfidential: "Preuve d’accès confidentielle",
    attachments: "Pièces jointes",
    back: "Retour à l’accueil",
    brandLabel: "Y7 Feedback — accueil",
    denied: "Ces informations de retour ne permettent pas d’autoriser l’accès.",
    hideProof: "Masquer la preuve",
    intro:
      "Saisissez la référence et la preuve confidentielle reçues après l’acceptation.",
    languageLabel: "Langue",
    lookupAnother: "Chercher un autre retour",
    messages: "Messages visibles",
    preserve:
      "Conservez la référence et la preuve séparément. La preuve ne doit pas être placée dans une URL ni partagée par e-mail.",
    reference: "Référence",
    retrieve: "Retrouver le retour",
    retryable:
      "Le service est temporairement indisponible. Réessayez sans modifier vos informations.",
    showProof: "Afficher la preuve",
    source: "Source originale",
    state: "État",
    stateLabels: {
      received: "Reçu",
      under_review: "En cours d’examen",
      awaiting_reporter: "Information attendue",
      resolved: "Résolu",
      closed: "Fermé",
    },
    title: "Retrouver un retour",
    viewTitle: "Votre retour",
  },
  en: {
    acceptedHint: "Durable acceptance created two separate return details.",
    acceptedTitle: "Feedback accepted",
    accessProof: "Access proof",
    accessProofConfidential: "Confidential access proof",
    attachments: "Attachments",
    back: "Back to home",
    brandLabel: "Y7 Feedback — home",
    denied: "These return details cannot authorize access.",
    hideProof: "Hide proof",
    intro: "Enter the reference and confidential proof issued after acceptance.",
    languageLabel: "Language",
    lookupAnother: "Find other feedback",
    messages: "Visible messages",
    preserve:
      "Keep the reference and proof separately. Do not put the proof in a URL or share it by email.",
    reference: "Reference",
    retrieve: "Retrieve feedback",
    retryable:
      "The service is temporarily unavailable. Try again without changing your details.",
    showProof: "Show proof",
    source: "Original source",
    state: "State",
    stateLabels: {
      received: "Received",
      under_review: "Under review",
      awaiting_reporter: "Waiting for information",
      resolved: "Resolved",
      closed: "Closed",
    },
    title: "Retrieve feedback",
    viewTitle: "Your feedback",
  },
} as const satisfies Record<Locale, AccessMessages>;
