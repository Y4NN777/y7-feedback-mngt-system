import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { parsePublicConfig } from "@y7-feedback/config/public";

import { createHttpAccountlessGateway } from "./AccountlessHttpGateway";
import { createHttpAdministrationGateway } from "./AdministrationGateway";
import { createAppwriteAdministrationSession } from "./AdministrationSession";
import { App } from "./App";
import { createHttpIntakeGateway } from "./IntakeGateway";
import { createHttpProjectGateway } from "./ProjectGateway";
import { OperationalTelemetry } from "./observability/OperationalTelemetry";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");
const queryClient = new QueryClient();
const config = parsePublicConfig(import.meta.env);
const intakeGateway = createHttpIntakeGateway(config.apiEndpoint);
const accountlessGateway = createHttpAccountlessGateway(config.apiEndpoint);
const projectGateway = createHttpProjectGateway(config.apiEndpoint);
const administrationSession = createAppwriteAdministrationSession(
  config.appwriteEndpoint,
  config.appwriteProjectId,
);
const administrationGateway = createHttpAdministrationGateway(config.apiEndpoint, () =>
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
        intakeGateway={intakeGateway}
        projectGateway={projectGateway}
      />
      <OperationalTelemetry />
    </QueryClientProvider>
  </StrictMode>,
);
