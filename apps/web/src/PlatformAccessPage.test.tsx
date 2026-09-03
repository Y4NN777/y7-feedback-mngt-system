import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlatformAccessPage } from "./PlatformAccessPage";
import type { PlatformAccessOutcome } from "./PlatformAccessGateway";

function setup(
  outcome: PlatformAccessOutcome = {
    status: "ok",
    result: {
      disposition: "applied",
      grantId: "grant_1",
      state: "requested",
      revision: 0,
    },
  },
) {
  const execute = vi.fn((command: Readonly<Record<string, unknown>>) => {
    void command;
    return Promise.resolve(outcome);
  });
  const signIn = vi.fn(() => Promise.resolve("authenticated" as const));
  const signOut = vi.fn(() => Promise.resolve());
  const onLocaleChange = vi.fn();
  const view = render(
    <PlatformAccessPage
      gateway={{ execute }}
      locale="fr"
      onLocaleChange={onLocaleChange}
      session={{ createJwt: vi.fn(), signIn, signOut }}
    />,
  );
  return { execute, onLocaleChange, signIn, signOut, view };
}

async function authenticate() {
  fireEvent.change(screen.getByLabelText("Adresse e-mail"), {
    target: { value: "operator@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Mot de passe"), {
    target: { value: "password" },
  });
  const form = screen.getByRole("button", { name: "Se connecter" }).closest("form");
  if (!form) throw new Error("form unavailable");
  fireEvent.submit(form);
  await screen.findByText("Session Platform active.");
}

describe("Platform exceptional access screen", () => {
  it("BDD-PLAT-230 signs in and submits a scoped critical request", async () => {
    const candidate = setup();
    await authenticate();
    fireEvent.change(screen.getByLabelText("Identifiant du grant"), {
      target: { value: "grant_1" },
    });
    fireEvent.change(screen.getByLabelText("Identifiant du workspace"), {
      target: { value: "workspace_1" },
    });
    fireEvent.change(screen.getByLabelText("Identifiant du projet (facultatif)"), {
      target: { value: "project_1" },
    });
    fireEvent.change(screen.getByLabelText("Identifiant du feedback (facultatif)"), {
      target: { value: "feedback_1" },
    });
    fireEvent.change(screen.getByLabelText("Capacité autorisée"), {
      target: { value: "internal_note.read" },
    });
    fireEvent.change(screen.getByLabelText("Justification"), {
      target: { value: "Critical customer incident investigation" },
    });
    fireEvent.change(screen.getByLabelText("Sévérité de l’incident"), {
      target: { value: "critical" },
    });
    fireEvent.click(screen.getByLabelText("Accès break-glass critique"));
    fireEvent.click(screen.getByRole("button", { name: "Exécuter la commande" }));
    await waitFor(() => {
      expect(candidate.execute).toHaveBeenCalledWith({
        kind: "request",
        grantId: "grant_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        actions: ["internal_note.read"],
        reasonCode: "INCIDENT_RESPONSE",
        justification: "Critical customer incident investigation",
        incidentSeverity: "critical",
        breakGlass: true,
      });
    });
    expect(await screen.findByText("Commande appliquée.")).toBeInTheDocument();
    expect(candidate.signIn).toHaveBeenCalledWith("operator@example.test", "password");
  });

  it("BDD-PLAT-231 preserves entered grant state while switching locale", async () => {
    const candidate = setup();
    await authenticate();
    fireEvent.change(screen.getByLabelText("Identifiant du grant"), {
      target: { value: "grant_preserved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(candidate.onLocaleChange).toHaveBeenCalledWith("en");
    expect(screen.getByLabelText("Identifiant du grant")).toHaveValue(
      "grant_preserved",
    );
  });

  it("BDD-PLAT-232 submits approve, use and terminal transition commands", async () => {
    const candidate = setup({
      status: "ok",
      result: {
        disposition: "replayed",
        grantId: "grant_1",
        state: "active",
        revision: 1,
        content: {
          kind: "feedback",
          feedback: { feedbackId: "feedback_1", state: "received" },
        },
      },
    });
    await authenticate();
    const action = screen.getByLabelText("Action");
    fireEvent.change(action, { target: { value: "approve" } });
    fireEvent.change(screen.getByLabelText("Identifiant du grant"), {
      target: { value: "grant_1" },
    });
    fireEvent.change(screen.getByLabelText("Révision attendue"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Expiration (maximum une heure)"), {
      target: { value: "2026-09-03T13:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Exécuter la commande" }));
    await waitFor(() => {
      expect(candidate.execute).toHaveBeenCalledTimes(1);
    });
    expect(candidate.execute).toHaveBeenLastCalledWith({
      kind: "approve",
      grantId: "grant_1",
      expectedRevision: 0,
      expiresAt: "2026-09-03T13:30:00.000Z",
    });
    expect(screen.getAllByRole("status").at(-1)).toHaveTextContent(
      "Commande déjà appliquée ; résultat rejoué.",
    );
    expect(screen.getByText("Résultat protégé autorisé")).toBeInTheDocument();
    expect(screen.getByText(/feedback_1/u)).toBeInTheDocument();

    fireEvent.change(action, { target: { value: "use" } });
    fireEvent.change(screen.getByLabelText("Identifiant du workspace"), {
      target: { value: "workspace_1" },
    });
    fireEvent.change(screen.getByLabelText("Identifiant du projet (facultatif)"), {
      target: { value: "project_1" },
    });
    fireEvent.change(screen.getByLabelText("Identifiant du feedback (facultatif)"), {
      target: { value: "feedback_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Exécuter la commande" }));
    await waitFor(() => {
      expect(candidate.execute).toHaveBeenCalledTimes(2);
    });
    const useCommand = candidate.execute.mock.calls.at(-1)?.[0];
    expect(typeof useCommand?.operationId).toBe("string");
    expect(useCommand).toMatchObject({
      kind: "use",
      grantId: "grant_1",
      expectedRevision: 0,
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
      action: "feedback.read",
    });

    for (const terminal of ["deny", "revoke", "review"] as const) {
      fireEvent.change(action, { target: { value: terminal } });
      fireEvent.click(screen.getByRole("button", { name: "Exécuter la commande" }));
    }
    await waitFor(() => {
      expect(candidate.execute).toHaveBeenCalledTimes(5);
    });
    expect(candidate.execute).toHaveBeenLastCalledWith({
      kind: "review",
      grantId: "grant_1",
      expectedRevision: 0,
    });
  });

  it("BDD-PLAT-233 reports denial and signs out without retaining command status", async () => {
    const candidate = setup({ status: "denied" });
    await authenticate();
    fireEvent.change(screen.getByLabelText("Identifiant du grant"), {
      target: { value: "grant_1" },
    });
    fireEvent.change(screen.getByLabelText("Identifiant du workspace"), {
      target: { value: "workspace_1" },
    });
    fireEvent.change(screen.getByLabelText("Justification"), {
      target: { value: "Investigating a customer incident" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Exécuter la commande" }));
    await screen.findByText("Accès refusé.");
    fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
    await screen.findByRole("button", { name: "Se connecter" });
    expect(candidate.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByText("Accès refusé.")).not.toBeInTheDocument();
  });
});
