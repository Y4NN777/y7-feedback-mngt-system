import type { FeedbackLifecycleState } from "./access.js";

export type ConversationActorKind = "reporter" | "workspace";

export interface FeedbackLifecycle {
  readonly feedbackId: string;
  readonly state: FeedbackLifecycleState;
  readonly version: number;
}

export interface LifecycleHistoryFact {
  readonly id: string;
  readonly feedbackId: string;
  readonly priorState: FeedbackLifecycleState;
  readonly state: FeedbackLifecycleState;
  readonly actorId: string;
  readonly actorKind: ConversationActorKind;
  readonly reason: string;
  readonly occurredAt: string;
  readonly sequence: number;
}

type TransitionKind =
  | "start_review"
  | "request_clarification"
  | "reporter_answer"
  | "resolve"
  | "close"
  | "reopen";

export interface LifecycleTransitionCommand {
  readonly kind: TransitionKind;
  readonly eventId: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly actorKind: ConversationActorKind;
  readonly occurredAt: string;
  readonly reason: string;
}

export interface ConversationMessage {
  readonly id: string;
  readonly actorId: string;
  readonly actorKind: ConversationActorKind;
  readonly audience: "reporter" | "workspace";
  readonly occurredAt: string;
  readonly content: string;
}

export interface InternalNote {
  readonly id: string;
  readonly actorId: string;
  readonly actorKind: "workspace";
  readonly audience: "workspace";
  readonly occurredAt: string;
  readonly content: string;
}

export interface ConversationState {
  readonly feedbackId: string;
  readonly messages: readonly ConversationMessage[];
  readonly internalNotes: readonly InternalNote[];
}

export type AppendConversationCommand =
  | {
      readonly kind: "append_message";
      readonly eventId: string;
      readonly actorId: string;
      readonly actorKind: ConversationActorKind;
      readonly audience: "reporter" | "workspace";
      readonly occurredAt: string;
      readonly content: string;
    }
  | {
      readonly kind: "append_internal_note";
      readonly eventId: string;
      readonly actorId: string;
      readonly actorKind: ConversationActorKind;
      readonly occurredAt: string;
      readonly content: string;
    };

export class ConversationLifecycleError extends Error {
  readonly code:
    | "ERR-CONVERSATION-COMMAND-INVALID"
    | "ERR-CONVERSATION-DENIED"
    | "ERR-CONVERSATION-ID-CONFLICT"
    | "ERR-LIFECYCLE-COMMAND-INVALID"
    | "ERR-LIFECYCLE-DENIED"
    | "ERR-LIFECYCLE-STALE"
    | "ERR-LIFECYCLE-TRANSITION-INVALID";

  constructor(code: ConversationLifecycleError["code"]) {
    super(code);
    this.name = "ConversationLifecycleError";
    this.code = code;
  }
}

function required(
  value: string,
  maximum: number,
  code: ConversationLifecycleError["code"],
) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new ConversationLifecycleError(code);
  }
  return normalized;
}

const transitions: Readonly<
  Record<
    TransitionKind,
    {
      readonly from: FeedbackLifecycleState;
      readonly to: FeedbackLifecycleState;
      readonly actor: ConversationActorKind;
    }
  >
> = {
  start_review: { from: "received", to: "under_review", actor: "workspace" },
  request_clarification: {
    from: "under_review",
    to: "awaiting_reporter",
    actor: "workspace",
  },
  reporter_answer: {
    from: "awaiting_reporter",
    to: "under_review",
    actor: "reporter",
  },
  resolve: { from: "under_review", to: "resolved", actor: "workspace" },
  close: { from: "resolved", to: "closed", actor: "workspace" },
  reopen: { from: "closed", to: "under_review", actor: "reporter" },
};

export function planLifecycleTransition(
  current: FeedbackLifecycle,
  command: LifecycleTransitionCommand,
): { readonly next: FeedbackLifecycle; readonly history: LifecycleHistoryFact } {
  if (!Number.isSafeInteger(current.version) || current.version < 1) {
    throw new ConversationLifecycleError("ERR-LIFECYCLE-COMMAND-INVALID");
  }
  if (command.expectedVersion !== current.version) {
    throw new ConversationLifecycleError("ERR-LIFECYCLE-STALE");
  }
  const rule = transitions[command.kind];
  if (rule.actor !== command.actorKind) {
    throw new ConversationLifecycleError("ERR-LIFECYCLE-DENIED");
  }
  if (rule.from !== current.state) {
    throw new ConversationLifecycleError("ERR-LIFECYCLE-TRANSITION-INVALID");
  }
  const id = required(command.eventId, 36, "ERR-LIFECYCLE-COMMAND-INVALID");
  const actorId = required(command.actorId, 36, "ERR-LIFECYCLE-COMMAND-INVALID");
  const reason = required(command.reason, 500, "ERR-LIFECYCLE-COMMAND-INVALID");
  const occurredAt = required(command.occurredAt, 40, "ERR-LIFECYCLE-COMMAND-INVALID");
  const version = current.version + 1;
  return {
    next: { feedbackId: current.feedbackId, state: rule.to, version },
    history: {
      id,
      feedbackId: current.feedbackId,
      priorState: current.state,
      state: rule.to,
      actorId,
      actorKind: command.actorKind,
      reason,
      occurredAt,
      sequence: version,
    },
  };
}

function sameEntry(
  entry: ConversationMessage | InternalNote,
  command: AppendConversationCommand,
): boolean {
  return (
    entry.id === command.eventId &&
    entry.actorId === command.actorId &&
    entry.actorKind === command.actorKind &&
    entry.occurredAt === command.occurredAt &&
    entry.content === command.content &&
    entry.audience ===
      (command.kind === "append_internal_note" ? "workspace" : command.audience)
  );
}

export function appendConversationEntry(
  state: ConversationState,
  command: AppendConversationCommand,
): { readonly status: "appended" | "replayed"; readonly state: ConversationState } {
  const existing = [...state.messages, ...state.internalNotes].find(
    (entry) => entry.id === command.eventId,
  );
  if (existing !== undefined) {
    if (sameEntry(existing, command)) return { status: "replayed", state };
    throw new ConversationLifecycleError("ERR-CONVERSATION-ID-CONFLICT");
  }
  const id = required(command.eventId, 36, "ERR-CONVERSATION-COMMAND-INVALID");
  const actorId = required(command.actorId, 36, "ERR-CONVERSATION-COMMAND-INVALID");
  const content = required(command.content, 10_000, "ERR-CONVERSATION-COMMAND-INVALID");
  const occurredAt = required(
    command.occurredAt,
    40,
    "ERR-CONVERSATION-COMMAND-INVALID",
  );
  if (command.kind === "append_internal_note") {
    if (command.actorKind !== "workspace") {
      throw new ConversationLifecycleError("ERR-CONVERSATION-DENIED");
    }
    return {
      status: "appended",
      state: {
        ...state,
        internalNotes: [
          ...state.internalNotes,
          {
            id,
            actorId,
            actorKind: "workspace",
            audience: "workspace",
            occurredAt,
            content,
          },
        ],
      },
    };
  }
  if (command.actorKind === "reporter" && command.audience !== "reporter") {
    throw new ConversationLifecycleError("ERR-CONVERSATION-DENIED");
  }
  return {
    status: "appended",
    state: {
      ...state,
      messages: [
        ...state.messages,
        {
          id,
          actorId,
          actorKind: command.actorKind,
          audience: command.audience,
          occurredAt,
          content,
        },
      ],
    },
  };
}

export function projectConversationForReporter(state: ConversationState): {
  readonly feedbackId: string;
  readonly messages: readonly ConversationMessage[];
} {
  return {
    feedbackId: state.feedbackId,
    messages: state.messages.filter((message) => message.audience === "reporter"),
  };
}
