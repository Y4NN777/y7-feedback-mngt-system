import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { Locale } from "@y7-feedback/domain";

import { AdministrationPage } from "./AdministrationPage";
import type { AdministrationGateway } from "./AdministrationGateway";
import type { AdministrationSession } from "./AdministrationSession";
import type { ConversationGateway } from "./ConversationGateway";
import { FeedbackIntake } from "./FeedbackIntake";
import { messages } from "./i18n/messages";
import type { IntakeGateway } from "./IntakeGateway";
import type { ProjectGateway } from "./ProjectGateway";
import { RetrieveFeedback, type AccountlessGateway } from "./RetrieveFeedback";
import type { WorkbenchGateway } from "./WorkbenchGateway";
import { WorkbenchPage } from "./WorkbenchPage";

const unavailableGateway: AccountlessGateway = {
  retrieve: () => Promise.resolve({ status: "retryable" }),
};
const unavailableIntakeGateway: IntakeGateway = {
  accept: () => Promise.resolve({ status: "retryable" }),
};
const unavailableProjectGateway: ProjectGateway = {
  resolve: () => Promise.resolve({ status: "unavailable" }),
};
const unavailableAdministrationGateway: AdministrationGateway = {
  execute: () => Promise.resolve({ status: "retryable" }),
};
const unavailableAdministrationSession: AdministrationSession = {
  createJwt: () => Promise.reject(new Error("SESSION_UNAVAILABLE")),
  signIn: () => Promise.resolve("denied"),
  signOut: () => Promise.resolve(),
};
const unavailableConversationGateway: ConversationGateway = {
  retrieve: () => Promise.resolve({ status: "retryable" }),
  execute: () => Promise.resolve({ status: "retryable" }),
};
const unavailableWorkbenchGateway: WorkbenchGateway = {
  list: () => Promise.resolve({ status: "retryable" }),
  read: () => Promise.resolve({ status: "retryable" }),
};
const projectSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function ProjectRoute({
  createOperationId,
  gateway,
  intakeGateway,
  locale,
  onLocaleChange,
  redirect,
  slug,
}: {
  readonly createOperationId: () => string;
  readonly gateway: ProjectGateway;
  readonly intakeGateway: IntakeGateway;
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly redirect: (canonicalSlug: string) => void;
  readonly slug: string;
}) {
  const copy = messages[locale];
  const query = useQuery({
    queryKey: ["public-project", slug],
    queryFn: () => gateway.resolve(slug),
    staleTime: 0,
    retry: false,
  });
  useEffect(() => {
    if (query.data?.status === "redirect") {
      redirect(query.data.canonicalSlug);
    }
  }, [query.data, redirect]);
  if (query.isPending || query.data?.status === "redirect") {
    return (
      <main className="root-page" data-visual-anchor="swiss">
        <p role="status">{copy.projectLoading}</p>
      </main>
    );
  }
  if (!query.data || query.data.status === "unavailable") {
    return (
      <main className="root-page" data-visual-anchor="swiss">
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
        <section className="introduction" aria-labelledby="project-unavailable-title">
          <h1 id="project-unavailable-title">{copy.projectUnavailable}</h1>
          <p>{copy.projectUnavailableHint}</p>
          <a href="/">{copy.brandLabel}</a>
        </section>
      </main>
    );
  }
  return (
    <FeedbackIntake
      createOperationId={createOperationId}
      gateway={intakeGateway}
      locale={locale}
      onLocaleChange={onLocaleChange}
      projectPurpose={query.data.purpose}
      projectSlug={query.data.slug}
    />
  );
}

export function App({
  accountlessGateway = unavailableGateway,
  administrationGateway = unavailableAdministrationGateway,
  administrationSession = unavailableAdministrationSession,
  conversationGateway = unavailableConversationGateway,
  createOperationId = () => crypto.randomUUID(),
  intakeGateway = unavailableIntakeGateway,
  projectGateway = unavailableProjectGateway,
  redirectProject = (canonicalSlug) => {
    window.location.replace(`/${canonicalSlug}`);
  },
  workbenchGateway = unavailableWorkbenchGateway,
}: {
  readonly accountlessGateway?: AccountlessGateway;
  readonly administrationGateway?: AdministrationGateway;
  readonly administrationSession?: AdministrationSession;
  readonly conversationGateway?: ConversationGateway;
  readonly createOperationId?: () => string;
  readonly intakeGateway?: IntakeGateway;
  readonly projectGateway?: ProjectGateway;
  readonly redirectProject?: (canonicalSlug: string) => void;
  readonly workbenchGateway?: WorkbenchGateway;
}) {
  const [locale, setLocale] = useState<Locale>("fr");
  const copy = messages[locale];

  function selectLocale(nextLocale: Locale) {
    document.documentElement.lang = nextLocale;
    setLocale(nextLocale);
  }

  if (window.location.pathname === "/retrieve") {
    return (
      <RetrieveFeedback
        conversationGateway={conversationGateway}
        createOperationId={createOperationId}
        gateway={accountlessGateway}
        locale={locale}
        onLocaleChange={selectLocale}
      />
    );
  }
  if (window.location.pathname === "/manage") {
    return (
      <AdministrationPage
        gateway={administrationGateway}
        locale={locale}
        onLocaleChange={selectLocale}
        session={administrationSession}
      />
    );
  }
  if (window.location.pathname === "/workbench") {
    return (
      <WorkbenchPage
        gateway={workbenchGateway}
        locale={locale}
        onLocaleChange={selectLocale}
        session={administrationSession}
      />
    );
  }
  const candidateSlug = window.location.pathname.slice(1);
  if (projectSlugPattern.test(candidateSlug)) {
    return (
      <ProjectRoute
        createOperationId={createOperationId}
        gateway={projectGateway}
        intakeGateway={intakeGateway}
        locale={locale}
        onLocaleChange={selectLocale}
        redirect={redirectProject}
        slug={candidateSlug}
      />
    );
  }

  return (
    <main className="root-page" data-visual-anchor="swiss">
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
