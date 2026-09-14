import type { PublicConfig } from "@y7-feedback/config/public";

import { createAppwriteAdministrationSession } from "../AdministrationSession";

export function composeTeamSession(config: PublicConfig) {
  return createAppwriteAdministrationSession(
    config.appwriteEndpoint,
    config.appwriteProjectId,
  );
}
