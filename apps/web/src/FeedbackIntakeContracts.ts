import type { FeedbackType } from "@y7-feedback/domain";

import type { IntakeGatewayCommand } from "./IntakeGateway";

export interface DraftFields {
  readonly appreciation: string;
  readonly contact: string;
  readonly expected: string;
  readonly experience: string;
  readonly observed: string;
  readonly problem: string;
  readonly proposal: string;
  readonly rationale: string;
  readonly reproduction: string;
  readonly type: FeedbackType;
  readonly usageContext: string;
  readonly version: string;
}

export interface OfflineIntakePersistence {
  restore(projectSlug: string): Promise<DraftFields | null>;
  save(projectSlug: string, draft: DraftFields): Promise<void>;
  clear(projectSlug: string): Promise<void>;
  queue(command: IntakeGatewayCommand): Promise<void>;
}
