import type {
  ActorAccess,
  FeedbackLifecycleState,
  FeedbackSource,
  ValidatedContext,
  WorkbenchFilter,
  WorkbenchInboxItem,
} from "@y7-feedback/domain";

export interface WorkbenchDetail {
  readonly feedbackId: string;
  readonly type: WorkbenchInboxItem["type"];
  readonly state: FeedbackLifecycleState;
  readonly acceptedAt: string;
  readonly source: FeedbackSource;
  readonly context: readonly ValidatedContext[];
  readonly attachmentNames: readonly string[];
  readonly classification: string | null;
  readonly assignedMaintainerId: string | null;
}

export class WorkbenchPersistenceError extends Error {
  readonly code: "ERR-WORK-DENIED" | "ERR-WORK-CONFLICT" | "ERR-WORK-RETRYABLE";

  constructor(code: WorkbenchPersistenceError["code"]) {
    super(code);
    this.name = "AppwriteWorkbenchError";
    this.code = code;
  }
}

export interface WorkbenchStore {
  list(input: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly filter: WorkbenchFilter;
  }): Promise<readonly WorkbenchInboxItem[]>;
  read(input: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
  }): Promise<WorkbenchDetail>;
}

export type WorkbenchCommand =
  | {
      readonly kind: "classify_feedback";
      readonly operationId: string;
      readonly classification: string;
    }
  | {
      readonly kind: "assign_feedback";
      readonly operationId: string;
      readonly maintainerId: string;
    }
  | { readonly kind: "unassign_feedback"; readonly operationId: string }
  | { readonly kind: "delete_feedback"; readonly operationId: string };

export interface WorkbenchMutationResult {
  readonly status: "applied" | "replayed";
  readonly feedbackId: string;
  readonly action: WorkbenchCommand["kind"];
}

export interface WorkbenchMutationStore {
  execute(input: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
    readonly command: WorkbenchCommand;
    readonly payloadDigest: string;
    readonly occurredAt: string;
  }): Promise<WorkbenchMutationResult>;
}

export { WorkbenchPersistenceError as AppwriteWorkbenchError };
