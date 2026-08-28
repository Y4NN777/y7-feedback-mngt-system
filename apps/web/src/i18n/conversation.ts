import type { FeedbackLifecycleState, Locale } from "@y7-feedback/domain";

interface ConversationMessages {
  readonly title: string;
  readonly loading: string;
  readonly unavailable: string;
  readonly denied: string;
  readonly empty: string;
  readonly history: string;
  readonly answerLabel: string;
  readonly answerHint: string;
  readonly sendAnswer: string;
  readonly reopen: string;
  readonly sending: string;
  readonly sent: string;
  readonly conflict: string;
  readonly retry: string;
  readonly actor: Readonly<Record<"workspace" | "reporter", string>>;
  readonly state: Readonly<Record<FeedbackLifecycleState, string>>;
}

export const conversationMessages = {
  fr: {
    title: "Conversation",
    loading: "Chargement de la conversation…",
    unavailable: "La conversation est temporairement indisponible.",
    denied: "La preuve ne permet pas d’accéder à cette conversation.",
    empty: "Aucun message visible pour le moment.",
    history: "Historique des états",
    answerLabel: "Votre réponse",
    answerHint: "Votre réponse sera visible par l’équipe du projet.",
    sendAnswer: "Envoyer la réponse",
    reopen: "Rouvrir le retour",
    sending: "Envoi en cours…",
    sent: "Réponse enregistrée.",
    conflict: "L’état a changé. La conversation a été actualisée.",
    retry: "L’envoi n’a pas abouti. Vous pouvez réessayer sans créer de doublon.",
    actor: { workspace: "Équipe du projet", reporter: "Vous" },
    state: {
      received: "Reçu",
      under_review: "En cours d’examen",
      awaiting_reporter: "Information attendue",
      resolved: "Résolu",
      closed: "Fermé",
    },
  },
  en: {
    title: "Conversation",
    loading: "Loading conversation…",
    unavailable: "The conversation is temporarily unavailable.",
    denied: "The proof cannot authorize access to this conversation.",
    empty: "No visible message yet.",
    history: "Status history",
    answerLabel: "Your answer",
    answerHint: "Your answer will be visible to the project team.",
    sendAnswer: "Send answer",
    reopen: "Reopen feedback",
    sending: "Sending…",
    sent: "Answer recorded.",
    conflict: "The status changed. The conversation has been refreshed.",
    retry: "Delivery did not complete. You can retry without creating a duplicate.",
    actor: { workspace: "Project team", reporter: "You" },
    state: {
      received: "Received",
      under_review: "Under review",
      awaiting_reporter: "Waiting for information",
      resolved: "Resolved",
      closed: "Closed",
    },
  },
} as const satisfies Record<Locale, ConversationMessages>;
