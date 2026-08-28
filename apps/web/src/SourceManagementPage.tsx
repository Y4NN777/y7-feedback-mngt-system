import { useState, type SyntheticEvent } from "react";

import {
  createProjectBadge,
  type Locale,
  type SourceProvider,
} from "@y7-feedback/domain";

import type { AdministrationSession } from "./AdministrationSession";
import { sourceMessages } from "./i18n/sources";
import type {
  SourceManagementGateway,
  SourceManagementView,
} from "./SourceManagementGateway";

type Notice = "copied" | "denied" | "oauthOpened" | "retryable";

export function SourceManagementPage({
  copyText = (value) => navigator.clipboard.writeText(value),
  gateway,
  locale,
  onLocaleChange,
  openAuthorization = (url) => window.open(url, "_blank", "noopener,noreferrer"),
  publicOrigin = window.location.origin,
  session,
}: {
  readonly copyText?: (value: string) => Promise<void>;
  readonly gateway: SourceManagementGateway;
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly openAuthorization?: (url: string) => unknown;
  readonly publicOrigin?: string;
  readonly session: AdministrationSession;
}) {
  const copy = sourceMessages[locale];
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [view, setView] = useState<SourceManagementView>();
  const [selected, setSelected] = useState<Readonly<Record<string, readonly string[]>>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  const badge = view
    ? createProjectBadge({
        publicOrigin: `${publicOrigin}/`,
        projectSlug: view.projectSlug,
        label: "Feedback",
      })
    : undefined;

  async function signIn(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await session.signIn(email, password);
    setAuthenticated(result === "authenticated");
    setNotice(result === "authenticated" ? undefined : "denied");
    setPassword("");
  }

  async function load() {
    setLoading(true);
    const result = await gateway.list({ workspaceId, projectId });
    setLoading(false);
    if (result.status === "ok") {
      setView(result.result);
      setNotice(undefined);
    } else {
      setNotice(result.status);
    }
  }

  async function mutate(
    operation: () => ReturnType<SourceManagementGateway["disconnect"]>,
  ) {
    setLoading(true);
    const result = await operation();
    if (result.status === "ok") await load();
    else {
      setLoading(false);
      setNotice(result.status);
    }
  }

  async function begin(provider: SourceProvider) {
    const result = await gateway.begin({ workspaceId, projectId, provider });
    if (result.status === "ok") {
      openAuthorization(result.result.authorizationUrl);
      setNotice("oauthOpened");
    } else setNotice(result.status);
  }

  return (
    <main className="root-page sources-page" data-visual-anchor="swiss">
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
      <section className="introduction sources-introduction">
        <div>
          <p className="eyebrow">Workspace Owner / Sources</p>
          <h1>{copy.title}</h1>
        </div>
        <p className="lede">{copy.intro}</p>
      </section>
      {notice && (
        <p role={notice === "denied" || notice === "retryable" ? "alert" : "status"}>
          {copy[notice]}
        </p>
      )}

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
        </form>
      ) : (
        <>
          <div className="session-banner">
            <p role="status">{copy.authenticated}</p>
            <button
              type="button"
              onClick={() => {
                void session.signOut().then(() => {
                  setAuthenticated(false);
                  setView(undefined);
                });
              }}
            >
              {copy.signOut}
            </button>
          </div>
          <form
            className="source-scope"
            onSubmit={(event) => {
              event.preventDefault();
              void load();
            }}
          >
            <label>
              {copy.workspaceId}
              <input
                required
                value={workspaceId}
                onChange={(event) => {
                  setWorkspaceId(event.target.value);
                }}
              />
            </label>
            <label>
              {copy.projectId}
              <input
                required
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                }}
              />
            </label>
            <button type="submit">{copy.load}</button>
          </form>
          <p className="source-policy">{copy.metadataOnly}</p>
          {view && (
            <div className="source-provider-actions">
              <button
                type="button"
                onClick={() => {
                  void begin("github");
                }}
              >
                {copy.connectGithub}
              </button>
              <button
                type="button"
                onClick={() => {
                  void begin("gitlab");
                }}
              >
                {copy.connectGitlab}
              </button>
            </div>
          )}
          {loading && <p role="status">{copy.loading}</p>}

          {view?.pendingSelections.map((pending, index) => (
            <section
              className="source-card source-selection"
              aria-labelledby={`selection-${pending.id}`}
              key={pending.id}
            >
              <span className="source-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <p className="source-provider">{pending.provider}</p>
                <h2 id={`selection-${pending.id}`}>{copy.pending}</h2>
                <fieldset>
                  <legend>{copy.selectedRepositories}</legend>
                  {pending.authorizedRepositories.map((repository) => (
                    <label key={repository.id}>
                      <input
                        type="checkbox"
                        checked={(selected[pending.id] ?? []).includes(repository.id)}
                        onChange={(event) => {
                          const current = selected[pending.id] ?? [];
                          setSelected({
                            ...selected,
                            [pending.id]: event.target.checked
                              ? [...current, repository.id]
                              : current.filter((id) => id !== repository.id),
                          });
                        }}
                      />
                      {repository.id}
                    </label>
                  ))}
                </fieldset>
                <button
                  type="button"
                  disabled={(selected[pending.id] ?? []).length === 0}
                  onClick={() => {
                    void mutate(() =>
                      gateway.select({
                        workspaceId,
                        projectId,
                        connectionId: pending.id,
                        repositoryIds: selected[pending.id] ?? [],
                      }),
                    );
                  }}
                >
                  {copy.select}
                </button>
              </div>
            </section>
          ))}

          {view &&
            view.connections.length === 0 &&
            view.pendingSelections.length === 0 && <p>{copy.empty}</p>}
          {view?.connections.map((connection, index) => (
            <article className="source-card" key={connection.id}>
              <span className="source-index" aria-hidden="true">
                {String(index + view.pendingSelections.length + 1).padStart(2, "0")}
              </span>
              <div className="source-card-body">
                <header>
                  <div>
                    <p className="source-provider">{connection.provider}</p>
                    <h2>{copy[connection.state]}</h2>
                  </div>
                  <time dateTime={connection.updatedAt}>{connection.updatedAt}</time>
                </header>
                <h3>{copy.selectedRepositories}</h3>
                <ul>
                  {connection.selectedRepositories.map((repository) => {
                    const importedRepository = connection.importedRepositories.find(
                      (item) => item.repositoryId === repository.id,
                    );
                    return (
                      <li key={repository.id}>
                        <div>
                          <strong>
                            {importedRepository
                              ? `${importedRepository.owner}/${importedRepository.name}`
                              : repository.id}
                          </strong>
                          {importedRepository && (
                            <>
                              <span>
                                {copy.repositoryOwner}: {importedRepository.owner}
                              </span>
                              <span>
                                {copy.observedAt}: {importedRepository.observedAt}
                              </span>
                            </>
                          )}
                        </div>
                        {connection.state === "active" && (
                          <button
                            type="button"
                            onClick={() => {
                              void mutate(() =>
                                gateway.refresh({
                                  workspaceId,
                                  projectId,
                                  connectionId: connection.id,
                                  repositoryId: repository.id,
                                }),
                              );
                            }}
                          >
                            {copy.refresh}
                          </button>
                        )}
                        {importedRepository && (
                          <div className="source-releases">
                            <h4>{copy.releases}</h4>
                            {importedRepository.releases.length === 0 ? (
                              <p>{copy.noReleases}</p>
                            ) : (
                              <ul>
                                {importedRepository.releases.map((release) => (
                                  <li key={release.providerReleaseId}>
                                    <a href={release.webUrl}>{release.name}</a>
                                    <span>{release.tag}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {connection.state === "active" && (
                  <button
                    className="source-disconnect"
                    type="button"
                    onClick={() => {
                      void mutate(() =>
                        gateway.disconnect({
                          workspaceId,
                          projectId,
                          connectionId: connection.id,
                        }),
                      );
                    }}
                  >
                    {copy.disconnect}
                  </button>
                )}
              </div>
            </article>
          ))}
          {badge && (
            <section className="source-badge">
              <div>
                <p className="eyebrow">{copy.badge}</p>
                <a href={badge.destination}>{badge.destination}</a>
              </div>
              <button
                type="button"
                onClick={() => {
                  void copyText(badge.markdown).then(() => {
                    setNotice("copied");
                  });
                }}
              >
                {copy.copyBadge}
              </button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
