import { useState, type SyntheticEvent } from "react";

import type {
  IntelligenceFilter,
  IntelligenceTrendWindow,
  Locale,
} from "@y7-feedback/domain";

import type { AdministrationSession } from "./AdministrationSession";
import type {
  IntelligenceGateway,
  IntelligenceGatewayOutcome,
} from "./IntelligenceGateway";
import { intelligenceMessages } from "./i18n/intelligence";

type Result = Extract<IntelligenceGatewayOutcome, { status: "ok" }>["result"];

const split = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function optionalPair(from: string, to: string) {
  return from && to ? { from, to } : undefined;
}

export function IntelligencePage({
  gateway,
  locale,
  onLocaleChange,
  session,
}: {
  readonly gateway: IntelligenceGateway;
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly session: AdministrationSession;
}) {
  const copy = intelligenceMessages[locale];
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [types, setTypes] = useState("");
  const [states, setStates] = useState("");
  const [reporters, setReporters] = useState("");
  const [versions, setVersions] = useState("");
  const [places, setPlaces] = useState("");
  const [features, setFeatures] = useState("");
  const [contextName, setContextName] = useState("");
  const [contextValue, setContextValue] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [currentFrom, setCurrentFrom] = useState("");
  const [currentTo, setCurrentTo] = useState("");
  const [baselineFrom, setBaselineFrom] = useState("");
  const [baselineTo, setBaselineTo] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "denied" | "invalid" | "retryable"
  >("idle");
  const [result, setResult] = useState<Result>();

  async function signIn(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = await session.signIn(email, password);
    setAuthenticated(outcome === "authenticated");
    if (outcome !== "authenticated") setStatus("denied");
  }

  async function analyze(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    const filter: IntelligenceFilter = {
      ...(split(types).length
        ? { types: split(types) as NonNullable<IntelligenceFilter["types"]> }
        : {}),
      ...(split(states).length
        ? { states: split(states) as NonNullable<IntelligenceFilter["states"]> }
        : {}),
      ...(split(reporters).length
        ? {
            reporterKinds: split(reporters) as NonNullable<
              IntelligenceFilter["reporterKinds"]
            >,
          }
        : {}),
      ...(split(versions).length ? { versions: split(versions) } : {}),
      ...(split(places).length ? { places: split(places) } : {}),
      ...(split(features).length ? { features: split(features) } : {}),
      ...(contextName && contextValue
        ? { reviewedContext: { [contextName]: contextValue } }
        : {}),
      ...(from && to ? { from, to } : {}),
    };
    const current = optionalPair(currentFrom, currentTo);
    const baseline = optionalPair(baselineFrom, baselineTo);
    const trendWindow: IntelligenceTrendWindow | undefined =
      current && baseline ? { current, baseline } : undefined;
    const outcome = await gateway.analyze({
      workspaceId,
      projectId,
      filter,
      ...(trendWindow ? { trendWindow } : {}),
    });
    if (outcome.status === "ok") {
      setResult(outcome.result);
      setStatus("idle");
    } else {
      setResult(undefined);
      setStatus(outcome.status);
    }
  }

  const field = (
    label: string,
    value: string,
    setValue: (value: string) => void,
    required = false,
  ) => (
    <label>
      {label}
      <input
        required={required}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
    </label>
  );

  return (
    <main className="root-page intelligence-page">
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
        </form>
      ) : (
        <form
          className="intelligence-form"
          onSubmit={(event) => {
            void analyze(event);
          }}
        >
          <fieldset>
            <legend>{copy.scope}</legend>
            {field(copy.workspace, workspaceId, setWorkspaceId, true)}
            {field(copy.project, projectId, setProjectId, true)}
          </fieldset>
          <fieldset>
            <legend>{copy.filters}</legend>
            {field(copy.types, types, setTypes)}
            {field(copy.states, states, setStates)}
            {field(copy.reporters, reporters, setReporters)}
            {field(copy.versions, versions, setVersions)}
            {field(copy.places, places, setPlaces)}
            {field(copy.features, features, setFeatures)}
            {field(copy.contextName, contextName, setContextName)}
            {field(copy.contextValue, contextValue, setContextValue)}
            {field(copy.from, from, setFrom)}
            {field(copy.to, to, setTo)}
          </fieldset>
          <fieldset>
            <legend>{copy.trend}</legend>
            {field(copy.currentFrom, currentFrom, setCurrentFrom)}
            {field(copy.currentTo, currentTo, setCurrentTo)}
            {field(copy.baselineFrom, baselineFrom, setBaselineFrom)}
            {field(copy.baselineTo, baselineTo, setBaselineTo)}
          </fieldset>
          <button type="submit" disabled={status === "loading"}>
            {status === "loading" ? copy.loading : copy.analyze}
          </button>
        </form>
      )}
      {status !== "idle" && status !== "loading" ? (
        <p role="alert">{copy[status]}</p>
      ) : null}
      {result ? (
        <section
          className="intelligence-results"
          aria-labelledby="intelligence-results-title"
          aria-live="polite"
        >
          <h2 id="intelligence-results-title">{copy.results}</h2>
          <p className="intelligence-total">
            <strong>{copy.total}</strong>
            <span>{result.aggregate.total}</span>
          </p>
          {result.aggregate.total === 0 ? <p>{copy.empty}</p> : null}
          <div className="intelligence-breakdowns">
            <section>
              <h3>{copy.byType}</h3>
              <dl>
                {Object.entries(result.aggregate.byType).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3>{copy.byState}</h3>
              <dl>
                {Object.entries(result.aggregate.byState).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
          <section>
            <h3>{copy.trendResult}</h3>
            {result.trend ? (
              <dl>
                <div>
                  <dt>current</dt>
                  <dd>{result.trend.currentCount}</dd>
                </div>
                <div>
                  <dt>baseline</dt>
                  <dd>{result.trend.baselineCount}</dd>
                </div>
                <div>
                  <dt>direction</dt>
                  <dd>{result.trend.direction}</dd>
                </div>
              </dl>
            ) : (
              <p>{copy.noTrend}</p>
            )}
          </section>
        </section>
      ) : null}
    </main>
  );
}
