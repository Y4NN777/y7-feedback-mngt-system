import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Locale } from "@y7-feedback/domain";

import type { AdministrationSession } from "./AdministrationSession";
import type { WorkbenchGateway } from "./WorkbenchGateway";
import { WorkbenchPage } from "./WorkbenchPage";

function setup(list?: WorkbenchGateway["list"]) {
  const listMock = vi.fn<WorkbenchGateway["list"]>(
    list ??
      (() =>
        Promise.resolve({
          status: "ok" as const,
          result: [
            {
              feedbackId: "feedback_1",
              type: "bug" as const,
              state: "received" as const,
              acceptedAt: "2026-08-28T10:00:00.000Z",
              assignedPrincipalIds: [],
            },
          ],
        })),
  );
  const gateway: WorkbenchGateway = {
    list: listMock,
    read: vi.fn(() =>
      Promise.resolve({
        status: "ok" as const,
        result: {
          feedbackId: "feedback_1",
          type: "bug" as const,
          state: "received" as const,
          acceptedAt: "2026-08-28T10:00:00.000Z",
          assignedPrincipalIds: [],
          source: { type: "bug" as const, problem: "Upload fails" },
          context: [],
          attachmentNames: [],
          classification: null,
          assignedMaintainerId: null,
        },
      }),
    ),
  };
  const session: AdministrationSession = {
    createJwt: () => Promise.resolve("jwt_1"),
    signIn: vi.fn(() => Promise.resolve("authenticated" as const)),
    signOut: vi.fn(() => Promise.resolve()),
  };
  function Harness() {
    const [locale, setLocale] = useState<Locale>("fr");
    return (
      <QueryClientProvider client={new QueryClient()}>
        <WorkbenchPage
          gateway={gateway}
          locale={locale}
          onLocaleChange={setLocale}
          session={session}
        />
      </QueryClientProvider>
    );
  }
  render(<Harness />);
  return { gateway, listMock, session };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Adresse e-mail"), "owner@example.test");
  await user.type(screen.getByLabelText("Mot de passe"), "password");
  await user.click(screen.getByRole("button", { name: "Se connecter" }));
  await user.type(screen.getByLabelText("Identifiant du Workspace"), "workspace_1");
  await user.type(screen.getByLabelText("Identifiant du projet"), "project_1");
  await user.click(screen.getByRole("button", { name: "Ouvrir la boîte" }));
}

describe("Workbench experience", () => {
  it("BDD-WORK-WEB-003 preserves credentials across FR/EN", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Adresse e-mail"), "owner@example.test");
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByLabelText("Email address")).toHaveValue("owner@example.test");
  });

  it("BDD-WORK-WEB-004 lists, filters and opens an authorized detail", async () => {
    const user = userEvent.setup();
    const target = setup();
    await open(user);
    expect(await screen.findByText("feedback_1")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Attribution"), "unassigned");
    expect(target.listMock.mock.lastCall?.[0]).toEqual({
      workspaceId: "workspace_1",
      projectId: "project_1",
      filter: { types: [], states: [], assignment: "unassigned" },
    });
    await user.click(screen.getByRole("button", { name: /feedback_1/u }));
    expect(await screen.findByRole("heading", { name: "Upload fails" })).toBeVisible();
    expect(screen.getByText("Aucune pièce jointe")).toBeVisible();
  });

  it("BDD-WORK-WEB-005 exposes an actionable retry state", async () => {
    const user = userEvent.setup();
    setup(() => Promise.resolve({ status: "retryable" }));
    await open(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("indisponible");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeVisible();
  });
});
