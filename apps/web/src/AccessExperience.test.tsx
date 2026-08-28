import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReporterFeedbackView } from "@y7-feedback/domain";

import { AccessMaterial } from "./AccessMaterial";
import { App } from "./App";
import type { AccountlessGateway } from "./RetrieveFeedback";
import type { PublicationConsentGateway } from "./PublicationConsentGateway";

const proof = "proof_A_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG";

function renderApp(app: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{app}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("accountless access experience", () => {
  it("explains how to preserve separate accepted reference and proof without a URL", async () => {
    const user = userEvent.setup();
    render(
      <AccessMaterial locale="fr" reference="Y7-2026-000001" accessProof={proof} />,
    );

    expect(screen.getByRole("heading", { name: "Retour accepté" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Y7-2026-000001")).toHaveAttribute("readonly");
    const proofField = screen.getByLabelText("Preuve d’accès confidentielle");
    expect(proofField).toHaveAttribute("type", "password");
    expect(screen.getByText(/conservez.*séparément/i)).toBeInTheDocument();
    expect(window.location.href).not.toContain(proof);

    await user.click(screen.getByRole("button", { name: "Afficher la preuve" }));
    expect(proofField).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Masquer la preuve" }));
    expect(proofField).toHaveAttribute("type", "password");
  });

  it("preserves retrieval input across locales and gives one denial without existence disclosure", async () => {
    window.history.replaceState({}, "", "/retrieve");
    const user = userEvent.setup();
    const retrieve = vi.fn<AccountlessGateway["retrieve"]>(() =>
      Promise.resolve({ status: "denied" }),
    );
    renderApp(<App accountlessGateway={{ retrieve }} />);

    expect(screen.getByRole("main")).toHaveAttribute("data-visual-anchor", "swiss");
    expect(screen.getByRole("region", { name: "Retrouver un retour" })).toHaveAttribute(
      "data-step",
      "01",
    );

    await user.type(
      screen.getByRole("textbox", { name: "Référence" }),
      "Y7-2026-000001",
    );
    await user.type(screen.getByLabelText("Preuve d’accès"), proof);
    await user.click(screen.getByRole("button", { name: "English" }));

    expect(screen.getByRole("textbox", { name: "Reference" })).toHaveValue(
      "Y7-2026-000001",
    );
    expect(screen.getByLabelText("Access proof")).toHaveValue(proof);
    await user.click(screen.getByRole("button", { name: "Retrieve feedback" }));

    expect(retrieve).toHaveBeenCalledWith({ reference: "Y7-2026-000001", proof });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "These return details cannot authorize access.",
    );
    expect(screen.queryByText(/exists|unknown reference/i)).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("renders only the authorized Reporter projection and a distinct retryable outcome", async () => {
    window.history.replaceState({}, "", "/retrieve");
    const user = userEvent.setup();
    const view: ReporterFeedbackView = {
      feedbackId: "feedback-1",
      reference: "Y7-2026-000001",
      originalSource: {
        type: "review",
        experience: "Rapide",
        appreciation: "Interface claire",
      },
      currentSource: {
        type: "review",
        experience: "Rapide",
        appreciation: "Interface claire",
      },
      currentState: "received",
      history: [],
      messages: [],
      attachments: [],
      sourceRevisions: [],
      deletionRequests: [],
    };
    const retrieve = vi
      .fn<AccountlessGateway["retrieve"]>()
      .mockResolvedValueOnce({ status: "ok", view })
      .mockResolvedValueOnce({
        status: "ok",
        view: {
          ...view,
          originalSource: {
            type: "bug",
            problem: "Solde ancien",
            expectedBehavior: "Solde actuel",
          },
          currentSource: { type: "bug", problem: "Solde ancien" },
        },
      })
      .mockResolvedValueOnce({
        status: "ok",
        view: {
          ...view,
          originalSource: {
            type: "suggestion",
            proposal: "Vue mensuelle",
            rationale: "Comparer les périodes",
          },
          currentSource: {
            type: "suggestion",
            proposal: "Vue mensuelle",
            rationale: "Comparer les périodes",
          },
        },
      })
      .mockResolvedValueOnce({ status: "retryable" });
    renderApp(<App accountlessGateway={{ retrieve }} />);

    await user.type(screen.getByRole("textbox", { name: "Référence" }), view.reference);
    await user.type(screen.getByLabelText("Preuve d’accès"), proof);
    await user.click(screen.getByRole("button", { name: "Retrouver le retour" }));

    expect(screen.getByRole("heading", { name: "Votre retour" })).toBeInTheDocument();
    expect(screen.getByText("Rapide")).toBeInTheDocument();
    expect(screen.getByText("Interface claire")).toBeInTheDocument();
    expect(screen.getByText("Reçu")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Chercher un autre retour" }));
    await user.type(screen.getByRole("textbox", { name: "Référence" }), view.reference);
    await user.type(screen.getByLabelText("Preuve d’accès"), proof);
    await user.click(screen.getByRole("button", { name: "Retrouver le retour" }));
    expect(screen.getByText("Solde ancien")).toBeInTheDocument();
    expect(screen.getByText("Solde actuel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Chercher un autre retour" }));
    await user.type(screen.getByRole("textbox", { name: "Référence" }), view.reference);
    await user.type(screen.getByLabelText("Preuve d’accès"), proof);
    await user.click(screen.getByRole("button", { name: "Retrouver le retour" }));
    expect(screen.getByText("Vue mensuelle")).toBeInTheDocument();
    expect(screen.getByText("Comparer les périodes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Chercher un autre retour" }));
    await user.type(screen.getByRole("textbox", { name: "Référence" }), view.reference);
    await user.type(screen.getByLabelText("Preuve d’accès"), proof);
    await user.click(screen.getByRole("button", { name: "Retrouver le retour" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Le service est temporairement indisponible. Réessayez sans modifier vos informations.",
    );
  });

  it("fails closed for missing input, default unavailability, and gateway errors", async () => {
    window.history.replaceState({}, "", "/retrieve");
    const user = userEvent.setup();
    renderApp(<App />);

    await user.click(screen.getByRole("button", { name: "Retrouver le retour" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ces informations de retour ne permettent pas d’autoriser l’accès.",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Référence" }),
      "Y7-2026-000001",
    );
    await user.type(screen.getByLabelText("Preuve d’accès"), proof);
    await user.click(screen.getByRole("button", { name: "Retrouver le retour" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/temporairement indisponible/i);
    await user.click(screen.getByRole("button", { name: "English" }));
    await user.click(screen.getByRole("button", { name: "Français" }));

    cleanup();
    const retrieve = vi.fn<AccountlessGateway["retrieve"]>(() =>
      Promise.reject(new Error("network unavailable")),
    );
    render(<App accountlessGateway={{ retrieve }} />);
    await user.type(
      screen.getByRole("textbox", { name: "Référence" }),
      "Y7-2026-000001",
    );
    await user.type(screen.getByLabelText("Preuve d’accès"), proof);
    await user.click(screen.getByRole("button", { name: "Retrouver le retour" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/temporairement indisponible/i);
  });

  it("BDD-ISSUE-WEB-011 grants and revokes versioned publication consent with the retained proof", async () => {
    window.history.replaceState({}, "", "/retrieve");
    const user = userEvent.setup();
    const view: ReporterFeedbackView = {
      feedbackId: "feedback-1",
      reference: "Y7-2026-000001",
      originalSource: {
        type: "review",
        experience: "Rapide",
        appreciation: "Interface claire",
      },
      currentSource: {
        type: "review",
        experience: "Rapide",
        appreciation: "Interface claire",
      },
      currentState: "received",
      history: [],
      messages: [],
      attachments: [],
      sourceRevisions: [],
      deletionRequests: [],
    };
    const grant = vi.fn<PublicationConsentGateway["grant"]>(() =>
      Promise.resolve({
        status: "ok",
        consent: {
          version: 1,
          state: "active",
          disclosureVersion: "reporter-content-v1",
          audience: "github:123",
        },
      }),
    );
    const revoke = vi.fn<PublicationConsentGateway["revoke"]>(() =>
      Promise.resolve({
        status: "ok",
        consent: {
          version: 2,
          state: "revoked",
          disclosureVersion: "reporter-content-v1",
          audience: "github:123",
        },
      }),
    );
    renderApp(
      <App
        accountlessGateway={{ retrieve: () => Promise.resolve({ status: "ok", view }) }}
        createOperationId={() => "operation_1"}
        publicationConsentGateway={{ grant, revoke }}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: "Référence" }), view.reference);
    await user.type(screen.getByLabelText("Preuve d’accès"), proof);
    await user.click(screen.getByRole("button", { name: "Retrouver le retour" }));
    await user.type(
      screen.getByLabelText("Destination publique autorisée"),
      "github:123",
    );
    await user.click(
      screen.getByRole("button", { name: "Autoriser cette publication" }),
    );
    expect(grant).toHaveBeenCalledWith({
      operationId: "operation_1",
      reference: view.reference,
      proof,
      disclosureVersion: "reporter-content-v1",
      audience: "github:123",
    });
    expect(await screen.findByText("Autorisation active, version 1.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Révoquer l’autorisation" }));
    expect(revoke).toHaveBeenCalledWith({
      operationId: "operation_1",
      reference: view.reference,
      proof,
    });
    expect(await screen.findByText("Autorisation révoquée, version 2.")).toBeVisible();
  });
});
