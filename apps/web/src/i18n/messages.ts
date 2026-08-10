import type { Locale } from "@y7-feedback/domain";

interface IntentMessage {
  readonly action: string;
  readonly body: string;
  readonly href: string | null;
  readonly number: string;
  readonly title: string;
}

interface RootMessages {
  readonly brandLabel: string;
  readonly eyebrow: string;
  readonly intents: readonly [IntentMessage, IntentMessage, IntentMessage];
  readonly intentsLabel: string;
  readonly intro: string;
  readonly languageLabel: string;
  readonly title: string;
}

export const messages = {
  fr: {
    brandLabel: "Y7 Feedback — accueil",
    eyebrow: "Y7 Feedback",
    title: "Votre retour peut faire avancer un produit.",
    intro:
      "Utilisez le lien transmis par l’équipe du produit pour envoyer un retour, ou retrouvez un retour déjà envoyé.",
    languageLabel: "Langue",
    intentsLabel: "Choisir une action",
    intents: [
      {
        number: "01",
        title: "Donner un avis",
        body: "Ouvrez le lien propre au produit qui vous a été communiqué.",
        href: null,
        action: "Lien du produit requis",
      },
      {
        number: "02",
        title: "Retrouver un avis",
        body: "Utilisez la référence et la preuve d’accès reçues après l’envoi.",
        href: "/retrieve",
        action: "Retrouver un avis",
      },
      {
        number: "03",
        title: "Espace équipe",
        body: "Accédez à l’administration et au traitement des retours.",
        href: "/manage",
        action: "Se connecter",
      },
    ],
  },
  en: {
    brandLabel: "Y7 Feedback — home",
    eyebrow: "Y7 Feedback",
    title: "Your feedback can move a product forward.",
    intro:
      "Use the link shared by the product team to send feedback, or return to feedback you already submitted.",
    languageLabel: "Language",
    intentsLabel: "Choose an action",
    intents: [
      {
        number: "01",
        title: "Give feedback",
        body: "Open the product-specific link that was shared with you.",
        href: null,
        action: "Product link required",
      },
      {
        number: "02",
        title: "Retrieve feedback",
        body: "Use the reference and access proof issued after submission.",
        href: "/retrieve",
        action: "Retrieve feedback",
      },
      {
        number: "03",
        title: "Team workspace",
        body: "Sign in to administer Projects and work with feedback.",
        href: "/manage",
        action: "Sign in",
      },
    ],
  },
} as const satisfies Record<Locale, RootMessages>;
