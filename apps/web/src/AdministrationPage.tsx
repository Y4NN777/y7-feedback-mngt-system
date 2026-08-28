import { useState, type SyntheticEvent } from "react";

import type { Locale } from "@y7-feedback/domain";

import type {
  AdministrationGateway,
  AdministrationOutcome,
} from "./AdministrationGateway";
import type { AdministrationSession } from "./AdministrationSession";
import { administrationMessages } from "./i18n/administration";

type Action =
  | "create_project"
  | "configure_project"
  | "rename_project"
  | "set_project_activation"
  | "assign_maintainer"
  | "remove_maintainer";

const actionLabels: Record<Action, { readonly fr: string; readonly en: string }> = {
  create_project: { fr: "Créer un projet", en: "Create Project" },
  configure_project: { fr: "Configurer le projet", en: "Configure Project" },
  rename_project: { fr: "Renommer le projet", en: "Rename Project" },
  set_project_activation: { fr: "Changer l’activation", en: "Change activation" },
  assign_maintainer: { fr: "Assigner un Maintainer", en: "Assign Maintainer" },
  remove_maintainer: { fr: "Retirer un Maintainer", en: "Remove Maintainer" },
};

function configuration(fields: {
  readonly enabledTypes: string;
  readonly purposeEn: string;
  readonly purposeFr: string;
}) {
  return {
    enabledTypes: fields.enabledTypes
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    contextDeclarations: [],
    reporterPurpose: { fr: fields.purposeFr, en: fields.purposeEn },
  };
}

export function AdministrationPage({
  gateway,
  locale,
  onLocaleChange,
  session,
}: {
  readonly gateway: AdministrationGateway;
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly session: AdministrationSession;
}) {
  const copy = administrationMessages[locale];
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [action, setAction] = useState<Action>("create_project");
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [operationId, setOperationId] = useState("");
  const [slug, setSlug] = useState("");
  const [purposeFr, setPurposeFr] = useState("");
  const [purposeEn, setPurposeEn] = useState("");
  const [enabledTypes, setEnabledTypes] = useState("bug,suggestion,review");
  const [maintainerId, setMaintainerId] = useState("");
  const [active, setActive] = useState(true);
  const [outcome, setOutcome] = useState<AdministrationOutcome["status"]>();

  async function signIn(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await session.signIn(email, password);
    setAuthenticated(result === "authenticated");
    setOutcome(result === "authenticated" ? undefined : "denied");
    setPassword("");
  }

  async function execute(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const common = { kind: action, workspaceId, projectId, operationId };
    let command: Readonly<Record<string, unknown>>;
    switch (action) {
      case "create_project":
        command = {
          ...common,
          slug,
          ...configuration({ enabledTypes, purposeFr, purposeEn }),
        };
        break;
      case "configure_project":
        command = {
          ...common,
          ...configuration({ enabledTypes, purposeFr, purposeEn }),
        };
        break;
      case "rename_project":
        command = { ...common, slug };
        break;
      case "set_project_activation":
        command = { ...common, active };
        break;
      case "assign_maintainer":
      case "remove_maintainer":
        command = { ...common, maintainerId };
        break;
    }
    const result = await gateway.execute(command);
    setOutcome(result.status);
  }

  return (
    <main className="root-page administration-page">
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
          <p className="eyebrow">Workspace Owner</p>
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
                  setOutcome(undefined);
                });
              }}
            >
              {copy.signOut}
            </button>
          </div>
          <form
            className="administration-form"
            onSubmit={(event) => {
              void execute(event);
            }}
          >
            <label>
              {copy.action}
              <select
                value={action}
                onChange={(event) => {
                  setAction(event.target.value as Action);
                  setOutcome(undefined);
                }}
              >
                {(Object.keys(actionLabels) as Action[]).map((value) => (
                  <option value={value} key={value}>
                    {actionLabels[value][locale]}
                  </option>
                ))}
              </select>
            </label>
            {[
              [copy.workspaceId, workspaceId, setWorkspaceId],
              [copy.projectId, projectId, setProjectId],
              [copy.operationId, operationId, setOperationId],
            ].map(([label, value, setter]) => (
              <label key={label as string}>
                {label as string}
                <input
                  required
                  value={value as string}
                  onChange={(event) => {
                    (setter as (value: string) => void)(event.target.value);
                  }}
                />
              </label>
            ))}
            {(action === "create_project" || action === "rename_project") && (
              <label>
                {copy.slug}
                <input
                  required
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                  }}
                />
              </label>
            )}
            {(action === "create_project" || action === "configure_project") && (
              <>
                <label>
                  {copy.enabledTypes}
                  <input
                    required
                    value={enabledTypes}
                    onChange={(e) => {
                      setEnabledTypes(e.target.value);
                    }}
                  />
                </label>
                <label>
                  {copy.purposeFr}
                  <textarea
                    required
                    value={purposeFr}
                    onChange={(e) => {
                      setPurposeFr(e.target.value);
                    }}
                  />
                </label>
                <label>
                  {copy.purposeEn}
                  <textarea
                    required
                    value={purposeEn}
                    onChange={(e) => {
                      setPurposeEn(e.target.value);
                    }}
                  />
                </label>
              </>
            )}
            {action === "set_project_activation" && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => {
                    setActive(e.target.checked);
                  }}
                />
                {copy.active}
              </label>
            )}
            {(action === "assign_maintainer" || action === "remove_maintainer") && (
              <label>
                {copy.maintainerId}
                <input
                  required
                  value={maintainerId}
                  onChange={(e) => {
                    setMaintainerId(e.target.value);
                  }}
                />
              </label>
            )}
            <button type="submit">{copy.submit}</button>
          </form>
        </>
      )}
      {outcome && (
        <p className={`administration-outcome outcome-${outcome}`} role="status">
          {outcome === "ok" ? copy.success : copy[outcome]}
        </p>
      )}
    </main>
  );
}
