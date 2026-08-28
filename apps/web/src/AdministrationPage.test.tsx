import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Locale } from "@y7-feedback/domain";

import { AdministrationPage } from "./AdministrationPage";
import type { AdministrationGateway } from "./AdministrationGateway";
import type { AdministrationSession } from "./AdministrationSession";

function setup(options?: {
  readonly signIn?: AdministrationSession["signIn"];
  readonly execute?: AdministrationGateway["execute"];
}) {
  const execute = vi.fn<AdministrationGateway["execute"]>(
    options?.execute ??
      (() => Promise.resolve({ status: "ok", project: { projectId: "project_1" } })),
  );
  const signIn = vi.fn<AdministrationSession["signIn"]>(
    options?.signIn ?? (() => Promise.resolve("authenticated")),
  );
  const signOut = vi.fn<AdministrationSession["signOut"]>(() => Promise.resolve());
  function Harness() {
    const [locale, setLocale] = useState<Locale>("fr");
    return (
      <AdministrationPage
        gateway={{ execute }}
        locale={locale}
        onLocaleChange={setLocale}
        session={{ createJwt: () => Promise.resolve("jwt"), signIn, signOut }}
      />
    );
  }
  render(<Harness />);
  return { execute, signIn, signOut };
}

async function authenticate(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Adresse e-mail"), "owner@example.test");
  await user.type(screen.getByLabelText("Mot de passe"), "password");
  await user.click(screen.getByRole("button", { name: "Se connecter" }));
  await screen.findByText(/Session active/u);
}

describe("Project administration experience", () => {
  it("BDD-ADMIN-002 denies invalid credentials without exposing SDK detail", async () => {
    const user = userEvent.setup();
    const target = setup({ signIn: () => Promise.resolve("denied") });
    await user.type(screen.getByLabelText("Adresse e-mail"), "owner@example.test");
    await user.type(screen.getByLabelText("Mot de passe"), "incorrect");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Accès refusé");
    expect(target.execute).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Mot de passe")).toHaveValue("");
  });

  it("preserves sign-in input while switching FR/EN", async () => {
    const user = userEvent.setup();
    setup();
    const email = screen.getByLabelText("Adresse e-mail");
    await user.type(email, "owner@example.test");
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByLabelText("Email address")).toHaveValue("owner@example.test");
  });

  it("BDD-ADMIN-001 submits a complete Project creation command", async () => {
    const user = userEvent.setup();
    const target = setup();
    await authenticate(user);
    await user.type(screen.getByLabelText("Identifiant du Workspace"), "workspace_1");
    await user.type(screen.getByLabelText("Identifiant du projet"), "project_1");
    await user.type(
      screen.getByLabelText("Identifiant unique de l’opération"),
      "operation_1",
    );
    await user.type(screen.getByLabelText("Slug du projet"), "wise-money");
    await user.type(
      screen.getByLabelText("But Reporter en français"),
      "Comprendre les retours",
    );
    await user.type(
      screen.getByLabelText("But Reporter en anglais"),
      "Understand feedback",
    );
    await user.click(screen.getByRole("button", { name: "Appliquer la commande" }));
    expect(target.execute).toHaveBeenCalledWith({
      kind: "create_project",
      workspaceId: "workspace_1",
      projectId: "project_1",
      operationId: "operation_1",
      slug: "wise-money",
      enabledTypes: ["bug", "suggestion", "review"],
      contextDeclarations: [],
      reporterPurpose: {
        fr: "Comprendre les retours",
        en: "Understand feedback",
      },
    });
    expect(await screen.findByText("Commande appliquée.")).toBeVisible();
  });

  it("BDD-ADMIN-006 builds a rename command and keeps values across locale changes", async () => {
    const user = userEvent.setup();
    const target = setup({
      execute: () => Promise.resolve({ status: "slug_reserved" }),
    });
    await authenticate(user);
    await user.selectOptions(screen.getByLabelText("Action"), "rename_project");
    await user.type(screen.getByLabelText("Identifiant du Workspace"), "workspace_1");
    await user.type(screen.getByLabelText("Identifiant du projet"), "project_1");
    await user.type(
      screen.getByLabelText("Identifiant unique de l’opération"),
      "operation_2",
    );
    await user.type(screen.getByLabelText("Slug du projet"), "new-slug");
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByLabelText("Project slug")).toHaveValue("new-slug");
    await user.click(screen.getByRole("button", { name: "Apply command" }));
    expect(target.execute).toHaveBeenCalledWith({
      kind: "rename_project",
      workspaceId: "workspace_1",
      projectId: "project_1",
      operationId: "operation_2",
      slug: "new-slug",
    });
    expect(await screen.findByText("This slug is already reserved.")).toBeVisible();
  });

  it("BDD-ADMIN-003,007,008 exposes configuration, activation and assignment commands", async () => {
    const user = userEvent.setup();
    const target = setup();
    await authenticate(user);
    await user.type(screen.getByLabelText("Identifiant du Workspace"), "workspace_1");
    await user.type(screen.getByLabelText("Identifiant du projet"), "project_1");
    const operation = screen.getByLabelText("Identifiant unique de l’opération");
    await user.type(operation, "operation_3");

    await user.selectOptions(screen.getByLabelText("Action"), "configure_project");
    const types = screen.getByLabelText("Types activés");
    await user.clear(types);
    await user.type(types, "bug,review");
    await user.type(screen.getByLabelText("But Reporter en français"), "But FR");
    await user.type(screen.getByLabelText("But Reporter en anglais"), "Purpose EN");
    await user.click(screen.getByRole("button", { name: "Appliquer la commande" }));
    expect(target.execute.mock.lastCall?.[0]).toMatchObject({
      kind: "configure_project",
      enabledTypes: ["bug", "review"],
    });

    await user.selectOptions(screen.getByLabelText("Action"), "set_project_activation");
    await user.click(screen.getByLabelText("Projet actif"));
    await user.click(screen.getByRole("button", { name: "Appliquer la commande" }));
    expect(target.execute.mock.lastCall?.[0]).toMatchObject({
      kind: "set_project_activation",
      active: false,
    });

    for (const kind of ["assign_maintainer", "remove_maintainer"] as const) {
      await user.selectOptions(screen.getByLabelText("Action"), kind);
      const maintainer = screen.getByLabelText("Identifiant du Maintainer");
      if (maintainer.getAttribute("value") === "") {
        await user.type(maintainer, "maintainer_1");
      }
      await user.click(screen.getByRole("button", { name: "Appliquer la commande" }));
      expect(target.execute.mock.lastCall?.[0]).toMatchObject({
        kind,
        maintainerId: "maintainer_1",
      });
    }
  });

  it("signs out the current session and returns to the credential form", async () => {
    const user = userEvent.setup();
    const target = setup();
    await authenticate(user);
    await user.click(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(target.signOut).toHaveBeenCalledOnce();
    expect(await screen.findByLabelText("Adresse e-mail")).toBeVisible();
  });
});
