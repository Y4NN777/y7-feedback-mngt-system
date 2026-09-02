import { useQuery } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";

import type { Locale } from "@y7-feedback/domain";

import type { ConversationGateway } from "./ConversationGateway";
import { conversationMessages } from "./i18n/conversation";

export function ReporterConversation({
  createOperationId,
  feedbackId,
  gateway,
  locale,
  proof,
  reference,
}: {
  readonly createOperationId: () => string;
  readonly feedbackId: string;
  readonly gateway: ConversationGateway;
  readonly locale: Locale;
  readonly proof: string;
  readonly reference: string;
}) {
  const copy = conversationMessages[locale];
  const [draft, setDraft] = useState("");
  const [submission, setSubmission] = useState<
    "idle" | "pending" | "sent" | "conflict" | "retryable"
  >("idle");
  const query = useQuery({
    queryKey: ["reporter-conversation", feedbackId],
    queryFn: () => gateway.retrieve({ feedbackId, reference, proof }),
    retry: false,
    staleTime: 0,
  });
  const projection = query.data?.status === "ok" ? query.data.value : undefined;
  const version = projection?.lifecycle.at(-1)?.sequence ?? 1;
  const canAnswer = projection?.state === "awaiting_reporter";
  const canReopen = projection?.state === "closed";

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const answer = draft.trim();
    if ((!canAnswer && !canReopen) || !answer || submission === "pending") return;
    setSubmission("pending");
    const operationId = createOperationId();
    const first = canAnswer
      ? await gateway.execute({
          feedbackId,
          reference,
          proof,
          command: {
            kind: "append_message",
            eventId: operationId,
            audience: "reporter",
            content: answer,
          },
        })
      : { status: "ok" as const, value: "applied" as const };
    if (first.status !== "ok") {
      setSubmission(first.status === "conflict" ? "conflict" : "retryable");
      if (first.status === "conflict") await query.refetch();
      return;
    }
    const transition = await gateway.execute({
      feedbackId,
      reference,
      proof,
      command: {
        kind: canAnswer ? "reporter_answer" : "reopen",
        eventId: createOperationId(),
        expectedVersion: version,
        reason: answer,
      },
    });
    if (transition.status !== "ok") {
      setSubmission(transition.status === "conflict" ? "conflict" : "retryable");
      await query.refetch();
      return;
    }
    setDraft("");
    setSubmission("sent");
    await query.refetch();
  }

  if (query.isPending) return <p role="status">{copy.loading}</p>;
  if (!query.data || query.data.status !== "ok") {
    return (
      <p role="alert">
        {query.data?.status === "denied" ? copy.denied : copy.unavailable}
      </p>
    );
  }

  return (
    <section className="conversation-panel" aria-labelledby="conversation-title">
      <h2 id="conversation-title">{copy.title}</h2>
      <p className="state-word">{copy.state[query.data.value.state]}</p>
      {query.data.value.messages.length === 0 ? (
        <p>{copy.empty}</p>
      ) : (
        <ol className="conversation-list">
          {query.data.value.messages.map((message) => (
            <li key={message.id}>
              <strong>{copy.actor[message.actorKind]}</strong>
              {message.provider && message.revisionKind ? (
                <span>
                  {copy.provider[message.provider]} ·{" "}
                  {copy.revision[message.revisionKind]}
                </span>
              ) : null}
              <p>{message.content}</p>
              <time dateTime={message.occurredAt}>{message.occurredAt}</time>
            </li>
          ))}
        </ol>
      )}
      <h3>{copy.history}</h3>
      <ol className="lifecycle-list">
        {query.data.value.lifecycle.map((fact) => (
          <li key={fact.id}>
            <span>{copy.state[fact.state]}</span>
            <span>{fact.reason}</span>
            <time dateTime={fact.occurredAt}>{fact.occurredAt}</time>
          </li>
        ))}
      </ol>
      {canAnswer || canReopen ? (
        <form className="conversation-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>{copy.answerLabel}</span>
            <textarea
              value={draft}
              maxLength={500}
              aria-describedby="conversation-answer-hint"
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                setSubmission("idle");
              }}
            />
          </label>
          <p id="conversation-answer-hint">{copy.answerHint}</p>
          <button type="submit" disabled={!draft.trim() || submission === "pending"}>
            {submission === "pending"
              ? copy.sending
              : canReopen
                ? copy.reopen
                : copy.sendAnswer}
          </button>
        </form>
      ) : null}
      {submission !== "idle" && submission !== "pending" ? (
        <p role={submission === "sent" ? "status" : "alert"}>
          {submission === "sent"
            ? copy.sent
            : submission === "conflict"
              ? copy.conflict
              : copy.retry}
        </p>
      ) : null}
    </section>
  );
}
