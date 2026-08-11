import type { FeedbackType, Locale } from "@y7-feedback/domain";

interface IntakeMessages {
  readonly attachments: string;
  readonly attachmentsNone: string;
  readonly back: string;
  readonly brandLabel: string;
  readonly bug: string;
  readonly bugError: string;
  readonly contact: string;
  readonly contactDisclosure: string;
  readonly contactNone: string;
  readonly contactPurpose: string;
  readonly confirmationHint: string;
  readonly confirmationTitle: string;
  readonly conflictError: string;
  readonly context: string;
  readonly contextNone: string;
  readonly contextPurpose: string;
  readonly edit: string;
  readonly invalidError: string;
  readonly expected: string;
  readonly experience: string;
  readonly appreciation: string;
  readonly intro: string;
  readonly languageLabel: string;
  readonly observed: string;
  readonly problem: string;
  readonly project: string;
  readonly proposal: string;
  readonly rationale: string;
  readonly reference: string;
  readonly reproduction: string;
  readonly review: string;
  readonly reviewError: string;
  readonly reviewHint: string;
  readonly reviewTitle: string;
  readonly retryableError: string;
  readonly send: string;
  readonly sending: string;
  readonly source: string;
  readonly suggestion: string;
  readonly suggestionError: string;
  readonly title: string;
  readonly type: string;
  readonly typeLabels: Readonly<Record<FeedbackType, string>>;
  readonly typeLegend: string;
  readonly usageContext: string;
  readonly version: string;
  readonly accessProof: string;
  readonly accessProofWarning: string;
}

export const intakeMessages = {
  fr: {
    attachments: "Pièces jointes",
    attachmentsNone: "Aucune pièce jointe",
    back: "Retour à l’accueil",
    brandLabel: "Y7 Feedback — accueil",
    bug: "Bug",
    bugError: "Décrivez le problème avant la relecture.",
    contact: "Contact (facultatif)",
    contactDisclosure:
      "Le contact est facultatif et sert uniquement à vous recontacter au sujet de ce retour. Il reste non vérifié.",
    contactNone: "Aucun contact fourni",
    contactPurpose: "Recontacter la personne au sujet de ce retour",
    confirmationHint: "Le retour a été accepté par le service.",
    confirmationTitle: "Retour envoyé",
    conflictError:
      "Cette tentative ne correspond plus au retour relu. Modifiez puis relisez le retour.",
    context: "Contexte",
    contextNone: "Aucun contexte facultatif",
    contextPurpose: "Identifier la version concernée par le retour",
    edit: "Modifier",
    invalidError: "Le service a refusé ce retour. Vérifiez les informations.",
    expected: "Quel comportement attendiez-vous ? (facultatif)",
    experience: "Comment décririez-vous votre expérience ?",
    appreciation: "Qu’avez-vous particulièrement apprécié ou non ?",
    intro:
      "Décrivez votre expérience avec vos propres mots. Vous pourrez tout relire avant de continuer.",
    languageLabel: "Langue",
    observed: "Qu’avez-vous observé ? (facultatif)",
    problem: "Quel problème avez-vous rencontré ?",
    project: "Projet",
    proposal: "Que proposez-vous ?",
    rationale: "Pourquoi serait-ce utile ?",
    reference: "Référence",
    reproduction: "Comment reproduire le problème ? (facultatif)",
    review: "Relire le retour",
    reviewError:
      "Certaines informations ne respectent pas les règles de ce formulaire.",
    reviewHint:
      "Cette étape est une relecture locale. Votre retour n’est pas encore envoyé.",
    reviewTitle: "Relire avant de continuer",
    retryableError:
      "Le service est temporairement indisponible. Vous pouvez réessayer sans créer de doublon.",
    send: "Envoyer le retour",
    sending: "Envoi en cours…",
    source: "Votre retour",
    suggestion: "Suggestion",
    suggestionError: "Décrivez la proposition et sa raison avant la relecture.",
    title: "Partager un retour sur WiseMoney",
    type: "Type",
    typeLabels: { bug: "Bug", suggestion: "Suggestion", review: "Avis" },
    typeLegend: "Quel type de retour souhaitez-vous partager ?",
    usageContext: "Dans quel contexte l’utiliseriez-vous ? (facultatif)",
    version: "Version de l’application (facultatif)",
    accessProof: "Preuve d’accès",
    accessProofWarning:
      "Conservez cette preuve séparément de la référence. Elle ne pourra pas être réaffichée.",
  },
  en: {
    attachments: "Attachments",
    attachmentsNone: "No attachments",
    back: "Back to home",
    brandLabel: "Y7 Feedback — home",
    bug: "Bug",
    bugError: "Describe the problem before reviewing.",
    contact: "Contact (optional)",
    contactDisclosure:
      "Contact is optional and used only to follow up about this feedback. It remains unverified.",
    contactNone: "No contact provided",
    contactPurpose: "Follow up with the person about this feedback",
    confirmationHint: "The feedback was accepted by the service.",
    confirmationTitle: "Feedback sent",
    conflictError:
      "This attempt no longer matches the reviewed feedback. Edit and review it again.",
    context: "Context",
    contextNone: "No optional context",
    contextPurpose: "Identify the application version related to the feedback",
    edit: "Edit",
    invalidError: "The service rejected this feedback. Check the information.",
    expected: "What did you expect? (optional)",
    experience: "How would you describe your experience?",
    appreciation: "What did you particularly appreciate or dislike?",
    intro:
      "Describe your experience in your own words. You can review everything before continuing.",
    languageLabel: "Language",
    observed: "What did you observe? (optional)",
    problem: "What problem did you encounter?",
    project: "Project",
    proposal: "What do you propose?",
    rationale: "Why would it be useful?",
    reference: "Reference",
    reproduction: "How can the problem be reproduced? (optional)",
    review: "Review feedback",
    reviewError: "Some information does not meet this form's rules.",
    reviewHint: "This is a local review step. Your feedback has not been sent.",
    reviewTitle: "Review before continuing",
    retryableError:
      "The service is temporarily unavailable. You can retry without creating a duplicate.",
    send: "Send feedback",
    sending: "Sending…",
    source: "Your feedback",
    suggestion: "Suggestion",
    suggestionError: "Describe the proposal and its rationale before reviewing.",
    title: "Share feedback about WiseMoney",
    type: "Type",
    typeLabels: { bug: "Bug", suggestion: "Suggestion", review: "Review" },
    typeLegend: "What type of feedback would you like to share?",
    usageContext: "In what context would you use it? (optional)",
    version: "Application version (optional)",
    accessProof: "Access proof",
    accessProofWarning:
      "Keep this proof separate from the reference. It cannot be displayed again.",
  },
} as const satisfies Record<Locale, IntakeMessages>;
