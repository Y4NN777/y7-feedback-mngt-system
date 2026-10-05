import type { HttpDependencies } from "./http.js";
import type { HttpRoute } from "./http-route-registry.js";

export function composeHttpRouteRegistry(
  dependencies: HttpDependencies,
): readonly HttpRoute[] {
  const routes: HttpRoute[] = [];

  const providerWebhook = dependencies.providerWebhook;
  if (providerWebhook !== undefined)
    routes.push({
      operation: "provider_webhook",
      handle: (request) =>
        providerWebhook.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          ...(request.bodyBinary === undefined ? {} : { body: request.bodyBinary }),
        }),
    });

  const providerMaintenanceHttp = dependencies.providerMaintenanceHttp;
  if (providerMaintenanceHttp !== undefined)
    routes.push({
      operation: "provider_maintenance",
      handle: (request) =>
        providerMaintenanceHttp.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
        }),
    });

  const providerEventInbox = dependencies.providerEventInbox;
  if (providerEventInbox !== undefined)
    routes.push({
      operation: "provider_event_inbox",
      handle: (request) =>
        providerEventInbox.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
        }),
    });

  const providerIssueOutbox = dependencies.providerIssueOutbox;
  if (providerIssueOutbox !== undefined)
    routes.push({
      operation: "provider_issue_outbox",
      handle: (request) =>
        providerIssueOutbox.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
        }),
    });

  const sourceConnections = dependencies.sourceConnections;
  if (sourceConnections !== undefined)
    routes.push({
      operation: "source_connection",
      handle: (request) =>
        sourceConnections.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          query: request.query,
          body: request.body,
        }),
    });

  const projectAdministration = dependencies.projectAdministration;
  if (projectAdministration !== undefined)
    routes.push({
      operation: "project_administration",
      handle: (request) =>
        projectAdministration.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
        }),
    });

  const platformAccess = dependencies.platformAccess;
  if (platformAccess !== undefined)
    routes.push({
      operation: "platform_access",
      handle: (request) =>
        platformAccess.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
        }),
    });

  const conversationLifecycle = dependencies.conversationLifecycle;
  if (conversationLifecycle !== undefined)
    routes.push({
      operation: "conversation_lifecycle",
      handle: (request) =>
        conversationLifecycle.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
        }),
    });

  const workbench = dependencies.workbench;
  if (workbench !== undefined)
    routes.push({
      operation: "workbench",
      handle: (request) =>
        workbench.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          query: request.query,
          body: request.body,
        }),
    });

  const externalIssue = dependencies.externalIssue;
  if (externalIssue !== undefined)
    routes.push({
      operation: "external_issue",
      handle: (request) =>
        externalIssue.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
        }),
    });

  const intelligence = dependencies.intelligence;
  if (intelligence !== undefined)
    routes.push({
      operation: "intelligence",
      handle: (request) =>
        intelligence.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
        }),
    });

  const privacy = dependencies.privacy;
  if (privacy !== undefined)
    routes.push({
      operation: "privacy",
      handle: (request) =>
        privacy.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
        }),
    });

  const publicApi = dependencies.publicApi;
  if (publicApi !== undefined)
    routes.push({
      operation: "public_api",
      handle: (request) =>
        publicApi.handle({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
          ...(request.bodyBinary === undefined
            ? {}
            : { bodyBinary: request.bodyBinary }),
        }),
    });

  return routes;
}
