import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdministrationSession } from "./AdministrationSession";
import type { IntelligenceGateway } from "./IntelligenceGateway";
import { IntelligencePage } from "./IntelligencePage";

const session: AdministrationSession = {
  signIn: vi.fn(() => Promise.resolve("authenticated" as const)),
  signOut: vi.fn(() => Promise.resolve()),
  createJwt: vi.fn(() => Promise.resolve("jwt")),
};

describe("Intelligence experience", () => {
  it("BDD-INT-212 preserves entered scope across locale changes", async () => {
    const user = userEvent.setup();
    const gateway: IntelligenceGateway = {
      analyze: vi.fn(),
      mutate: vi.fn(),
    };
    const onLocaleChange = vi.fn();
    const view = render(
      <IntelligencePage
        gateway={gateway}
        locale="fr"
        onLocaleChange={onLocaleChange}
        session={session}
      />,
    );
    await user.type(screen.getByLabelText("Adresse e-mail"), "owner@example.test");
    await user.type(screen.getByLabelText("Mot de passe"), "secret-value");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    const workspace = await screen.findByLabelText("Workspace");
    await user.type(workspace, "workspace_1");
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(onLocaleChange).toHaveBeenCalledWith("en");
    view.rerender(
      <IntelligencePage
        gateway={gateway}
        locale="en"
        onLocaleChange={onLocaleChange}
        session={session}
      />,
    );
    expect(screen.getByLabelText("Workspace")).toHaveValue("workspace_1");
  });

  it("BDD-INT-213 submits scoped filters and renders explicit empty trend semantics", async () => {
    const user = userEvent.setup();
    const analyze = vi.fn<IntelligenceGateway["analyze"]>(() =>
      Promise.resolve({
        status: "ok",
        result: {
          ids: [],
          nextCursor: null,
          aggregate: {
            total: 0,
            byType: { bug: 0, suggestion: 0, review: 0 },
            byState: {
              received: 0,
              under_review: 0,
              awaiting_reporter: 0,
              resolved: 0,
              closed: 0,
            },
          },
          trend: {
            currentCount: 0,
            baselineCount: 0,
            changePercent: null,
            direction: "empty",
          },
        },
      }),
    );
    render(
      <IntelligencePage
        gateway={{ analyze, mutate: vi.fn() }}
        locale="en"
        onLocaleChange={vi.fn()}
        session={session}
      />,
    );
    await user.type(screen.getByLabelText("Email address"), "owner@example.test");
    await user.type(screen.getByLabelText("Password"), "secret-value");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.type(await screen.findByLabelText("Workspace"), "workspace_1");
    await user.type(screen.getByLabelText("Project"), "project_1");
    await user.type(screen.getByLabelText("Types (comma-separated)"), "bug, review");
    await user.type(screen.getByLabelText("States (comma-separated)"), "received");
    await user.type(screen.getByLabelText("Reporters (comma-separated)"), "external");
    await user.type(screen.getByLabelText("Versions (comma-separated)"), "2.1.0");
    await user.type(screen.getByLabelText("Places (comma-separated)"), "checkout");
    await user.type(screen.getByLabelText("Features (comma-separated)"), "billing");
    await user.type(screen.getByLabelText("Reviewed context name"), "feature");
    await user.type(screen.getByLabelText("Reviewed context value"), "billing");
    await user.type(
      screen.getByLabelText("Filter start (UTC ISO)"),
      "2026-08-01T00:00:00.000Z",
    );
    await user.type(
      screen.getByLabelText("Filter end (UTC ISO)"),
      "2026-09-01T00:00:00.000Z",
    );
    await user.type(
      screen.getByLabelText("Current window — start"),
      "2026-08-25T00:00:00.000Z",
    );
    await user.type(
      screen.getByLabelText("Current window — end"),
      "2026-09-01T00:00:00.000Z",
    );
    await user.type(
      screen.getByLabelText("Baseline — start"),
      "2026-08-18T00:00:00.000Z",
    );
    await user.type(
      screen.getByLabelText("Baseline — end"),
      "2026-08-25T00:00:00.000Z",
    );
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    const input = analyze.mock.calls[0]?.[0];
    expect(input?.workspaceId).toBe("workspace_1");
    expect(input?.projectId).toBe("project_1");
    expect(input?.filter.types).toEqual(["bug", "review"]);
    expect(input?.filter.reviewedContext).toEqual({ feature: "billing" });
    expect(input?.trendWindow).toEqual({
      current: {
        from: "2026-08-25T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
      },
      baseline: {
        from: "2026-08-18T00:00:00.000Z",
        to: "2026-08-25T00:00:00.000Z",
      },
    });
    expect(await screen.findByText("No feedback matches these filters.")).toBeVisible();
    expect(screen.getByText("empty")).toBeVisible();
  }, 15_000);

  it("BDD-INT-214 exposes safe denial feedback", async () => {
    const user = userEvent.setup();
    render(
      <IntelligencePage
        gateway={{ analyze: vi.fn(), mutate: vi.fn() }}
        locale="en"
        onLocaleChange={vi.fn()}
        session={{ ...session, signIn: () => Promise.resolve("denied") }}
      />,
    );
    await user.type(screen.getByLabelText("Email address"), "owner@example.test");
    await user.type(screen.getByLabelText("Password"), "wrong-value");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This scope is not accessible.",
    );
  }, 15_000);

  it("BDD-INT-215 exposes stable analysis failures after authentication", async () => {
    const user = userEvent.setup();
    render(
      <IntelligencePage
        gateway={{
          analyze: () => Promise.resolve({ status: "invalid" }),
          mutate: () => Promise.resolve({ status: "retryable" }),
        }}
        locale="en"
        onLocaleChange={vi.fn()}
        session={session}
      />,
    );
    await user.type(screen.getByLabelText("Email address"), "owner@example.test");
    await user.type(screen.getByLabelText("Password"), "secret-value");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.type(await screen.findByLabelText("Workspace"), "workspace_1");
    await user.type(screen.getByLabelText("Project"), "project_1");
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The filters or windows are invalid.",
    );
  });

  it("BDD-INT-324 creates attributable themes and preserves form state across locale changes", async () => {
    const user = userEvent.setup();
    const mutate = vi.fn<IntelligenceGateway["mutate"]>(() =>
      Promise.resolve({
        status: "ok",
        result: {
          disposition: "applied",
          associationId: "association_1",
          eventId: "event_1",
          revision: 1,
        },
      }),
    );
    const onLocaleChange = vi.fn();
    const { rerender } = render(
      <IntelligencePage
        gateway={{ analyze: vi.fn(), mutate }}
        locale="fr"
        onLocaleChange={onLocaleChange}
        session={session}
      />,
    );
    await user.type(screen.getByLabelText("Adresse e-mail"), "owner@example.test");
    await user.type(screen.getByLabelText("Mot de passe"), "secret-value");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    await user.type(screen.getByLabelText("Workspace"), "workspace_1");
    await user.type(screen.getByLabelText("Projet"), "project_1");
    await user.type(screen.getByLabelText("Identifiant du retour"), "feedback_1");
    await user.type(screen.getByLabelText("Thème"), "Paiement");
    await user.click(
      screen.getByRole("button", { name: "Enregistrer avec provenance" }),
    );
    const mutation = mutate.mock.calls[0]?.[0];
    expect(mutation?.workspaceId).toBe("workspace_1");
    expect(mutation?.projectId).toBe("project_1");
    expect(mutation?.command).toMatchObject({
      kind: "record_theme",
      feedbackId: "feedback_1",
      label: "Paiement",
    });
    expect(typeof mutation?.command.operationId).toBe("string");
    expect(await screen.findByText("association_1")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Action"), "correct_theme");
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(onLocaleChange).toHaveBeenCalledWith("en");
    rerender(
      <IntelligencePage
        gateway={{ analyze: vi.fn(), mutate }}
        locale="en"
        onLocaleChange={onLocaleChange}
        session={session}
      />,
    );
    expect(screen.getByLabelText("Theme")).toHaveValue("Paiement");
    expect(screen.getByLabelText("Association ID")).toHaveValue("association_1");
  });
});
