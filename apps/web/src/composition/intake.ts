import type { PublicConfig } from "@y7-feedback/config/public";

import type { AppProps } from "../App";
import { createHttpIntakeGateway } from "../IntakeGateway";
import { createOfflineIntakePersistence } from "../OfflineIntake";
import { createOfflineIntakeReplay } from "../OfflineIntakeReplay";
import { createOfflineProjectGateway } from "../OfflineProjectGateway";
import { createHttpConnectivityProbe } from "../OfflineReplay";
import { createIndexedDbOfflineStore } from "../OfflineStore";
import { createHttpProjectGateway } from "../ProjectGateway";

export function composeIntake(config: PublicConfig): AppProps {
  const intakeGateway = createHttpIntakeGateway(config.apiEndpoint);
  const offlineStore = createIndexedDbOfflineStore({});
  return {
    intakeGateway,
    offlinePersistence: createOfflineIntakePersistence(
      offlineStore,
      config.environment,
    ),
    offlineReplay: createOfflineIntakeReplay({
      store: offlineStore,
      environment: config.environment,
      gateway: intakeGateway,
      probe: createHttpConnectivityProbe(config.apiEndpoint),
    }),
    projectGateway: createOfflineProjectGateway(
      createHttpProjectGateway(config.apiEndpoint),
      offlineStore,
      config.environment,
    ),
  };
}
