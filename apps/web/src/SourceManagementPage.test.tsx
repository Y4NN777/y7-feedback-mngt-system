import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceManagementPage } from "./SourceManagementPage";
import type { SourceManagementView } from "./SourceManagementGateway";

const managed = {
  projectSlug: "wise-money",
  pendingSelections: [
    {
      id: "connection_2",
      provider: "gitlab" as const,
      authorizedRepositories: [
        { provider: "gitlab" as const, id: "repo_2" },
        { provider: "gitlab" as const, id: "repo_3" },
      ],
      updatedAt: "2026-08-28T16:00:00.000Z",
    },
  ],
  connections: [
    {
      id: "connection_1",
      provider: "github" as const,
      state: "active" as const,
      selectedRepositories: [{ provider: "github" as const, id: "repo_1" }],
      importedRepositories: [
        {
          connectionId: "connection_1",
          provider: "github" as const,
          repositoryId: "repo_1",
          name: "y7-feedback-mngt-system",
          owner: "Y4NN777",
          visibility: "private" as const,
          webUrl: "https://github.com/Y4NN777/y7-feedback-mngt-system",
          defaultBranch: "main",
          observedAt: "2026-08-28T16:00:00.000Z",
          releases: [
            {
              providerReleaseId: "release_1",
              tag: "v1.0.0",
              name: "Version 1",
              publishedAt: "2026-08-28T15:00:00.000Z",
              webUrl:
                "https://github.com/Y4NN777/y7-feedback-mngt-system/releases/tag/v1.0.0",
              observedAt: "2026-08-28T16:00:00.000Z",
            },
          ],
        },
      ],
      updatedAt: "2026-08-28T16:00:00.000Z",
    },
  ],
};

function setup(view: SourceManagementView = managed) {
  const gateway = {
    list: vi.fn(() => Promise.resolve({ status: "ok" as const, result: view })),
    begin: vi.fn(() =>
      Promise.resolve({
        status: "ok" as const,
        result: { authorizationUrl: "https://github.com/login/oauth" },
      }),
    ),
    select: vi.fn(() => Promise.resolve({ status: "ok" as const, result: undefined })),
    refresh: vi.fn(() => Promise.resolve({ status: "ok" as const, result: undefined })),
    disconnect: vi.fn(() =>
      Promise.resolve({ status: "ok" as const, result: undefined }),
    ),
  };
  const session = {
    createJwt: vi.fn(() => Promise.resolve("jwt")),
    signIn: vi.fn(() => Promise.resolve("authenticated" as const)),
    signOut: vi.fn(() => Promise.resolve()),
  };
  const copyText = vi.fn(() => Promise.resolve());
  const openAuthorization = vi.fn();
  const onLocaleChange = vi.fn();
  render(
    <SourceManagementPage
      copyText={copyText}
      gateway={gateway}
      locale="fr"
      onLocaleChange={onLocaleChange}
      openAuthorization={openAuthorization}
      publicOrigin="https://feedback.y7labs.dev"
      session={session}
    />,
  );
  return { copyText, gateway, onLocaleChange, openAuthorization, session };
}

async function authenticateAndLoad() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Adresse e-mail"), "owner@example.test");
  await user.type(screen.getByLabelText("Mot de passe"), "secret");
  await user.click(screen.getByRole("button", { name: "Se connecter" }));
  await user.type(screen.getByLabelText("Workspace ID"), "workspace_1");
  await user.type(screen.getByLabelText("Project ID"), "project_1");
  await user.click(screen.getByRole("button", { name: "Afficher les sources" }));
  await screen.findByText("Y4NN777/y7-feedback-mngt-system");
  return user;
}

afterEach(cleanup);

describe("source management page", () => {
  it("BDD-SRC-216 renders health, provenance, releases and canonical badge", async () => {
    const { copyText } = setup();
    const user = await authenticateAndLoad();

    expect(screen.getByText("Active", { selector: "h2" })).toBeVisible();
    expect(screen.getByText("Propriétaire: Y4NN777")).toBeVisible();
    expect(screen.getByRole("link", { name: "Version 1" })).toHaveAttribute(
      "href",
      expect.stringContaining("/releases/tag/v1.0.0"),
    );
    expect(
      screen.getByRole("link", { name: "https://feedback.y7labs.dev/wise-money" }),
    ).toBeVisible();
    expect(screen.getByText(/Aucun fichier modifié/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Copier le badge Markdown" }));
    expect(copyText).toHaveBeenCalledWith(
      expect.stringContaining("https://feedback.y7labs.dev/wise-money"),
    );
    expect(await screen.findByText("Badge copié.")).toHaveAttribute("role", "status");
  });

  it("BDD-SRC-217 selects, refreshes, disconnects and starts both providers", async () => {
    const { gateway, openAuthorization } = setup();
    const user = await authenticateAndLoad();

    await user.click(screen.getByRole("checkbox", { name: "repo_2" }));
    await user.click(screen.getByRole("checkbox", { name: "repo_2" }));
    await user.click(screen.getByRole("checkbox", { name: "repo_3" }));
    await user.click(screen.getByRole("button", { name: "Confirmer la sélection" }));
    await waitFor(() => {
      expect(gateway.select).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: "connection_2",
          repositoryIds: ["repo_3"],
        }),
      );
    });
    await user.click(screen.getByRole("button", { name: "Actualiser" }));
    await waitFor(() => {
      expect(gateway.refresh).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: "connection_1",
          repositoryId: "repo_1",
        }),
      );
    });
    await user.click(screen.getByRole("button", { name: "Déconnecter" }));
    await waitFor(() => {
      expect(gateway.disconnect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: "connection_1" }),
      );
    });
    await user.click(screen.getByRole("button", { name: "Connecter GitHub" }));
    await user.click(screen.getByRole("button", { name: "Connecter GitLab" }));
    expect(gateway.begin).toHaveBeenCalledTimes(2);
    expect(openAuthorization).toHaveBeenCalledWith("https://github.com/login/oauth");
  });

  it("BDD-SRC-218 preserves scope fields across locale changes and fails visibly", async () => {
    const { gateway, onLocaleChange, session } = setup();
    const user = userEvent.setup();
    session.signIn.mockResolvedValueOnce("denied" as never);
    await user.type(screen.getByLabelText("Adresse e-mail"), "wrong@example.test");
    await user.type(screen.getByLabelText("Mot de passe"), "wrong");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("pas autorisée");

    await user.type(screen.getByLabelText("Mot de passe"), "right");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    await user.type(screen.getByLabelText("Workspace ID"), "workspace_1");
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(onLocaleChange).toHaveBeenCalledWith("en");
    expect(screen.getByLabelText("Workspace ID")).toHaveValue("workspace_1");

    gateway.list.mockResolvedValueOnce({ status: "retryable" } as never);
    await user.type(screen.getByLabelText("Project ID"), "project_1");
    await user.click(screen.getByRole("button", { name: "Afficher les sources" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("indisponible");
  });

  it("renders disconnected health, empty releases and clears state on sign-out", async () => {
    const activeConnection = managed.connections[0];
    const importedRepository = activeConnection?.importedRepositories[0];
    if (!activeConnection || !importedRepository) throw new Error("FIXTURE_INVALID");
    const disconnected: SourceManagementView = {
      projectSlug: "wise-money",
      pendingSelections: [],
      connections: [
        {
          ...activeConnection,
          state: "disconnected",
          importedRepositories: [{ ...importedRepository, releases: [] }],
        },
      ],
    };
    const { gateway, session } = setup(disconnected);
    const user = await authenticateAndLoad();
    expect(screen.getByText("Déconnectée", { selector: "h2" })).toBeVisible();
    expect(screen.getByText("Aucune release importée")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Actualiser" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Déconnecter" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Se déconnecter" }));
    await waitFor(() => {
      expect(session.signOut).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeVisible();
    expect(gateway.list).toHaveBeenCalledOnce();
  });

  it("reports denied OAuth and retryable mutations without hiding the scoped view", async () => {
    const { gateway } = setup();
    const user = await authenticateAndLoad();
    gateway.begin.mockResolvedValueOnce({ status: "denied" } as never);
    await user.click(screen.getByRole("button", { name: "Connecter GitHub" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("pas autorisée");

    gateway.select.mockResolvedValueOnce({ status: "retryable" } as never);
    await user.click(screen.getByRole("checkbox", { name: "repo_2" }));
    await user.click(screen.getByRole("button", { name: "Confirmer la sélection" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("indisponible");
    });
    expect(screen.getByText("Y4NN777/y7-feedback-mngt-system")).toBeVisible();
  });
});
