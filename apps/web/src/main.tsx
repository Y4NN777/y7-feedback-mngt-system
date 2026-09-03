import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { parsePublicConfig } from "@y7-feedback/config/public";

import { createHttpAccountlessGateway } from "./AccountlessHttpGateway";
import { createHttpAdministrationGateway } from "./AdministrationGateway";
import { createAppwriteAdministrationSession } from "./AdministrationSession";
import { App } from "./App";
import { createHttpConversationGateway } from "./ConversationGateway";
import { createHttpExternalIssueGateway } from "./ExternalIssueGateway";
import { createHttpIntakeGateway } from "./IntakeGateway";
import { createOfflineIntakePersistence } from "./OfflineIntake";
import { createOfflineIntakeReplay } from "./OfflineIntakeReplay";
import { createOfflineProjectGateway } from "./OfflineProjectGateway";
import { createHttpConnectivityProbe } from "./OfflineReplay";
import { createIndexedDbOfflineStore } from "./OfflineStore";
import { createHttpIntelligenceGateway } from "./IntelligenceGateway";
import { createAppwriteNotificationInvalidation } from "./NotificationInvalidation";
import { createHttpProjectGateway } from "./ProjectGateway";
import { createHttpPublicationConsentGateway } from "./PublicationConsentGateway";
import { createHttpPrivacyGateway } from "./PrivacyGateway";
import { createHttpWorkbenchGateway } from "./WorkbenchGateway";
import { createHttpSourceManagementGateway } from "./SourceManagementGateway";
import { OperationalTelemetry } from "./observability/OperationalTelemetry";
import { PwaLifecycle } from "./PwaLifecycle";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");
const queryClient = new QueryClient();
const config = parsePublicConfig(import.meta.env);
const intakeGateway = createHttpIntakeGateway(config.apiEndpoint);
const offlineStore = createIndexedDbOfflineStore({});
const offlinePersistence = createOfflineIntakePersistence(
  offlineStore,
  config.environment,
);
const offlineReplay = createOfflineIntakeReplay({
  store: offlineStore,
  environment: config.environment,
  gateway: intakeGateway,
  probe: createHttpConnectivityProbe(config.apiEndpoint),
});
const accountlessGateway = createHttpAccountlessGateway(config.apiEndpoint);
const conversationGateway = createHttpConversationGateway(config.apiEndpoint);
const projectGateway = createOfflineProjectGateway(
  createHttpProjectGateway(config.apiEndpoint),
  offlineStore,
  config.environment,
);
const publicationConsentGateway = createHttpPublicationConsentGateway(
  config.apiEndpoint,
);
const privacyGateway = createHttpPrivacyGateway(config.apiEndpoint);
const administrationSession = createAppwriteAdministrationSession(
  config.appwriteEndpoint,
  config.appwriteProjectId,
);
const administrationGateway = createHttpAdministrationGateway(config.apiEndpoint, () =>
  administrationSession.createJwt(),
);
const workbenchGateway = createHttpWorkbenchGateway(config.apiEndpoint, () =>
  administrationSession.createJwt(),
);
const intelligenceGateway = createHttpIntelligenceGateway(config.apiEndpoint, () =>
  administrationSession.createJwt(),
);
const notificationInvalidation = createAppwriteNotificationInvalidation(
  config.appwriteEndpoint,
  config.appwriteProjectId,
);
const sourceManagementGateway = createHttpSourceManagementGateway(
  config.apiEndpoint,
  () => administrationSession.createJwt(),
);
const externalIssueGateway = createHttpExternalIssueGateway(config.apiEndpoint, () =>
  administrationSession.createJwt(),
);

if (!root) {
  throw new Error("Application root is missing");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App
        accountlessGateway={accountlessGateway}
        administrationGateway={administrationGateway}
        administrationSession={administrationSession}
        conversationGateway={conversationGateway}
        externalIssueGateway={externalIssueGateway}
        intakeGateway={intakeGateway}
        offlinePersistence={offlinePersistence}
        offlineReplay={offlineReplay}
        intelligenceGateway={intelligenceGateway}
        notificationInvalidation={notificationInvalidation}
        projectGateway={projectGateway}
        publicationConsentGateway={publicationConsentGateway}
        privacyGateway={privacyGateway}
        workbenchGateway={workbenchGateway}
        sourceManagementGateway={sourceManagementGateway}
      />
      <OperationalTelemetry />
      <PwaLifecycle />
    </QueryClientProvider>
  </StrictMode>,
);
