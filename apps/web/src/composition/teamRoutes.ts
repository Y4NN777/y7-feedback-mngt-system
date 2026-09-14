import type { PublicConfig } from "@y7-feedback/config/public";

import { createHttpAdministrationGateway } from "../AdministrationGateway";
import type { AppProps } from "../App";
import { createHttpExternalIssueGateway } from "../ExternalIssueGateway";
import { createHttpIntelligenceGateway } from "../IntelligenceGateway";
import { createAppwriteNotificationInvalidation } from "../NotificationInvalidation";
import { createHttpPlatformAccessGateway } from "../PlatformAccessGateway";
import { createHttpSourceManagementGateway } from "../SourceManagementGateway";
import { createHttpWorkbenchGateway } from "../WorkbenchGateway";
import { composeTeamSession } from "./teamSession";

type TeamRouteKind =
  "administration" | "intelligence" | "platform-access" | "sources" | "workbench";

export function composeTeamRoute(config: PublicConfig, kind: TeamRouteKind): AppProps {
  const administrationSession = composeTeamSession(config);
  const authenticate = () => administrationSession.createJwt();
  const common = { administrationSession };

  switch (kind) {
    case "administration":
      return {
        ...common,
        administrationGateway: createHttpAdministrationGateway(
          config.apiEndpoint,
          authenticate,
        ),
      };
    case "intelligence":
      return {
        ...common,
        intelligenceGateway: createHttpIntelligenceGateway(
          config.apiEndpoint,
          authenticate,
        ),
      };
    case "platform-access":
      return {
        ...common,
        platformAccessGateway: createHttpPlatformAccessGateway(
          config.apiEndpoint,
          authenticate,
        ),
      };
    case "sources":
      return {
        ...common,
        sourceManagementGateway: createHttpSourceManagementGateway(
          config.apiEndpoint,
          authenticate,
        ),
      };
    case "workbench":
      return {
        ...common,
        externalIssueGateway: createHttpExternalIssueGateway(
          config.apiEndpoint,
          authenticate,
        ),
        notificationInvalidation: createAppwriteNotificationInvalidation(
          config.appwriteEndpoint,
          config.appwriteProjectId,
        ),
        workbenchGateway: createHttpWorkbenchGateway(config.apiEndpoint, authenticate),
      };
  }
}
