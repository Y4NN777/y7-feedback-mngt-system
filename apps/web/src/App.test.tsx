import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("root orientation", () => {
  it("BDD-ROOT-001 shows exactly the three French intents without enumeration", () => {
    render(<App />);

    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Donner un avis" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Retrouver un avis" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Espace équipe" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText("WiseMoney")).not.toBeInTheDocument();
  });

  it("BDD-ROOT-002 switches to English and updates the document language", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(screen.getByRole("heading", { name: "Give feedback" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Retrieve feedback" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Team workspace" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");

    await user.click(screen.getByRole("button", { name: "Français" }));

    expect(screen.getByRole("heading", { name: "Donner un avis" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("fr");
  });
});

describe("WiseMoney feedback intake", () => {
  it("BDD-UX-INTAKE-001 preserves a safe draft across locales and reviews every category", async () => {
    window.history.replaceState({}, "", "/wisemoney");
    const user = userEvent.setup();
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Partager un retour sur WiseMoney" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Donner un avis" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Bug" }));
    await user.type(
      screen.getByRole("textbox", { name: "Quel problème avez-vous rencontré ?" }),
      "Le solde ne se rafraîchit pas.",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Contact (facultatif)" }),
      "personne@example.test",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Version de l’application (facultatif)" }),
      "2.4.1",
    );

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(
      screen.getByRole("textbox", { name: "What problem did you encounter?" }),
    ).toHaveValue("Le solde ne se rafraîchit pas.");
    expect(screen.getByRole("textbox", { name: "Contact (optional)" })).toHaveValue(
      "personne@example.test",
    );

    await user.click(screen.getByRole("button", { name: "Review feedback" }));

    expect(
      screen.getByRole("heading", { name: "Review before continuing" }),
    ).toBeInTheDocument();
    expect(screen.getByText("WiseMoney", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("Bug", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("Le solde ne se rafraîchit pas.")).toBeInTheDocument();
    expect(screen.getByText("personne@example.test")).toBeInTheDocument();
    expect(screen.getByText("2.4.1")).toBeInTheDocument();
    expect(screen.getByText("No attachments")).toBeInTheDocument();
    expect(screen.getByText(/optional.*follow up/i)).toBeInTheDocument();
    expect(screen.queryByText(/accepted|reference|proof/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Français" }));
    expect(
      screen.getByRole("heading", { name: "Relire avant de continuer" }),
    ).toBeInTheDocument();
  });

  it("BDD-FDB-001 requires the selected type's semantic source fields", async () => {
    window.history.replaceState({}, "", "/wisemoney");
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("radio", { name: "Suggestion" }));
    await user.click(screen.getByRole("button", { name: "Relire le retour" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Décrivez la proposition et sa raison avant la relecture.",
    );

    await user.type(
      screen.getByRole("textbox", { name: "Que proposez-vous ?" }),
      "Ajouter une vue mensuelle.",
    );
    await user.click(screen.getByRole("button", { name: "Relire le retour" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Décrivez la proposition et sa raison avant la relecture.",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Pourquoi serait-ce utile ?" }),
      "Pour comprendre les variations.",
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Dans quel contexte l’utiliseriez-vous ? (facultatif)",
      }),
      "Pendant la revue du budget.",
    );
    await user.click(screen.getByRole("button", { name: "Relire le retour" }));

    expect(
      screen.getByRole("heading", { name: "Relire avant de continuer" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ajouter une vue mensuelle.")).toBeInTheDocument();
    expect(screen.getByText("Pour comprendre les variations.")).toBeInTheDocument();
  });

  it("reviews optional Bug fields, supports editing, and rejects executable Context", async () => {
    window.history.replaceState({}, "", "/wisemoney");
    const user = userEvent.setup();
    render(<App />);

    await user.type(
      screen.getByRole("textbox", { name: "Quel problème avez-vous rencontré ?" }),
      "Le solde reste ancien.",
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Quel comportement attendiez-vous ? (facultatif)",
      }),
      "Voir le nouveau solde.",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Qu’avez-vous observé ? (facultatif)" }),
      "L’ancien solde reste affiché.",
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Comment reproduire le problème ? (facultatif)",
      }),
      "Ouvrir le tableau de bord.",
    );
    await user.click(screen.getByRole("button", { name: "Relire le retour" }));

    expect(screen.getByText("Aucun contact fourni")).toBeInTheDocument();
    expect(screen.getByText("Aucun contexte facultatif")).toBeInTheDocument();
    expect(screen.getByText("Voir le nouveau solde.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Modifier" }));
    expect(
      screen.getByRole("textbox", { name: "Quel problème avez-vous rencontré ?" }),
    ).toHaveValue("Le solde reste ancien.");

    await user.click(screen.getByRole("radio", { name: "Avis" }));
    await user.click(screen.getByRole("button", { name: "Relire le retour" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Certaines informations ne respectent pas les règles de ce formulaire.",
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Comment décririez-vous votre expérience ?",
      }),
      "Simple et rapide.",
    );
    await user.click(screen.getByRole("button", { name: "Relire le retour" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Certaines informations ne respectent pas les règles de ce formulaire.",
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Qu’avez-vous particulièrement apprécié ou non ?",
      }),
      "La lisibilité.",
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Version de l’application (facultatif)",
      }),
      "javascript:eval(1)",
    );
    await user.click(screen.getByRole("button", { name: "Relire le retour" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Certaines informations ne respectent pas les règles de ce formulaire.",
    );

    await user.clear(
      screen.getByRole("textbox", {
        name: "Version de l’application (facultatif)",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Relire le retour" }));
    expect(screen.getByText("Simple et rapide.")).toBeInTheDocument();
    expect(screen.getByText("La lisibilité.")).toBeInTheDocument();
  });
});
