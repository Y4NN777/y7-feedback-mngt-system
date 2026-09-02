import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ConversationGateway } from "./ConversationGateway";
import { ReporterConversation } from "./ReporterConversation";

const waiting = {
  feedbackId: "feedback_1",
  state: "awaiting_reporter" as const,
  messages: [
    {
      id: "message_1",
      actorKind: "workspace" as const,
      audience: "reporter" as const,
      occurredAt: "2026-08-28T12:00:00.000Z",
      content: "Quelle version est concernée ?",
      provider: "github" as const,
      revisionKind: "revised" as const,
      supersedesMessageId: "message_0",
    },
  ],
  lifecycle: [
    {
      id: "event_1",
      priorState: "under_review" as const,
      state: "awaiting_reporter" as const,
      actorKind: "workspace" as const,
      occurredAt: "2026-08-28T12:01:00.000Z",
      reason: "Version requise",
      sequence: 3,
    },
  ],
};

function renderConversation(gateway: ConversationGateway, locale: "fr" | "en" = "fr") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReporterConversation
        createOperationId={vi
          .fn()
          .mockReturnValueOnce("message_2")
          .mockReturnValueOnce("event_2")}
        feedbackId="feedback_1"
        gateway={gateway}
        locale={locale}
        proof="secret-proof"
        reference="Y7-2026-ABC"
      />
    </QueryClientProvider>,
  );
}

describe("Reporter Conversation experience", () => {
  it("shows only Reporter-safe messages and performs answer plus lifecycle transition", async () => {
    const user = userEvent.setup();
    const retrieve = vi
      .fn<ConversationGateway["retrieve"]>()
      .mockResolvedValueOnce({ status: "ok", value: waiting })
      .mockResolvedValue({
        status: "ok",
        value: { ...waiting, state: "under_review", messages: [] },
      });
    const execute = vi.fn<ConversationGateway["execute"]>(() =>
      Promise.resolve({ status: "ok", value: "applied" }),
    );
    renderConversation({ retrieve, execute });

    expect(
      await screen.findByRole("heading", { name: "Conversation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Quelle version est concernée ?")).toBeInTheDocument();
    expect(screen.getByText("GitHub · Révision importée")).toBeInTheDocument();
    expect(screen.queryByText(/note interne/i)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Votre réponse" }), "2.1");
    await user.click(screen.getByRole("button", { name: "Envoyer la réponse" }));

    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });
    expect(execute.mock.calls[0]?.[0].command).toEqual({
      kind: "append_message",
      eventId: "message_2",
      audience: "reporter",
      content: "2.1",
    });
    expect(execute.mock.calls[1]?.[0].command).toEqual({
      kind: "reporter_answer",
      eventId: "event_2",
      expectedVersion: 3,
      reason: "2.1",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Réponse enregistrée.");
  });

  it("preserves draft during locale change and exposes non-color status wording", async () => {
    const user = userEvent.setup();
    const gateway: ConversationGateway = {
      retrieve: () => Promise.resolve({ status: "ok", value: waiting }),
      execute: () => Promise.resolve({ status: "ok", value: "applied" }),
    };
    const rendered = renderConversation(gateway);
    const input = await screen.findByRole("textbox", { name: "Votre réponse" });
    await user.type(input, "Version 2.1");
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ReporterConversation
          createOperationId={() => "operation_1"}
          feedbackId="feedback_1"
          gateway={gateway}
          locale="en"
          proof="secret-proof"
          reference="Y7-2026-ABC"
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("textbox", { name: "Your answer" })).toHaveValue(
      "Version 2.1",
    );
    expect(screen.getAllByText("Waiting for information")).toHaveLength(2);
  });

  it("handles denial, retry and stale conflict without revealing existence", async () => {
    const denied: ConversationGateway = {
      retrieve: () => Promise.resolve({ status: "denied" }),
      execute: () => Promise.resolve({ status: "retryable" }),
    };
    const deniedView = renderConversation(denied);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La preuve ne permet pas d’accéder à cette conversation.",
    );
    deniedView.unmount();

    const user = userEvent.setup();
    const conflict: ConversationGateway = {
      retrieve: () => Promise.resolve({ status: "ok", value: waiting }),
      execute: () => Promise.resolve({ status: "conflict" }),
    };
    renderConversation(conflict);
    await user.type(
      await screen.findByRole("textbox", { name: "Votre réponse" }),
      "2.1",
    );
    await user.click(screen.getByRole("button", { name: "Envoyer la réponse" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("L’état a changé.");
  });

  it("reopens closed Feedback without appending a duplicate Message", async () => {
    const user = userEvent.setup();
    const execute = vi.fn<ConversationGateway["execute"]>(() =>
      Promise.resolve({ status: "ok", value: "applied" }),
    );
    renderConversation({
      retrieve: () =>
        Promise.resolve({
          status: "ok",
          value: { ...waiting, state: "closed" },
        }),
      execute,
    });
    await user.type(
      await screen.findByRole("textbox", { name: "Votre réponse" }),
      "Le problème persiste",
    );
    await user.click(screen.getByRole("button", { name: "Rouvrir le retour" }));
    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    expect(execute.mock.calls[0]?.[0].command).toMatchObject({ kind: "reopen" });
  });

  it("reports unavailable reads and transition retries", async () => {
    const unavailable = renderConversation({
      retrieve: () => Promise.resolve({ status: "retryable" }),
      execute: () => Promise.resolve({ status: "retryable" }),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La conversation est temporairement indisponible.",
    );
    unavailable.unmount();

    const user = userEvent.setup();
    const execute = vi
      .fn<ConversationGateway["execute"]>()
      .mockResolvedValueOnce({ status: "ok", value: "applied" })
      .mockResolvedValueOnce({ status: "retryable" });
    renderConversation({
      retrieve: () => Promise.resolve({ status: "ok", value: waiting }),
      execute,
    });
    await user.type(
      await screen.findByRole("textbox", { name: "Votre réponse" }),
      "2.1",
    );
    await user.click(screen.getByRole("button", { name: "Envoyer la réponse" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vous pouvez réessayer sans créer de doublon.",
    );
  });
});
