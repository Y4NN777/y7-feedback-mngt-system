import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { parsePublicConfig } from "@y7-feedback/config/public";

import { createHttpAccountlessGateway } from "./AccountlessHttpGateway";
import { createHttpAdministrationGateway } from "./AdministrationGateway";
import { createAppwriteAdministrationSession } from "./AdministrationSession";
import { App } from "./App";
import { createHttpConversationGateway } from "./ConversationGateway";
import { createHttpIntakeGateway } from "./IntakeGateway";
import { createAppwriteNotificationInvalidation } from "./NotificationInvalidation";
import { createHttpProjectGateway } from "./ProjectGateway";
import { createHttpWorkbenchGateway } from "./WorkbenchGateway";
import { createHttpSourceManagementGateway } from "./SourceManagementGateway";
import { OperationalTelemetry } from "./observability/OperationalTelemetry";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");
const queryClient = new QueryClient();
const config = parsePublicConfig(import.meta.env);
const intakeGateway = createHttpIntakeGateway(config.apiEndpoint);
const accountlessGateway = createHttpAccountlessGateway(config.apiEndpoint);
const conversationGateway = createHttpConversationGateway(config.apiEndpoint);
const projectGateway = createHttpProjectGateway(config.apiEndpoint);
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
const notificationInvalidation = createAppwriteNotificationInvalidation(
  config.appwriteEndpoint,
  config.appwriteProjectId,
);
const sourceManagementGateway = createHttpSourceManagementGateway(
  config.apiEndpoint,
  () => administrationSession.createJwt(),
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
        intakeGateway={intakeGateway}
        notificationInvalidation={notificationInvalidation}
        projectGateway={projectGateway}
        workbenchGateway={workbenchGateway}
        sourceManagementGateway={sourceManagementGateway}
      />
      <OperationalTelemetry />
    </QueryClientProvider>
  </StrictMode>,
);
