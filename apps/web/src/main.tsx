import "@fontsource-variable/epilogue";
import "@fontsource-variable/fraunces";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { parsePublicConfig } from "@y7-feedback/config/public";

import { createHttpAccountlessGateway } from "./AccountlessHttpGateway";
import { App } from "./App";
import { createHttpIntakeGateway } from "./IntakeGateway";
import { createHttpProjectGateway } from "./ProjectGateway";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");
const queryClient = new QueryClient();
const config = parsePublicConfig(import.meta.env);
const intakeGateway = createHttpIntakeGateway(config.apiEndpoint);
const accountlessGateway = createHttpAccountlessGateway(config.apiEndpoint);
const projectGateway = createHttpProjectGateway(config.apiEndpoint);

if (!root) {
  throw new Error("Application root is missing");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App
        accountlessGateway={accountlessGateway}
        intakeGateway={intakeGateway}
        projectGateway={projectGateway}
      />
    </QueryClientProvider>
  </StrictMode>,
);
