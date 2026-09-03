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
  readonly publicationAudience: string;
  readonly publicationConsent: string;
  readonly publicationConsentHint: string;
  readonly grantPublicationConsent: string;
  readonly revokePublicationConsent: string;
  readonly consentActive: string;
  readonly consentRevoked: string;
  readonly consentConflict: string;
  readonly deletionAcknowledge: string;
  readonly deletionComplete: string;
  readonly deletionConflict: string;
  readonly deletionHint: string;
  readonly deletionRequest: string;
  readonly deletionTitle: string;
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
    publicationAudience: "Destination publique autorisée",
    publicationConsent: "Publication dans une issue publique",
    publicationConsentHint:
      "Autorisez explicitement une destination précise. Seul le contenu public autorisé pourra être publié.",
    grantPublicationConsent: "Autoriser cette publication",
    revokePublicationConsent: "Révoquer l’autorisation",
    consentActive: "Autorisation active, version {version}.",
    consentRevoked: "Autorisation révoquée, version {version}.",
    consentConflict: "Cette demande entre en conflit avec une tentative précédente.",
    deletionAcknowledge:
      "Je comprends que l’accès sera révoqué immédiatement et que la purge définitive aura lieu après 30 jours.",
    deletionComplete:
      "Le retour est supprimé de l’usage courant. Sa purge définitive est programmée pour le {date}.",
    deletionConflict: "Cette suppression a déjà été traitée différemment.",
    deletionHint:
      "La suppression masque immédiatement le retour, anonymise les données Reporter et révoque cette preuve d’accès.",
    deletionRequest: "Supprimer définitivement mon retour",
    deletionTitle: "Suppression du retour",
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
    publicationAudience: "Authorized public destination",
    publicationConsent: "Publication in a public issue",
    publicationConsentHint:
      "Explicitly authorize one exact destination. Only authorized public content may be published.",
    grantPublicationConsent: "Authorize this publication",
    revokePublicationConsent: "Revoke authorization",
    consentActive: "Authorization active, version {version}.",
    consentRevoked: "Authorization revoked, version {version}.",
    consentConflict: "This request conflicts with an earlier attempt.",
    deletionAcknowledge:
      "I understand that access is revoked immediately and permanent purge occurs after 30 days.",
    deletionComplete:
      "The feedback is removed from ordinary use. Permanent purge is scheduled for {date}.",
    deletionConflict: "This deletion was already handled differently.",
    deletionHint:
      "Deletion immediately hides the feedback, anonymizes Reporter data, and revokes this access proof.",
    deletionRequest: "Permanently delete my feedback",
    deletionTitle: "Delete feedback",
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
