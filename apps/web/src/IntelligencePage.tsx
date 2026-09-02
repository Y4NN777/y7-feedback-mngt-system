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
  IntelligenceProvenanceCommand,
  IntelligenceProvenanceOutcome,
} from "./IntelligenceGateway";
import { intelligenceMessages } from "./i18n/intelligence";

type Result = Extract<IntelligenceGatewayOutcome, { status: "ok" }>["result"];
type ProvenanceReceipt = Extract<
  IntelligenceProvenanceOutcome,
  { status: "ok" }
>["result"];

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
  const [associationKind, setAssociationKind] =
    useState<IntelligenceProvenanceCommand["kind"]>("record_theme");
  const [feedbackId, setFeedbackId] = useState("");
  const [associationId, setAssociationId] = useState("");
  const [relatedFeedbackId, setRelatedFeedbackId] = useState("");
  const [label, setLabel] = useState("");
  const [relationType, setRelationType] = useState<
    "duplicate" | "depends_on" | "related"
  >("related");
  const [expectedRevision, setExpectedRevision] = useState("1");
  const [mutationStatus, setMutationStatus] = useState<
    "idle" | "loading" | "denied" | "invalid" | "conflict" | "retryable"
  >("idle");
  const [receipt, setReceipt] = useState<ProvenanceReceipt>();

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

  async function mutate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMutationStatus("loading");
    const operationId = globalThis.crypto.randomUUID();
    const revision = Number(expectedRevision);
    const command: IntelligenceProvenanceCommand =
      associationKind === "record_theme"
        ? { kind: associationKind, operationId, feedbackId, label }
        : associationKind === "record_relationship"
          ? {
              kind: associationKind,
              operationId,
              feedbackId,
              relatedFeedbackId,
              relationType,
            }
          : associationKind === "correct_theme"
            ? {
                kind: associationKind,
                operationId,
                associationId,
                expectedRevision: revision,
                label,
              }
            : associationKind === "correct_relationship"
              ? {
                  kind: associationKind,
                  operationId,
                  associationId,
                  expectedRevision: revision,
                  relatedFeedbackId,
                  relationType,
                }
              : {
                  kind: associationKind,
                  operationId,
                  associationId,
                  expectedRevision: revision,
                };
    const outcome = await gateway.mutate({ workspaceId, projectId, command });
    if (outcome.status === "ok") {
      setReceipt(outcome.result);
      setAssociationId(outcome.result.associationId);
      setExpectedRevision(String(outcome.result.revision));
      setMutationStatus("idle");
    } else {
      setReceipt(undefined);
      setMutationStatus(outcome.status);
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
      {authenticated ? (
        <section className="intelligence-results" aria-labelledby="provenance-title">
          <h2 id="provenance-title">{copy.provenance}</h2>
          <p>{copy.provenanceIntro}</p>
          <form
            className="intelligence-form"
            onSubmit={(event) => {
              void mutate(event);
            }}
          >
            <label>
              {copy.provenanceAction}
              <select
                value={associationKind}
                onChange={(event) => {
                  setAssociationKind(
                    event.target.value as IntelligenceProvenanceCommand["kind"],
                  );
                }}
              >
                <option value="record_theme">{copy.recordTheme}</option>
                <option value="record_relationship">{copy.recordRelationship}</option>
                <option value="correct_theme">{copy.correctTheme}</option>
                <option value="correct_relationship">{copy.correctRelationship}</option>
                <option value="remove_association">{copy.removeAssociation}</option>
              </select>
            </label>
            {associationKind.startsWith("record_")
              ? field(copy.feedbackId, feedbackId, setFeedbackId, true)
              : field(copy.associationId, associationId, setAssociationId, true)}
            {associationKind === "record_theme" || associationKind === "correct_theme"
              ? field(copy.theme, label, setLabel, true)
              : null}
            {associationKind === "record_relationship" ||
            associationKind === "correct_relationship" ? (
              <>
                {field(
                  copy.relatedFeedbackId,
                  relatedFeedbackId,
                  setRelatedFeedbackId,
                  true,
                )}
                <label>
                  {copy.relationType}
                  <select
                    value={relationType}
                    onChange={(event) => {
                      setRelationType(event.target.value as typeof relationType);
                    }}
                  >
                    <option value="duplicate">duplicate</option>
                    <option value="depends_on">depends_on</option>
                    <option value="related">related</option>
                  </select>
                </label>
              </>
            ) : null}
            {associationKind.startsWith("correct_") ||
            associationKind === "remove_association"
              ? field(
                  copy.expectedRevision,
                  expectedRevision,
                  setExpectedRevision,
                  true,
                )
              : null}
            <button type="submit" disabled={mutationStatus === "loading"}>
              {mutationStatus === "loading" ? copy.saving : copy.saveProvenance}
            </button>
          </form>
          {mutationStatus !== "idle" && mutationStatus !== "loading" ? (
            <p role="alert">{copy[mutationStatus]}</p>
          ) : null}
          {receipt ? (
            <dl aria-live="polite">
              <div>
                <dt>{copy.disposition}</dt>
                <dd>{receipt.disposition}</dd>
              </div>
              <div>
                <dt>{copy.associationId}</dt>
                <dd>{receipt.associationId}</dd>
              </div>
              <div>
                <dt>{copy.eventId}</dt>
                <dd>{receipt.eventId}</dd>
              </div>
              <div>
                <dt>{copy.revision}</dt>
                <dd>{receipt.revision}</dd>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
