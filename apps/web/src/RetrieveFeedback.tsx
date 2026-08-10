import { useState, type SyntheticEvent } from "react";

import type { FeedbackSource, Locale, ReporterFeedbackView } from "@y7-feedback/domain";

import { accessMessages } from "./i18n/access";

export type AccountlessGatewayOutcome =
  | { readonly status: "ok"; readonly view: ReporterFeedbackView }
  | { readonly status: "denied" }
  | { readonly status: "retryable" };

export interface AccountlessGateway {
  retrieve(input: {
    readonly reference: string;
    readonly proof: string;
  }): Promise<AccountlessGatewayOutcome>;
}

function sourceValues(source: FeedbackSource): readonly string[] {
  if (source.type === "bug") {
    return [
      source.problem,
      source.expectedBehavior,
      source.observedBehavior,
      source.reproductionSteps,
    ].filter((value): value is string => value !== undefined);
  }
  if (source.type === "suggestion") {
    return [source.proposal, source.rationale, source.usageContext].filter(
      (value): value is string => value !== undefined,
    );
  }
  return [source.experience, source.appreciation];
}

function ReporterView({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: ReporterFeedbackView;
}) {
  const copy = accessMessages[locale];
  return (
    <section className="retrieved-view" aria-labelledby="retrieved-title">
      <p className="eyebrow">{view.reference}</p>
      <h1 id="retrieved-title">{copy.viewTitle}</h1>
      <div className="review-band review-band-source">
        <h2>{copy.source}</h2>
        <ul className="review-values">
          {sourceValues(view.originalSource).map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      </div>
      <div className="review-band review-band-identity">
        <h2>{copy.state}</h2>
        <p className="state-word">{copy.stateLabels[view.currentState]}</p>
      </div>
      <div className="review-band review-band-context reporter-categories">
        <div>
          <h2>{copy.messages}</h2>
          <p>{String(view.messages.length)}</p>
        </div>
        <div>
          <h2>{copy.attachments}</h2>
          <p>{String(view.attachments.length)}</p>
        </div>
      </div>
    </section>
  );
}

export function RetrieveFeedback({
  gateway,
  locale,
  onLocaleChange,
}: {
  readonly gateway: AccountlessGateway;
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
}) {
  const copy = accessMessages[locale];
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState("");
  const [outcome, setOutcome] = useState<"denied" | "retryable" | null>(null);
  const [view, setView] = useState<ReporterFeedbackView | null>(null);

  async function retrieve(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!reference.trim() || !proof.trim()) {
      setOutcome("denied");
      return;
    }
    try {
      const result = await gateway.retrieve({ reference: reference.trim(), proof });
      if (result.status === "ok") {
        setView(result.view);
        setOutcome(null);
      } else {
        setOutcome(result.status);
      }
    } catch {
      setOutcome("retryable");
    }
  }

  function reset() {
    setReference("");
    setProof("");
    setOutcome(null);
    setView(null);
  }

  return (
    <main className="intake-page retrieve-page">
      <header className="masthead intake-header">
        <a className="brand" href="/" aria-label={copy.brandLabel}>
          Y7
        </a>
        <a className="back-link" href="/">
          {copy.back}
        </a>
        <fieldset className="language-switcher">
          <legend>{copy.languageLabel}</legend>
          <button
            type="button"
            aria-pressed={locale === "fr"}
            onClick={() => {
              onLocaleChange("fr");
            }}
          >
            Français
          </button>
          <button
            type="button"
            aria-pressed={locale === "en"}
            onClick={() => {
              onLocaleChange("en");
            }}
          >
            English
          </button>
        </fieldset>
      </header>

      {view ? (
        <>
          <ReporterView locale={locale} view={view} />
          <button
            className="primary-action retrieve-again"
            type="button"
            onClick={reset}
          >
            {copy.lookupAnother}
          </button>
        </>
      ) : (
        <section className="retrieve-shell" aria-labelledby="retrieve-title">
          <p className="eyebrow">Y7 Feedback</p>
          <h1 id="retrieve-title">{copy.title}</h1>
          <p className="lede">{copy.intro}</p>
          <form
            className="retrieve-form"
            noValidate
            onSubmit={(event) => {
              void retrieve(event);
            }}
          >
            <label className="field">
              <span>{copy.reference}</span>
              <input
                value={reference}
                autoComplete="off"
                onChange={(event) => {
                  setReference(event.currentTarget.value);
                  setOutcome(null);
                }}
              />
            </label>
            <label className="field">
              <span>{copy.accessProof}</span>
              <input
                type="password"
                value={proof}
                autoComplete="off"
                onChange={(event) => {
                  setProof(event.currentTarget.value);
                  setOutcome(null);
                }}
              />
            </label>
            {outcome ? (
              <p className="form-error" role="alert">
                {outcome === "denied" ? copy.denied : copy.retryable}
              </p>
            ) : null}
            <button className="primary-action" type="submit">
              {copy.retrieve}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
