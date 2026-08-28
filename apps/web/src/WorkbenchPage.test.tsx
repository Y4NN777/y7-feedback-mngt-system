import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Locale } from "@y7-feedback/domain";

import type { AdministrationSession } from "./AdministrationSession";
import type { NotificationInvalidation } from "./NotificationInvalidation";
import type { WorkbenchGateway } from "./WorkbenchGateway";
import { WorkbenchPage } from "./WorkbenchPage";

function setup(
  list?: WorkbenchGateway["list"],
  notifications?: WorkbenchGateway["notifications"],
  authorizeRealtime?: WorkbenchGateway["authorizeNotificationRealtime"],
) {
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
  const executeMock = vi.fn<WorkbenchGateway["execute"]>(() =>
    Promise.resolve({ status: "ok" as const, result: { status: "applied" } }),
  );
  const notificationsMock = vi.fn<WorkbenchGateway["notifications"]>(
    notifications ??
      (() =>
        Promise.resolve({
          status: "ok" as const,
          result: {
            unreadCount: 1,
            items: [
              {
                id: "notification_1",
                eventId: "event_1",
                feedbackId: "feedback_1",
                kind: "feedback_resolved" as const,
                reference: "Y7-NOTIFY-12345678",
                locale: "fr" as const,
                createdAt: "2026-08-28T10:04:00.000Z",
                readAt: null,
              },
            ],
          },
        })),
  );
  const markNotificationReadMock = vi.fn<WorkbenchGateway["markNotificationRead"]>(() =>
    Promise.resolve({
      status: "ok" as const,
      result: { status: "read" as const },
    }),
  );
  const subscribeMock = vi.fn<NotificationInvalidation["subscribe"]>(() =>
    Promise.resolve(() => Promise.resolve()),
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
    execute: executeMock,
    conversation: vi.fn(() =>
      Promise.resolve({
        status: "ok" as const,
        result: {
          feedbackId: "feedback_1",
          state: "received" as const,
          messages: [
            {
              id: "message_1",
              actorKind: "workspace" as const,
              audience: "reporter" as const,
              occurredAt: "2026-08-28T10:01:00.000Z",
              content: "Need details",
            },
          ],
          internalNotes: [
            {
              id: "note_1",
              actorKind: "workspace" as const,
              audience: "workspace" as const,
              occurredAt: "2026-08-28T10:02:00.000Z",
              content: "Internal evidence",
            },
          ],
          lifecycle: [
            {
              id: "fact_1",
              priorState: "received" as const,
              state: "under_review" as const,
              actorKind: "workspace" as const,
              occurredAt: "2026-08-28T10:03:00.000Z",
              reason: "Started",
              sequence: 2,
            },
          ],
        },
      }),
    ),
    notifications: notificationsMock,
    markNotificationRead: markNotificationReadMock,
    authorizeNotificationRealtime: vi.fn(
      authorizeRealtime ??
        (() =>
          Promise.resolve({
            status: "ok" as const,
            result: {
              databaseId: "feedback",
              tableId: "notification_signals",
            },
          })),
    ),
  };
  const signOutMock = vi.fn(() => Promise.resolve());
  const session: AdministrationSession = {
    createJwt: () => Promise.resolve("jwt_1"),
    signIn: vi.fn(() => Promise.resolve("authenticated" as const)),
    signOut: signOutMock,
  };
  function Harness() {
    const [locale, setLocale] = useState<Locale>("fr");
    return (
      <QueryClientProvider client={new QueryClient()}>
        <WorkbenchPage
          createOperationId={() => "operation_1"}
          gateway={gateway}
          locale={locale}
          notificationInvalidation={{ subscribe: subscribeMock }}
          onLocaleChange={setLocale}
          session={session}
        />
      </QueryClientProvider>
    );
  }
  const view = render(<Harness />);
  return {
    gateway,
    executeMock,
    listMock,
    markNotificationReadMock,
    notificationsMock,
    session,
    signOutMock,
    subscribeMock,
    unmount: view.unmount,
  };
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
    expect(await screen.findByText("Internal evidence")).toBeVisible();
    expect(screen.getByText("Need details")).toBeVisible();
    expect(screen.getByText("Started")).toBeVisible();
  });

  it("BDD-WORK-WEB-005 exposes an actionable retry state", async () => {
    const user = userEvent.setup();
    setup(() => Promise.resolve({ status: "retryable" }));
    await open(user);
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((alert) => alert.textContent.includes("indisponible"))).toBe(
      true,
    );
    expect(screen.getAllByRole("button", { name: "Réessayer" })).not.toHaveLength(0);
  });

  it("BDD-NOT-WEB-001 shows unread notifications and marks one read authoritatively", async () => {
    const user = userEvent.setup();
    const target = setup();
    await open(user);
    expect(await screen.findByText("Retour résolu")).toBeVisible();
    expect(screen.getByText("non lues").parentElement).toHaveTextContent("1 non lues");
    await user.click(screen.getByRole("button", { name: "Marquer comme lue" }));
    expect(target.markNotificationReadMock).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      projectId: "project_1",
      notificationId: "notification_1",
    });
    expect(target.notificationsMock).toHaveBeenCalledTimes(2);
    expect(target.subscribeMock).toHaveBeenCalledWith(
      { databaseId: "feedback", tableId: "notification_signals" },
      expect.any(Function),
    );
    target.subscribeMock.mock.calls[0]?.[1]();
    expect(target.notificationsMock).toHaveBeenCalledTimes(3);
    target.unmount();
  });

  it("shows notification retry and empty states without hiding the inbox", async () => {
    const user = userEvent.setup();
    const target = setup(undefined, () => Promise.resolve({ status: "retryable" }));
    await open(user);
    expect(
      await screen.findByText("Le service est indisponible. Réessayez."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(target.notificationsMock).toHaveBeenCalledTimes(2);

    target.notificationsMock.mockResolvedValue({
      status: "ok",
      result: { items: [], unreadCount: 0 },
    });
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Aucune notification.")).toBeVisible();
    expect(screen.getByText("feedback_1")).toBeVisible();
  });

  it("keeps polling when Realtime authorization is temporarily unavailable", async () => {
    const user = userEvent.setup();
    const target = setup(undefined, undefined, () =>
      Promise.resolve({ status: "retryable" }),
    );
    await open(user);
    expect(await screen.findByText("Retour résolu")).toBeVisible();
    expect(target.subscribeMock).not.toHaveBeenCalled();
  });

  it("BDD-WORK-WEB-006 executes classification only through the trusted gateway", async () => {
    const user = userEvent.setup();
    const target = setup();
    await open(user);
    await user.click(await screen.findByRole("button", { name: /feedback_1/u }));
    await screen.findByRole("heading", { name: "Upload fails" });
    await user.type(screen.getByLabelText("Nouvelle classification"), "Performance");
    await user.click(screen.getByRole("button", { name: "Classer" }));
    expect(target.executeMock).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
      command: {
        kind: "classify_feedback",
        classification: "Performance",
        operationId: "operation_1",
      },
    });
    expect(await screen.findByText("Action appliquée.")).toBeVisible();
  });

  it("supports all filters, assignment actions and sign-out", async () => {
    const user = userEvent.setup();
    const target = setup();
    await open(user);
    await screen.findByText("feedback_1");
    await user.selectOptions(screen.getByLabelText("Type"), "bug");
    await user.selectOptions(screen.getByLabelText("État"), "under_review");
    await user.click(screen.getByRole("button", { name: /feedback_1/u }));
    await screen.findByRole("heading", { name: "Upload fails" });
    await user.type(screen.getByLabelText("Identifiant du Maintainer"), "maintainer_1");
    await user.click(screen.getByRole("button", { name: "Assigner" }));
    await user.click(screen.getByRole("button", { name: "Retirer l’attribution" }));
    await user.click(screen.getByRole("button", { name: "Supprimer le Feedback" }));
    expect(target.executeMock).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole("button", { name: "Retour à la boîte" }));
    await user.click(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(target.signOutMock).toHaveBeenCalled();
    expect(await screen.findByLabelText("Adresse e-mail")).toBeVisible();
  });
});
