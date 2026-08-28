import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Client, Realtime } from "appwrite";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { parsePublicConfig } from "@y7-feedback/config/public";

import { createHttpAccountlessGateway } from "./AccountlessHttpGateway";
import { createHttpAdministrationGateway } from "./AdministrationGateway";
import { createAppwriteAdministrationSession } from "./AdministrationSession";
import { App } from "./App";
import { createHttpConversationGateway } from "./ConversationGateway";
import { createHttpIntakeGateway } from "./IntakeGateway";
import { createHttpProjectGateway } from "./ProjectGateway";
import { createHttpWorkbenchGateway } from "./WorkbenchGateway";
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
const realtimeClient = new Client()
  .setEndpoint(config.appwriteEndpoint)
  .setProject(config.appwriteProjectId);
const realtime = new Realtime(realtimeClient);
const workbenchGateway = createHttpWorkbenchGateway(
  config.apiEndpoint,
  () => administrationSession.createJwt(),
  fetch,
  async (channel, invalidate) => {
    const subscription = await realtime.subscribe(channel, () => {
      invalidate();
    });
    return () => {
      void subscription.unsubscribe();
    };
  },
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
        projectGateway={projectGateway}
        workbenchGateway={workbenchGateway}
      />
      <OperationalTelemetry />
    </QueryClientProvider>
  </StrictMode>,
);
