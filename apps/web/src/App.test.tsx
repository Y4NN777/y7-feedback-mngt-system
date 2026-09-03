import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { OfflineIntakePersistence } from "./FeedbackIntake";
import type { IntakeGateway } from "./IntakeGateway";

const projectGateway = {
  resolve: () =>
    Promise.resolve({
      status: "current" as const,
      slug: "wisemoney",
      purpose: {
        fr: "Partager un retour sur WiseMoney",
        en: "Share feedback about WiseMoney",
      },
    }),
};

function renderApp(props: ComponentProps<typeof App> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App projectGateway={projectGateway} {...props} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("root orientation", () => {
  it("routes /manage to first-party administration instead of a public Project", () => {
    window.history.replaceState({}, "", "/manage");
    renderApp({
      administrationGateway: {
        execute: () => Promise.resolve({ status: "retryable" }),
      },
      administrationSession: {
        createJwt: () => Promise.resolve("jwt"),
        signIn: () => Promise.resolve("authenticated"),
        signOut: () => Promise.resolve(),
      },
    });
    expect(
      screen.getByRole("heading", { name: "Administration des projets" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Adresse e-mail")).toBeVisible();
  });

  it("routes /manage/sources to bilingual first-party source management", async () => {
    window.history.replaceState({}, "", "/manage/sources");
    const user = userEvent.setup();
    renderApp({
      administrationSession: {
        createJwt: () => Promise.resolve("jwt"),
        signIn: () => Promise.resolve("authenticated"),
        signOut: () => Promise.resolve(),
      },
      sourceManagementGateway: {
        list: () => Promise.resolve({ status: "retryable" }),
        begin: () => Promise.resolve({ status: "retryable" }),
        select: () => Promise.resolve({ status: "retryable" }),
        refresh: () => Promise.resolve({ status: "retryable" }),
        disconnect: () => Promise.resolve({ status: "retryable" }),
      },
    });
    expect(screen.getByRole("heading", { name: "Sources du projet" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { name: "Project sources" })).toBeVisible();
    expect(document.documentElement.lang).toBe("en");
  });

  it("BDD-INT-217 routes /intelligence to the protected bilingual screen", async () => {
    window.history.replaceState({}, "", "/intelligence");
    const user = userEvent.setup();
    renderApp({
      administrationSession: {
        createJwt: () => Promise.resolve("jwt"),
        signIn: () => Promise.resolve("authenticated"),
        signOut: () => Promise.resolve(),
      },
      intelligenceGateway: {
        analyze: () => Promise.resolve({ status: "retryable" }),
        mutate: () => Promise.resolve({ status: "retryable" }),
      },
    });
    expect(screen.getByRole("heading", { name: "Intelligence" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByText(/Analyze feedback inside one Project/u)).toBeVisible();
  });

  it("BDD-PLAT-234 routes /platform/access to the protected bilingual workflow", async () => {
    window.history.replaceState({}, "", "/platform/access");
    const user = userEvent.setup();
    renderApp({
      administrationSession: {
        createJwt: () => Promise.resolve("jwt"),
        signIn: () => Promise.resolve("authenticated"),
        signOut: () => Promise.resolve(),
      },
      platformAccessGateway: {
        execute: () => Promise.resolve({ status: "retryable" }),
      },
    });
    expect(screen.getByRole("heading", { name: "Accès exceptionnel" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { name: "Exceptional access" })).toBeVisible();
    expect(document.documentElement.lang).toBe("en");
  });

  it("BDD-ROOT-001 shows exactly the three French intents without enumeration", () => {
    renderApp();

    expect(screen.getByRole("main")).toHaveAttribute("data-visual-anchor", "swiss");
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
    renderApp();

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
  it("BDD-OFF-104 restores, saves and queues an accountless draft without claiming acceptance", async () => {
    window.history.replaceState({}, "", "/wisemoney");
    const user = userEvent.setup();
    const restored = {
      appreciation: "",
      contact: "",
      expected: "",
      experience: "",
      observed: "",
      problem: "Brouillon restauré",
      proposal: "",
      rationale: "",
      reproduction: "",
      type: "bug" as const,
      usageContext: "",
      version: "",
    };
    const save = vi.fn(() => Promise.resolve());
    const clear = vi.fn(() => Promise.resolve());
    const queue = vi.fn(() => Promise.resolve());
    const persistence: OfflineIntakePersistence = {
      restore: vi.fn(() => Promise.resolve(restored)),
      save,
      clear,
      queue,
    };
    renderApp({
      createOperationId: () => "123e4567-e89b-42d3-a456-426614174000",
      intakeGateway: {
        accept: () => Promise.resolve({ status: "retryable" }),
      },
      offlinePersistence: persistence,
    });
    expect(
      await screen.findByText("Brouillon hors ligne restauré sur cet appareil."),
    ).toHaveAttribute("role", "status");
    const problem = screen.getByRole("textbox", {
      name: "Quel problème avez-vous rencontré ?",
    });
    expect(problem).toHaveValue("Brouillon restauré");
    await user.type(problem, " et modifié");
    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });
    await user.click(screen.getByRole("button", { name: "Relire le retour" }));
    await user.click(screen.getByRole("button", { name: "Envoyer le retour" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Retour placé dans la file d’attente",
    );
    expect(screen.queryByRole("heading", { name: "Retour envoyé" })).toBeNull();
    expect(queue).toHaveBeenCalledWith(
      expect.objectContaining({
        clientOperationId: "123e4567-e89b-42d3-a456-426614174000",
        projectSlug: "wisemoney",
      }),
    );
    expect(clear).not.toHaveBeenCalled();
  });

  it("BDD-OFF-105 replays on confirmed connectivity and exposes the returned proof only in memory", async () => {
    window.history.replaceState({}, "", "/wisemoney");
    const clear = vi.fn(() => Promise.resolve());
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce({ status: "offline" as const })
      .mockResolvedValueOnce({
        status: "accepted" as const,
        outcome: {
          status: "accepted" as const,
          reference: "Y7-2026-OFFLINE",
          accessProof: "proof_offline_abcdefghijklmnopqrstuvwxyz_0123456789",
          replayed: true,
        },
      });
    renderApp({
      offlinePersistence: {
        restore: () => Promise.resolve(null),
        save: () => Promise.resolve(),
        clear,
        queue: () => Promise.resolve(),
      },
      offlineReplay: { runOnce },
    });
    await screen.findByRole("heading", {
      name: "Partager un retour sur WiseMoney",
    });
    await waitFor(() => {
      expect(runOnce).toHaveBeenCalledOnce();
    });
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByRole("heading", { name: "Retour envoyé" })).toBeVisible();
    expect(screen.getByText("Y7-2026-OFFLINE")).toBeVisible();
    expect(
      screen.getByText("proof_offline_abcdefghijklmnopqrstuvwxyz_0123456789"),
    ).toBeVisible();
    expect(clear).toHaveBeenCalledWith("wisemoney");
  });

  it("BDD-PROJ-002 redirects a historical slug to its canonical route", async () => {
    window.history.replaceState({}, "", "/wisemoney-legacy");
    const redirectProject = vi.fn();
    renderApp({
      redirectProject,
      projectGateway: {
        resolve: () =>
          Promise.resolve({ status: "redirect", canonicalSlug: "wisemoney" }),
      },
    });

    await screen.findByRole("status");
    await waitFor(() => {
      expect(redirectProject).toHaveBeenCalledWith("wisemoney");
    });
  });

  it("BDD-PROJ-003 uses one bilingual neutral screen for unknown Projects", async () => {
    window.history.replaceState({}, "", "/unknown-project");
    const user = userEvent.setup();
    renderApp({
      projectGateway: {
        resolve: () => Promise.resolve({ status: "unavailable" }),
      },
    });

    expect(
      await screen.findByRole("heading", { name: "Ce projet n’est pas disponible" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/unknown-project/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(
      screen.getByRole("heading", { name: "This project is unavailable" }),
    ).toBeInTheDocument();
  });

  it("BDD-UX-INTAKE-001 preserves a safe draft across locales and reviews every category", async () => {
    window.history.replaceState({}, "", "/wisemoney");
    const user = userEvent.setup();
    renderApp();

    await screen.findByRole("heading", {
      name: "Partager un retour sur WiseMoney",
    });

    expect(screen.getByRole("main")).toHaveAttribute("data-visual-anchor", "swiss");
    expect(
      screen.getByRole("region", { name: "Partager un retour sur WiseMoney" }),
    ).toHaveAttribute("data-step", "01");

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
    expect(
      screen.getByRole("region", { name: "Review before continuing" }),
    ).toHaveAttribute("data-step", "02");
    expect(screen.getByText("wisemoney", { selector: "dd" })).toBeInTheDocument();
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
    renderApp();
    await screen.findByRole("heading", {
      name: "Partager un retour sur WiseMoney",
    });

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
    renderApp();
    await screen.findByRole("heading", {
      name: "Partager un retour sur WiseMoney",
    });

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

  it("BDD-UX-INTAKE-002 confirms only authoritative acceptance and retains proof in memory", async () => {
    window.history.replaceState({}, "", "/wisemoney");
    const user = userEvent.setup();
    const accept = vi.fn(() =>
      Promise.resolve({
        status: "accepted" as const,
        reference: "Y7-2026-000001",
        accessProof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
        replayed: false,
      }),
    );
    renderApp({
      createOperationId: () => "123e4567-e89b-42d3-a456-426614174000",
      intakeGateway: { accept },
    });
    await screen.findByRole("heading", {
      name: "Partager un retour sur WiseMoney",
    });

    await user.type(
      screen.getByRole("textbox", { name: "Quel problème avez-vous rencontré ?" }),
      "Le solde est incorrect.",
    );
    await user.click(screen.getByRole("button", { name: "Relire le retour" }));
    expect(screen.queryByText("Y7-2026-000001")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Envoyer le retour" }));

    expect(
      await screen.findByRole("heading", { name: "Retour envoyé" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Retour envoyé" })).toHaveAttribute(
      "data-step",
      "03",
    );
    expect(screen.getByText("Y7-2026-000001")).toBeInTheDocument();
    expect(
      screen.getByText("proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG"),
    ).toBeInTheDocument();
    expect(screen.getByText(/conservez cette preuve séparément/i)).toBeInTheDocument();
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSlug: "wisemoney",
        clientOperationId: "123e4567-e89b-42d3-a456-426614174000",
        locale: "fr",
      }),
    );
  });

  it("retries the same operation after transient failure", async () => {
    window.history.replaceState({}, "", "/wisemoney");
    const user = userEvent.setup();
    const accept = vi
      .fn<IntakeGateway["accept"]>()
      .mockResolvedValueOnce({ status: "retryable" as const })
      .mockResolvedValueOnce({
        status: "accepted" as const,
        reference: "Y7-2026-000002",
        accessProof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
        replayed: true,
      });
    renderApp({
      createOperationId: () => "123e4567-e89b-42d3-a456-426614174000",
      intakeGateway: { accept },
    });
    await screen.findByRole("heading", {
      name: "Partager un retour sur WiseMoney",
    });
    await user.type(
      screen.getByRole("textbox", { name: "Quel problème avez-vous rencontré ?" }),
      "Le solde est incorrect.",
    );
    await user.click(screen.getByRole("button", { name: "Relire le retour" }));
    await user.click(screen.getByRole("button", { name: "Envoyer le retour" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /réessayer sans créer de doublon/i,
    );
    await user.click(screen.getByRole("button", { name: "Envoyer le retour" }));
    expect(await screen.findByText("Y7-2026-000002")).toBeInTheDocument();
    expect(accept).toHaveBeenCalledTimes(2);
    expect(accept.mock.calls[0]?.[0].clientOperationId).toBe(
      accept.mock.calls[1]?.[0].clientOperationId,
    );
  });
});
