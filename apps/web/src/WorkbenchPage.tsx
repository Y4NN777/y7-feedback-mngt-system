import { useQuery } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";

import type {
  FeedbackLifecycleState,
  FeedbackType,
  Locale,
  WorkbenchFilter,
} from "@y7-feedback/domain";

import type { AdministrationSession } from "./AdministrationSession";
import type { WorkbenchGateway } from "./WorkbenchGateway";
import { workbenchMessages } from "./i18n/workbench";

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
  locale,
  onLocaleChange,
  session,
}: {
  readonly gateway: WorkbenchGateway;
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly session: AdministrationSession;
}) {
  const copy = workbenchMessages[locale];
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

  async function signIn(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = await session.signIn(email, password);
    setAuthenticated(outcome === "authenticated");
    setSignInDenied(outcome !== "authenticated");
    setPassword("");
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
