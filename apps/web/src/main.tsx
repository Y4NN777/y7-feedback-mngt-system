import "@fontsource-variable/epilogue";
import "@fontsource-variable/fraunces";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { parsePublicConfig } from "@y7-feedback/config/public";

import { App } from "./App";
import { resolveApplicationRoute } from "./ApplicationRoute";
import { composeRouteDependencies } from "./composition/routeDependencies";
import { OperationalTelemetry } from "./observability/OperationalTelemetry";
import { PwaLifecycle } from "./PwaLifecycle";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");
const queryClient = new QueryClient();
const config = parsePublicConfig(import.meta.env);
const route = resolveApplicationRoute(window.location.pathname);
const routeDependencies = await composeRouteDependencies(config, route);

if (!root) {
  throw new Error("Application root is missing");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App {...routeDependencies} />
      <OperationalTelemetry />
      <PwaLifecycle />
    </QueryClientProvider>
  </StrictMode>,
);
