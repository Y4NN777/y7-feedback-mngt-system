import { lazy, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import type { Locale } from "@y7-feedback/domain";

import type { AdministrationGateway } from "./AdministrationGateway";
import type { AdministrationSession } from "./AdministrationSession";
import type { ConversationGateway } from "./ConversationGateway";
import type { ExternalIssueGateway } from "./ExternalIssueGateway";
import type { OfflineIntakePersistence } from "./FeedbackIntakeContracts";
import { resolveApplicationRoute } from "./ApplicationRoute";
import { messages } from "./i18n/messages";
import type { IntakeGateway } from "./IntakeGateway";
import type { IntelligenceGateway } from "./IntelligenceGateway";
import type { NotificationInvalidation } from "./NotificationInvalidation";
import type { OfflineIntakeReplay } from "./OfflineIntakeReplay";
import type { ProjectGateway } from "./ProjectGateway";
import type { PublicationConsentGateway } from "./PublicationConsentGateway";
import type { PrivacyGateway } from "./PrivacyGateway";
import type { PlatformAccessGateway } from "./PlatformAccessGateway";
import type { AccountlessGateway } from "./RetrieveFeedback";
import { RouteBoundary } from "./RouteBoundary";
import type { WorkbenchGateway } from "./WorkbenchGateway";
import type { SourceManagementGateway } from "./SourceManagementGateway";
const AdministrationPage = lazy(() =>
  import("./AdministrationPage").then(({ AdministrationPage }) => ({
    default: AdministrationPage,
  })),
);
const FeedbackIntake = lazy(() =>
  import("./FeedbackIntake").then(({ FeedbackIntake }) => ({
    default: FeedbackIntake,
  })),
);
const IntelligencePage = lazy(() =>
  import("./IntelligencePage").then(({ IntelligencePage }) => ({
    default: IntelligencePage,
  })),
);
const PlatformAccessPage = lazy(() =>
  import("./PlatformAccessPage").then(({ PlatformAccessPage }) => ({
    default: PlatformAccessPage,
  })),
);
const RetrieveFeedback = lazy(() =>
  import("./RetrieveFeedback").then(({ RetrieveFeedback }) => ({
    default: RetrieveFeedback,
  })),
);
const SourceManagementPage = lazy(() =>
  import("./SourceManagementPage").then(({ SourceManagementPage }) => ({
    default: SourceManagementPage,
  })),
);
const WorkbenchPage = lazy(() =>
  import("./WorkbenchPage").then(({ WorkbenchPage }) => ({ default: WorkbenchPage })),
);

const unavailableGateway: AccountlessGateway = {
  retrieve: () => Promise.resolve({ status: "retryable" }),
};
const unavailableIntakeGateway: IntakeGateway = {
  accept: () => Promise.resolve({ status: "retryable" }),
};
const unavailableIntelligenceGateway: IntelligenceGateway = {
  analyze: () => Promise.resolve({ status: "retryable" }),
  mutate: () => Promise.resolve({ status: "retryable" }),
};
const unavailableProjectGateway: ProjectGateway = {
  resolve: () => Promise.resolve({ status: "unavailable" }),
};
const unavailablePublicationConsentGateway: PublicationConsentGateway = {
  grant: () => Promise.resolve({ status: "retryable" }),
  revoke: () => Promise.resolve({ status: "retryable" }),
};
const unavailablePrivacyGateway: PrivacyGateway = {
  requestDeletion: () => Promise.resolve({ status: "retryable" }),
};
const unavailablePlatformAccessGateway: PlatformAccessGateway = {
  execute: () => Promise.resolve({ status: "retryable" }),
};
const unavailableAdministrationGateway: AdministrationGateway = {
  execute: () => Promise.resolve({ status: "retryable" }),
};
const unavailableAdministrationSession: AdministrationSession = {
  createJwt: () => Promise.reject(new Error("SESSION_UNAVAILABLE")),
  current: () => Promise.resolve("anonymous"),
  signIn: () => Promise.resolve("denied"),
  signOut: () => Promise.resolve(),
};
const unavailableConversationGateway: ConversationGateway = {
  retrieve: () => Promise.resolve({ status: "retryable" }),
  execute: () => Promise.resolve({ status: "retryable" }),
};
const unavailableExternalIssueGateway: ExternalIssueGateway = {
  repositories: () => Promise.resolve({ status: "retryable" }),
  link: () => Promise.resolve({ status: "retryable" }),
};
const unavailableWorkbenchGateway: WorkbenchGateway = {
  list: () => Promise.resolve({ status: "retryable" }),
  read: () => Promise.resolve({ status: "retryable" }),
  execute: () => Promise.resolve({ status: "retryable" }),
  conversation: () => Promise.resolve({ status: "retryable" }),
  notifications: () => Promise.resolve({ status: "retryable" }),
  markNotificationRead: () => Promise.resolve({ status: "retryable" }),
  authorizeNotificationRealtime: () => Promise.resolve({ status: "retryable" }),
};
const unavailableNotificationInvalidation: NotificationInvalidation = {
  subscribe: () => Promise.resolve(() => Promise.resolve()),
};
const unavailableSourceManagementGateway: SourceManagementGateway = {
  list: () => Promise.resolve({ status: "retryable" }),
  begin: () => Promise.resolve({ status: "retryable" }),
  select: () => Promise.resolve({ status: "retryable" }),
  refresh: () => Promise.resolve({ status: "retryable" }),
  disconnect: () => Promise.resolve({ status: "retryable" }),
};

function ProjectRoute({
  createOperationId,
  gateway,
  intakeGateway,
  offlinePersistence,
  offlineReplay,
  locale,
  onLocaleChange,
  redirect,
  slug,
}: {
  readonly createOperationId: () => string;
  readonly gateway: ProjectGateway;
  readonly intakeGateway: IntakeGateway;
  readonly offlinePersistence?: OfflineIntakePersistence;
  readonly offlineReplay?: OfflineIntakeReplay;
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
      <main className="root-page" data-visual-anchor="organic">
        <p role="status">{copy.projectLoading}</p>
      </main>
    );
  }
  if (!query.data || query.data.status === "unavailable") {
    return (
      <main
        className="root-page entry-surface unavailable-project-page"
        data-visual-anchor="organic"
      >
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
        <section className="introduction" aria-labelledby="project-unavailable-title">
          <p className="eyebrow">Y7 Feedback</p>
          <h1 id="project-unavailable-title">{copy.projectUnavailable}</h1>
          <p className="lede">{copy.projectUnavailableHint}</p>
          <div className="entry-actions">
            <a className="primary-link" href="/">
              {copy.projectUnavailableHome}
            </a>
            <a className="secondary-link" href="/retrieve">
              {copy.projectUnavailableRetrieve}
            </a>
          </div>
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
      {...(offlinePersistence ? { offlinePersistence } : {})}
      {...(offlineReplay ? { offlineReplay } : {})}
      projectPurpose={query.data.purpose}
      projectSlug={query.data.slug}
    />
  );
}

export type AppProps = {
  readonly accountlessGateway?: AccountlessGateway;
  readonly administrationGateway?: AdministrationGateway;
  readonly administrationSession?: AdministrationSession;
  readonly conversationGateway?: ConversationGateway;
  readonly externalIssueGateway?: ExternalIssueGateway;
  readonly createOperationId?: () => string;
  readonly intakeGateway?: IntakeGateway;
  readonly offlinePersistence?: OfflineIntakePersistence;
  readonly offlineReplay?: OfflineIntakeReplay;
  readonly intelligenceGateway?: IntelligenceGateway;
  readonly projectGateway?: ProjectGateway;
  readonly publicationConsentGateway?: PublicationConsentGateway;
  readonly privacyGateway?: PrivacyGateway;
  readonly platformAccessGateway?: PlatformAccessGateway;
  readonly redirectProject?: (canonicalSlug: string) => void;
  readonly workbenchGateway?: WorkbenchGateway;
  readonly notificationInvalidation?: NotificationInvalidation;
  readonly sourceManagementGateway?: SourceManagementGateway;
};

export function App({
  accountlessGateway = unavailableGateway,
  administrationGateway = unavailableAdministrationGateway,
  administrationSession = unavailableAdministrationSession,
  conversationGateway = unavailableConversationGateway,
  externalIssueGateway = unavailableExternalIssueGateway,
  createOperationId = () => crypto.randomUUID(),
  intakeGateway = unavailableIntakeGateway,
  offlinePersistence,
  offlineReplay,
  intelligenceGateway = unavailableIntelligenceGateway,
  projectGateway = unavailableProjectGateway,
  publicationConsentGateway = unavailablePublicationConsentGateway,
  privacyGateway = unavailablePrivacyGateway,
  platformAccessGateway = unavailablePlatformAccessGateway,
  redirectProject = (canonicalSlug) => {
    window.location.replace(`/${canonicalSlug}`);
  },
  workbenchGateway = unavailableWorkbenchGateway,
  notificationInvalidation = unavailableNotificationInvalidation,
  sourceManagementGateway = unavailableSourceManagementGateway,
}: AppProps) {
  const [locale, setLocale] = useState<Locale>("fr");
  const copy = messages[locale];

  function selectLocale(nextLocale: Locale) {
    document.documentElement.lang = nextLocale;
    setLocale(nextLocale);
  }

  const route = resolveApplicationRoute(window.location.pathname);
  let feature: ReactNode;

  if (route.kind === "retrieve") {
    feature = (
      <RetrieveFeedback
        conversationGateway={conversationGateway}
        createOperationId={createOperationId}
        gateway={accountlessGateway}
        locale={locale}
        onLocaleChange={selectLocale}
        publicationConsentGateway={publicationConsentGateway}
        privacyGateway={privacyGateway}
      />
    );
  } else if (route.kind === "administration") {
    feature = (
      <AdministrationPage
        gateway={administrationGateway}
        locale={locale}
        onLocaleChange={selectLocale}
        session={administrationSession}
      />
    );
  } else if (route.kind === "workbench") {
    feature = (
      <WorkbenchPage
        createOperationId={createOperationId}
        externalIssueGateway={externalIssueGateway}
        gateway={workbenchGateway}
        locale={locale}
        notificationInvalidation={notificationInvalidation}
        onLocaleChange={selectLocale}
        session={administrationSession}
      />
    );
  } else if (route.kind === "intelligence") {
    feature = (
      <IntelligencePage
        gateway={intelligenceGateway}
        locale={locale}
        onLocaleChange={selectLocale}
        session={administrationSession}
      />
    );
  } else if (route.kind === "sources") {
    feature = (
      <SourceManagementPage
        gateway={sourceManagementGateway}
        locale={locale}
        onLocaleChange={selectLocale}
        session={administrationSession}
      />
    );
  } else if (route.kind === "platform-access") {
    feature = (
      <PlatformAccessPage
        gateway={platformAccessGateway}
        locale={locale}
        onLocaleChange={selectLocale}
        session={administrationSession}
      />
    );
  } else if (route.kind === "project") {
    feature = (
      <ProjectRoute
        createOperationId={createOperationId}
        gateway={projectGateway}
        intakeGateway={intakeGateway}
        locale={locale}
        onLocaleChange={selectLocale}
        redirect={redirectProject}
        slug={route.slug}
        {...(offlinePersistence ? { offlinePersistence } : {})}
        {...(offlineReplay ? { offlineReplay } : {})}
      />
    );
  } else {
    feature = null;
  }

  if (feature) {
    return <RouteBoundary locale={locale}>{feature}</RouteBoundary>;
  }

  return (
    <main className="root-page" data-visual-anchor="organic">
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
              <span className="intent-status">{intent.action}</span>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
