import { useState } from "react";

import type { Locale } from "@y7-feedback/domain";

import { FeedbackIntake } from "./FeedbackIntake";
import { messages } from "./i18n/messages";
import { RetrieveFeedback, type AccountlessGateway } from "./RetrieveFeedback";

const unavailableGateway: AccountlessGateway = {
  retrieve: () => Promise.resolve({ status: "retryable" }),
};

export function App({
  accountlessGateway = unavailableGateway,
}: {
  readonly accountlessGateway?: AccountlessGateway;
}) {
  const [locale, setLocale] = useState<Locale>("fr");
  const copy = messages[locale];

  function selectLocale(nextLocale: Locale) {
    document.documentElement.lang = nextLocale;
    setLocale(nextLocale);
  }

  if (window.location.pathname === "/wisemoney") {
    return <FeedbackIntake locale={locale} onLocaleChange={selectLocale} />;
  }
  if (window.location.pathname === "/retrieve") {
    return (
      <RetrieveFeedback
        gateway={accountlessGateway}
        locale={locale}
        onLocaleChange={selectLocale}
      />
    );
  }

  return (
    <main className="root-page">
      <header className="masthead">
        <a className="brand" href="/" aria-label={copy.brandLabel}>
          Y7
        </a>
        <fieldset className="language-switcher">
          <legend>{copy.languageLabel}</legend>
          <button
            type="button"
            aria-pressed={locale === "fr"}
            onClick={() => {
              selectLocale("fr");
            }}
          >
            Français
          </button>
          <button
            type="button"
            aria-pressed={locale === "en"}
            onClick={() => {
              selectLocale("en");
            }}
          >
            English
          </button>
        </fieldset>
      </header>

      <section className="introduction" aria-labelledby="page-title">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1 id="page-title">{copy.title}</h1>
        <p className="lede">{copy.intro}</p>
      </section>

      <section className="intent-list" aria-label={copy.intentsLabel}>
        {copy.intents.map((intent) => (
          <article className="intent" key={intent.number}>
            <span className="intent-number" aria-hidden="true">
              {intent.number}
            </span>
            <div>
              <h2>{intent.title}</h2>
              <p>{intent.body}</p>
            </div>
            {intent.href ? (
              <a className="intent-action" href={intent.href}>
                {intent.action}
              </a>
            ) : (
              <span className="intent-action intent-action-disabled">
                {intent.action}
              </span>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
