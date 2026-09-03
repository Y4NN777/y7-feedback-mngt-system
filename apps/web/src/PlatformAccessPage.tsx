import { useState, type SyntheticEvent } from "react";

import type { ExceptionalAccessAction, Locale } from "@y7-feedback/domain";

import type { AdministrationSession } from "./AdministrationSession";
import type {
  PlatformAccessGateway,
  PlatformAccessOutcome,
} from "./PlatformAccessGateway";
import { platformAccessMessages } from "./i18n/platform-access";

type Action = "request" | "approve" | "deny" | "use" | "revoke" | "review";
const actionLabels: Record<Action, Record<Locale, string>> = {
  request: { fr: "Demander", en: "Request" },
  approve: { fr: "Approuver", en: "Approve" },
  deny: { fr: "Refuser", en: "Deny" },
  use: { fr: "Utiliser", en: "Use" },
  revoke: { fr: "Révoquer", en: "Revoke" },
  review: { fr: "Revoir le break-glass", en: "Review break-glass" },
};
const capabilities: readonly ExceptionalAccessAction[] = [
  "feedback.read",
  "attachment.read",
  "message.read",
  "internal_note.read",
];

export function PlatformAccessPage({
  gateway,
  locale,
  onLocaleChange,
  session,
}: {
  readonly gateway: PlatformAccessGateway;
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly session: AdministrationSession;
}) {
  const copy = platformAccessMessages[locale];
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [action, setAction] = useState<Action>("request");
  const [grantId, setGrantId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [feedbackId, setFeedbackId] = useState("");
  const [capability, setCapability] =
    useState<ExceptionalAccessAction>("feedback.read");
  const [reasonCode, setReasonCode] = useState("INCIDENT_RESPONSE");
  const [justification, setJustification] = useState("");
  const [severity, setSeverity] = useState<"ordinary" | "critical">("ordinary");
  const [breakGlass, setBreakGlass] = useState(false);
  const [expectedRevision, setExpectedRevision] = useState("0");
  const [expiresAt, setExpiresAt] = useState("");
  const [outcome, setOutcome] = useState<PlatformAccessOutcome>();

  async function signIn(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await session.signIn(email, password);
    setAuthenticated(result === "authenticated");
    setOutcome(result === "authenticated" ? undefined : { status: "denied" });
    setPassword("");
  }

  async function execute(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const scope = {
      workspaceId,
      ...(projectId ? { projectId } : {}),
      ...(feedbackId ? { feedbackId } : {}),
    };
    const revision = Number(expectedRevision);
    const command: Readonly<Record<string, unknown>> =
      action === "request"
        ? {
            kind: action,
            grantId,
            ...scope,
            actions: [capability],
            reasonCode,
            justification,
            incidentSeverity: severity,
            breakGlass,
          }
        : action === "approve"
          ? {
              kind: action,
              grantId,
              expectedRevision: revision,
              expiresAt: new Date(expiresAt).toISOString(),
            }
          : action === "use"
            ? {
                kind: action,
                operationId: globalThis.crypto.randomUUID(),
                grantId,
                expectedRevision: revision,
                ...scope,
                action: capability,
              }
            : { kind: action, grantId, expectedRevision: revision };
    setOutcome(await gateway.execute(command));
  }

  const outcomeText = outcome
    ? outcome.status === "ok"
      ? outcome.result.disposition === "replayed"
        ? copy.replayed
        : copy.ok
      : copy[outcome.status]
    : undefined;

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
          <p className="eyebrow">Platform Operator</p>
          <h1>{copy.title}</h1>
        </div>
        <p className="lede">{copy.intro}</p>
      </section>

      {!authenticated ? (
        <form className="administration-form" onSubmit={(event) => void signIn(event)}>
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
              onClick={() =>
                void session.signOut().then(() => {
                  setAuthenticated(false);
                  setOutcome(undefined);
                })
              }
            >
              {copy.signOut}
            </button>
          </div>
          <form
            className="administration-form"
            onSubmit={(event) => void execute(event)}
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
            <label>
              {copy.grantId}
              <input
                required
                value={grantId}
                onChange={(e) => {
                  setGrantId(e.target.value);
                }}
              />
            </label>
            {action !== "request" && (
              <label>
                {copy.expectedRevision}
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={expectedRevision}
                  onChange={(e) => {
                    setExpectedRevision(e.target.value);
                  }}
                />
              </label>
            )}
            {(action === "request" || action === "use") && (
              <>
                <label>
                  {copy.workspaceId}
                  <input
                    required
                    value={workspaceId}
                    onChange={(e) => {
                      setWorkspaceId(e.target.value);
                    }}
                  />
                </label>
                <label>
                  {copy.projectId}
                  <input
                    required={action === "use"}
                    value={projectId}
                    onChange={(e) => {
                      setProjectId(e.target.value);
                    }}
                  />
                </label>
                <label>
                  {copy.feedbackId}
                  <input
                    required={action === "use"}
                    value={feedbackId}
                    onChange={(e) => {
                      setFeedbackId(e.target.value);
                    }}
                  />
                </label>
                <label>
                  {copy.capability}
                  <select
                    value={capability}
                    onChange={(e) => {
                      setCapability(e.target.value as ExceptionalAccessAction);
                    }}
                  >
                    {capabilities.map((value) => (
                      <option value={value} key={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {action === "request" && (
              <>
                <label>
                  {copy.reasonCode}
                  <input
                    required
                    value={reasonCode}
                    onChange={(e) => {
                      setReasonCode(e.target.value);
                    }}
                  />
                </label>
                <label>
                  {copy.justification}
                  <textarea
                    minLength={10}
                    maxLength={1000}
                    required
                    value={justification}
                    onChange={(e) => {
                      setJustification(e.target.value);
                    }}
                  />
                </label>
                <label>
                  {copy.severity}
                  <select
                    value={severity}
                    onChange={(e) => {
                      setSeverity(e.target.value as "ordinary" | "critical");
                    }}
                  >
                    <option value="ordinary">{copy.ordinary}</option>
                    <option value="critical">{copy.critical}</option>
                  </select>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={breakGlass}
                    onChange={(e) => {
                      setBreakGlass(e.target.checked);
                    }}
                  />
                  {copy.breakGlass}
                </label>
              </>
            )}
            {action === "approve" && (
              <label>
                {copy.expiresAt}
                <input
                  type="datetime-local"
                  required
                  value={expiresAt}
                  onChange={(e) => {
                    setExpiresAt(e.target.value);
                  }}
                />
              </label>
            )}
            <button type="submit">{copy.execute}</button>
          </form>
        </>
      )}
      {outcomeText && <p role="status">{outcomeText}</p>}
      {outcome?.status === "ok" && outcome.result.content && (
        <section aria-labelledby="platform-protected-result">
          <h2 id="platform-protected-result">{copy.protectedResult}</h2>
          <pre>{JSON.stringify(outcome.result.content, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
