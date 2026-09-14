import type { PublicConfig } from "@y7-feedback/config/public";

import type { AppProps } from "../App";
import type { ApplicationRoute } from "../ApplicationRoute";

export async function composeRouteDependencies(
  config: PublicConfig,
  route: ApplicationRoute,
): Promise<AppProps> {
  switch (route.kind) {
    case "root":
      return {};
    case "retrieve":
      return (await import("./retrieval")).composeRetrieval(config);
    case "project":
      return (await import("./intake")).composeIntake(config);
    case "administration":
    case "intelligence":
    case "platform-access":
    case "sources":
    case "workbench":
      return (await import("./teamRoutes")).composeTeamRoute(config, route.kind);
  }
}
