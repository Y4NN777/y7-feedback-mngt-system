import type {
  AppendConversationCommand,
  FeedbackLifecycleState,
  LifecycleTransitionCommand,
} from "@y7-feedback/domain";

type ConversationCommand = AppendConversationCommand | LifecycleTransitionCommand;

export class ConversationLifecyclePersistenceError extends Error {
  readonly code:
    | "ERR-CONV-DENIED"
    | "ERR-CONV-IDEMPOTENCY-CONFLICT"
    | "ERR-CONV-INVALID"
    | "ERR-CONV-RETRYABLE"
    | "ERR-CONV-STALE";

  constructor(code: ConversationLifecyclePersistenceError["code"]) {
    super(code);
    this.name = "AppwriteConversationLifecycleError";
    this.code = code;
  }
}

export class ConversationProjectionPersistenceError extends Error {
  readonly code: "ERR-CONV-DENIED" | "ERR-CONV-RETRYABLE";

  constructor(code: ConversationProjectionPersistenceError["code"]) {
    super(code);
    this.name = "AppwriteConversationProjectionError";
    this.code = code;
  }
}

export interface ConversationLifecycleStoreInput {
  readonly feedbackId: string;
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly payloadDigest: string;
  readonly locale: "fr" | "en";
  readonly command: ConversationCommand;
}

export type ConversationLifecycleStoreResult = {
  readonly status: "applied" | "replayed";
  readonly feedbackId: string;
  readonly action: ConversationCommand["kind"];
  readonly state?: FeedbackLifecycleState;
  readonly version?: number;
};

export interface ConversationLifecycleStore {
  execute(
    input: ConversationLifecycleStoreInput,
  ): Promise<ConversationLifecycleStoreResult>;
}

export interface ConversationProjectionMessage {
  readonly id: string;
  readonly actorId: string;
  readonly actorKind: "workspace" | "reporter";
  readonly audience: "workspace" | "reporter";
  readonly occurredAt: string;
  readonly content: string;
  readonly provider?: "github" | "gitlab";
  readonly revisionKind?: "created" | "revised" | "tombstoned";
  readonly supersedesMessageId?: string;
}

export interface ConversationProjectionLifecycleFact {
  readonly id: string;
  readonly priorState: FeedbackLifecycleState;
  readonly state: FeedbackLifecycleState;
  readonly actorId: string;
  readonly actorKind: "workspace" | "reporter";
  readonly occurredAt: string;
  readonly reason: string;
  readonly sequence: number;
}

export interface ReporterConversationProjection {
  readonly feedbackId: string;
  readonly state: FeedbackLifecycleState;
  readonly messages: readonly ConversationProjectionMessage[];
  readonly lifecycle: readonly ConversationProjectionLifecycleFact[];
}

export interface WorkspaceConversationProjection extends ReporterConversationProjection {
  readonly internalNotes: readonly ConversationProjectionMessage[];
}

export interface ConversationProjectionStore {
  readWorkspace(input: {
    readonly feedbackId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<WorkspaceConversationProjection>;
  readReporter(input: {
    readonly feedbackId: string;
  }): Promise<ReporterConversationProjection>;
}

export {
  ConversationLifecyclePersistenceError as AppwriteConversationLifecycleError,
  ConversationProjectionPersistenceError as AppwriteConversationProjectionError,
};
