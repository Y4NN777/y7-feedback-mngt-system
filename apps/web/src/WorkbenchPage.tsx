import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type SyntheticEvent } from "react";

import type {
  FeedbackLifecycleState,
  FeedbackType,
  Locale,
  WorkbenchFilter,
} from "@y7-feedback/domain";

import type { AdministrationSession } from "./AdministrationSession";
import type { NotificationInvalidation } from "./NotificationInvalidation";
import type { ExternalIssueGateway } from "./ExternalIssueGateway";
import type { WorkbenchGateway } from "./WorkbenchGateway";
import { workbenchMessages, workbenchNotificationMessages } from "./i18n/workbench";

const states: readonly FeedbackLifecycleState[] = [
  "received",
  "under_review",
  "awaiting_reporter",
  "resolved",
  "closed",
];

function sourceSummary(source: Readonly<Record<string, unknown>>): string {
  return Object.values(source).find(
    (value) => typeof value === "string" && value !== source.type,
  ) as string;
}

export function WorkbenchPage({
  gateway,
  externalIssueGateway,
  createOperationId,
  locale,
  notificationInvalidation,
  onLocaleChange,
  session,
}: {
  readonly gateway: WorkbenchGateway;
  readonly externalIssueGateway: ExternalIssueGateway;
  readonly createOperationId: () => string;
  readonly locale: Locale;
  readonly notificationInvalidation: NotificationInvalidation;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly session: AdministrationSession;
}) {
  const copy = workbenchMessages[locale];
  const queryClient = useQueryClient();
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceInput, setWorkspaceInput] = useState("");
  const [projectInput, setProjectInput] = useState("");
  const [scope, setScope] = useState<{ workspaceId: string; projectId: string }>();
  const [type, setType] = useState<FeedbackType | "all">("all");
  const [state, setState] = useState<FeedbackLifecycleState | "all">("all");
  const [assignment, setAssignment] = useState<WorkbenchFilter["assignment"]>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [signInDenied, setSignInDenied] = useState(false);
  const [classification, setClassification] = useState("");
  const [maintainerId, setMaintainerId] = useState("");
  const [repositoryKey, setRepositoryKey] = useState("");
  const [consentVersion, setConsentVersion] = useState("");
  const [issueStatus, setIssueStatus] = useState<
    "accepted" | "replayed" | "denied" | "conflict" | "retryable"
  >();
  const [mutationStatus, setMutationStatus] = useState<
    "ok" | "invalid" | "denied" | "conflict" | "retryable"
  >();
  const filter: WorkbenchFilter = {
    types: type === "all" ? [] : [type],
    states: state === "all" ? [] : [state],
    assignment,
  };
  const inbox = useQuery({
    queryKey: ["workbench", scope, filter],
    queryFn: () =>
      scope === undefined
        ? Promise.resolve({ status: "denied" as const })
        : gateway.list({ ...scope, filter }),
    enabled: authenticated && scope !== undefined && selectedId === undefined,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["workbench-detail", scope, selectedId],
    queryFn: () =>
      scope === undefined || selectedId === undefined
        ? Promise.resolve({ status: "denied" as const })
        : gateway.read({ ...scope, feedbackId: selectedId }),
    enabled: authenticated && scope !== undefined && selectedId !== undefined,
    retry: false,
  });
  const conversation = useQuery({
    queryKey: ["workbench-conversation", scope, selectedId],
    queryFn: () =>
      scope === undefined || selectedId === undefined
        ? Promise.resolve({ status: "denied" as const })
        : gateway.conversation({ ...scope, feedbackId: selectedId }),
    enabled: authenticated && scope !== undefined && selectedId !== undefined,
    retry: false,
  });
  const notifications = useQuery({
    queryKey: ["workbench-notifications", scope],
    queryFn: () =>
      scope === undefined
        ? Promise.resolve({ status: "denied" as const })
        : gateway.notifications(scope),
    enabled: authenticated && scope !== undefined,
    retry: false,
    refetchInterval: 5_000,
  });
  useEffect(() => {
    if (!authenticated || scope === undefined) return;
    let cancelled = false;
    let unsubscribe: (() => Promise<void>) | undefined;
    void gateway.authorizeNotificationRealtime(scope).then(async (outcome) => {
      if (outcome.status !== "ok") return;
      const close = await notificationInvalidation.subscribe(outcome.result, () => {
        void queryClient.invalidateQueries({
          queryKey: ["workbench-notifications", scope],
        });
      });
      if (cancelled) await close();
      else unsubscribe = close;
    });
    return () => {
      cancelled = true;
      if (unsubscribe !== undefined) void unsubscribe();
    };
  }, [authenticated, gateway, notificationInvalidation, queryClient, scope]);
  const repositories = useQuery({
    queryKey: ["external-issue-repositories", scope, selectedId],
    queryFn: () =>
      scope === undefined
        ? Promise.resolve({ status: "denied" as const })
        : externalIssueGateway.repositories(scope),
    enabled: authenticated && scope !== undefined && selectedId !== undefined,
    retry: false,
  });
  const selectedRepository =
    repositories.data?.status === "ok"
      ? repositories.data.result.find(
          (candidate) =>
            `${candidate.connectionId}:${candidate.repositoryId}` === repositoryKey,
        )
      : undefined;

  async function signIn(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = await session.signIn(email, password);
    setAuthenticated(outcome === "authenticated");
    setSignInDenied(outcome !== "authenticated");
    setPassword("");
  }

  async function mutate(command: Readonly<Record<string, unknown>>) {
    if (scope === undefined || selectedId === undefined) return;
    const outcome = await gateway.execute({
      ...scope,
      feedbackId: selectedId,
      command: { ...command, operationId: createOperationId() },
    });
    setMutationStatus(outcome.status);
    if (outcome.status === "ok") {
      await detail.refetch();
    }
  }

  async function markNotificationRead(notificationId: string) {
    if (scope === undefined) return;
    const outcome = await gateway.markNotificationRead({
      ...scope,
      notificationId,
    });
    setMutationStatus(outcome.status);
    if (outcome.status === "ok") await notifications.refetch();
  }

  async function linkExternalIssue() {
    if (scope === undefined || selectedId === undefined) return;
    const repository = selectedRepository;
    if (repository === undefined) {
      setIssueStatus("denied");
      return;
    }
    const outcome = await externalIssueGateway.link({
      ...scope,
      feedbackId: selectedId,
      operationId: createOperationId(),
      connectionId: repository.connectionId,
      repositoryId: repository.repositoryId,
      ...(repository.visibility === "public"
        ? { consentVersion: Number(consentVersion) }
        : {}),
    });
    setIssueStatus(outcome.status === "ok" ? outcome.result.status : outcome.status);
  }

  return (
    <main className="root-page workbench-page">
      <header className="masthead">
        <a className="brand" href="/" aria-label="Y7 Feedback">
          Y7
        </a>
        <fieldset className="language-switcher">
          <legend>{copy.language}</legend>
          {(["fr", "en"] as const).map((candidate) => (
            <button
              type="button"
              aria-pressed={locale === candidate}
              key={candidate}
              onClick={() => {
                onLocaleChange(candidate);
              }}
            >
              {candidate === "fr" ? "Français" : "English"}
            </button>
          ))}
        </fieldset>
      </header>
      <section className="introduction">
        <div>
          <p className="eyebrow">Owner · Maintainer</p>
          <h1>{copy.title}</h1>
        </div>
        <p className="lede">{copy.intro}</p>
      </section>

      {!authenticated ? (
        <form
          className="administration-form"
          onSubmit={(event) => {
            void signIn(event);
          }}
        >
          <label>
            {copy.email}
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </label>
          <label>
            {copy.password}
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </label>
          <button type="submit">{copy.signIn}</button>
          {signInDenied && <p role="alert">{copy.denied}</p>}
        </form>
      ) : scope === undefined ? (
        <form
          className="administration-form"
          onSubmit={(event) => {
            event.preventDefault();
            setScope({
              workspaceId: workspaceInput.trim(),
              projectId: projectInput.trim(),
            });
          }}
        >
          <label>
            {copy.workspaceId}
            <input
              required
              value={workspaceInput}
              onChange={(event) => {
                setWorkspaceInput(event.target.value);
              }}
            />
          </label>
          <label>
            {copy.projectId}
            <input
              required
              value={projectInput}
              onChange={(event) => {
                setProjectInput(event.target.value);
              }}
            />
          </label>
          <button type="submit">{copy.open}</button>
        </form>
      ) : selectedId !== undefined ? (
        <section className="workbench-detail" aria-live="polite">
          <button
            type="button"
            onClick={() => {
              setSelectedId(undefined);
            }}
          >
            {copy.back}
          </button>
          {detail.isPending ? (
            <p role="status">{copy.loading}</p>
          ) : detail.data?.status !== "ok" ? (
            <div role="alert">
              <p>{detail.data?.status === "denied" ? copy.denied : copy.retryable}</p>
              <button
                type="button"
                onClick={() => {
                  void detail.refetch();
                }}
              >
                {copy.retry}
              </button>
            </div>
          ) : (
            <article>
              <p className="eyebrow">
                {detail.data.result.type} ·{" "}
                {detail.data.result.state.replaceAll("_", " ")}
              </p>
              <h2>{sourceSummary(detail.data.result.source)}</h2>
              <p>
                <strong>{copy.accepted}:</strong>{" "}
                <time dateTime={detail.data.result.acceptedAt}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(detail.data.result.acceptedAt))}
                </time>
              </p>
              <p>
                <strong>{copy.classification}:</strong>{" "}
                {detail.data.result.classification ?? copy.noClassification}
              </p>
              <h3>{copy.context}</h3>
              <dl>
                {detail.data.result.context.map((entry) => (
                  <div key={entry.name}>
                    <dt>{entry.name}</dt>
                    <dd>
                      {String(entry.value)} — {entry.purpose}
                    </dd>
                  </div>
                ))}
              </dl>
              <h3>{copy.attachments}</h3>
              {detail.data.result.attachmentNames.length === 0 ? (
                <p>{copy.noAttachments}</p>
              ) : (
                <ul>
                  {detail.data.result.attachmentNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              )}
              {conversation.isPending ? (
                <p role="status">{copy.loading}</p>
              ) : conversation.data?.status !== "ok" ? (
                <p role="alert">
                  {conversation.data?.status === "denied"
                    ? copy.denied
                    : copy.retryable}
                </p>
              ) : (
                <section className="workbench-conversation">
                  <h3>{copy.messages}</h3>
                  {conversation.data.result.messages.length === 0 ? (
                    <p>{copy.conversationEmpty}</p>
                  ) : (
                    <ol>
                      {conversation.data.result.messages.map((entry) => (
                        <li key={entry.id}>
                          <strong>{entry.actorKind}</strong>
                          <p>{entry.content}</p>
                          <time dateTime={entry.occurredAt}>{entry.occurredAt}</time>
                        </li>
                      ))}
                    </ol>
                  )}
                  <h3>{copy.internalNotes}</h3>
                  {conversation.data.result.internalNotes.length === 0 ? (
                    <p>{copy.conversationEmpty}</p>
                  ) : (
                    <ol>
                      {conversation.data.result.internalNotes.map((entry) => (
                        <li key={entry.id}>
                          <p>{entry.content}</p>
                          <time dateTime={entry.occurredAt}>{entry.occurredAt}</time>
                        </li>
                      ))}
                    </ol>
                  )}
                  <h3>{copy.lifecycle}</h3>
                  {conversation.data.result.lifecycle.length === 0 ? (
                    <p>{copy.conversationEmpty}</p>
                  ) : (
                    <ol>
                      {conversation.data.result.lifecycle.map((fact) => (
                        <li key={fact.id}>
                          <strong>{fact.state.replaceAll("_", " ")}</strong>
                          <p>{fact.reason}</p>
                          <time dateTime={fact.occurredAt}>{fact.occurredAt}</time>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              )}
              <fieldset className="workbench-actions">
                <legend>{copy.actions}</legend>
                <label>
                  {copy.classificationInput}
                  <input
                    value={classification}
                    onChange={(event) => {
                      setClassification(event.target.value);
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    void mutate({ kind: "classify_feedback", classification });
                  }}
                >
                  {copy.classify}
                </button>
                <label>
                  {copy.maintainerInput}
                  <input
                    value={maintainerId}
                    onChange={(event) => {
                      setMaintainerId(event.target.value);
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    void mutate({ kind: "assign_feedback", maintainerId });
                  }}
                >
                  {copy.assign}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void mutate({ kind: "unassign_feedback" });
                  }}
                >
                  {copy.unassign}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void mutate({ kind: "delete_feedback" });
                  }}
                >
                  {copy.delete}
                </button>
              </fieldset>
              <fieldset className="workbench-actions">
                <legend>{copy.externalIssue}</legend>
                {repositories.isPending ? (
                  <p role="status">{copy.repositoriesLoading}</p>
                ) : repositories.data?.status !== "ok" ? (
                  <div role="alert">
                    <p>
                      {repositories.data?.status === "denied"
                        ? copy.denied
                        : copy.retryable}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void repositories.refetch();
                      }}
                    >
                      {copy.retry}
                    </button>
                  </div>
                ) : repositories.data.result.length === 0 ? (
                  <p>{copy.noRepository}</p>
                ) : (
                  <>
                    <label>
                      {copy.repository}
                      <select
                        required
                        value={repositoryKey}
                        onChange={(event) => {
                          setRepositoryKey(event.target.value);
                          setConsentVersion("");
                          setIssueStatus(undefined);
                        }}
                      >
                        <option value="">{copy.chooseRepository}</option>
                        {repositories.data.result.map((repository) => (
                          <option
                            key={`${repository.connectionId}:${repository.repositoryId}`}
                            value={`${repository.connectionId}:${repository.repositoryId}`}
                          >
                            {repository.provider} · {repository.owner}/{repository.name}{" "}
                            · {repository.visibility}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedRepository?.visibility === "public" && (
                      <label>
                        {copy.consentVersion}
                        <input
                          type="number"
                          min="1"
                          step="1"
                          required
                          value={consentVersion}
                          onChange={(event) => {
                            setConsentVersion(event.target.value);
                            setIssueStatus(undefined);
                          }}
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      disabled={
                        repositoryKey === "" ||
                        (selectedRepository?.visibility === "public" &&
                          (!Number.isSafeInteger(Number(consentVersion)) ||
                            Number(consentVersion) < 1))
                      }
                      onClick={() => {
                        void linkExternalIssue();
                      }}
                    >
                      {copy.linkIssue}
                    </button>
                  </>
                )}
              </fieldset>
              {mutationStatus && (
                <p role="status">
                  {mutationStatus === "ok" ? copy.mutationOk : copy[mutationStatus]}
                </p>
              )}
              {issueStatus && (
                <p role="status">
                  {issueStatus === "accepted"
                    ? copy.issueAccepted
                    : issueStatus === "replayed"
                      ? copy.issueReplayed
                      : copy[issueStatus]}
                </p>
              )}
            </article>
          )}
        </section>
      ) : (
        <section className="workbench-grid">
          <div className="session-banner">
            <p>
              {workspaceInput} / {projectInput}
            </p>
            <button
              type="button"
              onClick={() => {
                void session.signOut().then(() => {
                  setAuthenticated(false);
                  setScope(undefined);
                });
              }}
            >
              {copy.signOut}
            </button>
          </div>
          <section className="notification-feed" aria-labelledby="notification-title">
            <h2 id="notification-title">{copy.notifications}</h2>
            {notifications.isPending ? (
              <p role="status">{copy.loading}</p>
            ) : notifications.data?.status !== "ok" ? (
              <div role="alert">
                <p>
                  {notifications.data?.status === "denied"
                    ? copy.denied
                    : copy.retryable}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void notifications.refetch();
                  }}
                >
                  {copy.retry}
                </button>
              </div>
            ) : (
              <>
                <p aria-live="polite">
                  <strong>{notifications.data.result.unreadCount}</strong>{" "}
                  {copy.unreadNotifications}
                </p>
                {notifications.data.result.items.length === 0 ? (
                  <p>{copy.noNotifications}</p>
                ) : (
                  <ol>
                    {notifications.data.result.items.map((notification) => (
                      <li key={notification.id}>
                        <strong>
                          {workbenchNotificationMessages[locale][notification.kind]}
                        </strong>
                        <span>{notification.reference}</span>
                        <time dateTime={notification.createdAt}>
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(new Date(notification.createdAt))}
                        </time>
                        {notification.readAt === null ? (
                          <button
                            type="button"
                            onClick={() => {
                              void markNotificationRead(notification.id);
                            }}
                          >
                            {copy.markRead}
                          </button>
                        ) : (
                          <span>{copy.notificationRead}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
          <fieldset className="workbench-filters">
            <legend>{copy.filters}</legend>
            <label>
              {copy.type}
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value as FeedbackType | "all");
                }}
              >
                <option value="all">{copy.all}</option>
                <option value="bug">Bug</option>
                <option value="suggestion">Suggestion</option>
                <option value="review">Review</option>
              </select>
            </label>
            <label>
              {copy.state}
              <select
                value={state}
                onChange={(event) => {
                  setState(event.target.value as FeedbackLifecycleState | "all");
                }}
              >
                <option value="all">{copy.all}</option>
                {states.map((value) => (
                  <option value={value} key={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.assignment}
              <select
                value={assignment}
                onChange={(event) => {
                  setAssignment(event.target.value as WorkbenchFilter["assignment"]);
                }}
              >
                <option value="all">{copy.all}</option>
                <option value="assigned_to_me">{copy.assigned}</option>
                <option value="unassigned">{copy.unassigned}</option>
              </select>
            </label>
          </fieldset>
          {inbox.isPending ? (
            <p role="status">{copy.loading}</p>
          ) : inbox.data?.status !== "ok" ? (
            <div role="alert">
              <p>{inbox.data?.status === "denied" ? copy.denied : copy.retryable}</p>
              <button
                type="button"
                onClick={() => {
                  void inbox.refetch();
                }}
              >
                {copy.retry}
              </button>
            </div>
          ) : inbox.data.result.length === 0 ? (
            <p role="status">{copy.empty}</p>
          ) : (
            <ul className="workbench-list">
              {inbox.data.result.map((entry) => (
                <li key={entry.feedbackId}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(entry.feedbackId);
                    }}
                  >
                    <span>{entry.type}</span>
                    <strong>{entry.feedbackId}</strong>
                    <span>{entry.state.replaceAll("_", " ")}</span>
                    <time dateTime={entry.acceptedAt}>
                      {new Intl.DateTimeFormat(locale).format(
                        new Date(entry.acceptedAt),
                      )}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
