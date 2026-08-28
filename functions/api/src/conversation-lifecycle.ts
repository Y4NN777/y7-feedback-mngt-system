import type {
  AppendConversationCommand,
  LifecycleTransitionCommand,
} from "@y7-feedback/domain";

import type { AccountlessAccessCoordinator } from "./accountless-access.js";
import {
  AppwriteConversationLifecycleError,
  type ConversationLifecycleStore,
  type ConversationLifecycleStoreResult,
} from "./appwrite-conversation-lifecycle-store.js";
import type { WorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope.js";
import type { AppwritePrincipalVerifier } from "./workspace-attachment-download.js";

type Command = AppendConversationCommand | LifecycleTransitionCommand;

export type ConversationLifecycleOutcome =
  | { readonly status: "ok"; readonly result: ConversationLifecycleStoreResult }
  | {
      readonly status: "invalid" | "denied" | "conflict" | "stale" | "retryable";
    };

export interface ConversationLifecycleCoordinator {
  executeWorkspace(input: {
    readonly jwt: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
    readonly command: unknown;
  }): Promise<ConversationLifecycleOutcome>;
  executeReporter(input: {
    readonly reference: string;
    readonly proof: string;
    readonly feedbackId: string;
    readonly command: unknown;
  }): Promise<ConversationLifecycleOutcome>;
}

export interface ConversationLifecycleDependencies {
  readonly digest: (value: unknown) => string;
  readonly now: () => string;
  readonly reporterActorId: (reference: string) => string;
}

type ParsedCommand =
  | {
      readonly kind: "append_message";
      readonly eventId: string;
      readonly audience: "reporter" | "workspace";
      readonly content: string;
    }
  | {
      readonly kind: "append_internal_note";
      readonly eventId: string;
      readonly content: string;
    }
  | {
      readonly kind:
        | "start_review"
        | "request_clarification"
        | "reporter_answer"
        | "resolve"
        | "close"
        | "reopen";
      readonly eventId: string;
      readonly expectedVersion: number;
      readonly reason: string;
    };

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum
    ? value.trim()
    : undefined;
}

function parse(value: unknown): ParsedCommand | undefined {
  if (!object(value)) return undefined;
  const eventId = text(value.eventId, 36);
  if (eventId === undefined) return undefined;
  if (value.kind === "append_message") {
    const content = text(value.content, 10_000);
    if (
      content === undefined ||
      (value.audience !== "reporter" && value.audience !== "workspace")
    ) {
      return undefined;
    }
    return { kind: value.kind, eventId, audience: value.audience, content };
  }
  if (value.kind === "append_internal_note") {
    const content = text(value.content, 10_000);
    return content === undefined ? undefined : { kind: value.kind, eventId, content };
  }
  if (
    value.kind !== "start_review" &&
    value.kind !== "request_clarification" &&
    value.kind !== "reporter_answer" &&
    value.kind !== "resolve" &&
    value.kind !== "close" &&
    value.kind !== "reopen"
  ) {
    return undefined;
  }
  const reason = text(value.reason, 500);
  if (
    reason === undefined ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1
  ) {
    return undefined;
  }
  return {
    kind: value.kind,
    eventId,
    expectedVersion: value.expectedVersion,
    reason,
  };
}

function trusted(
  parsed: ParsedCommand,
  actorId: string,
  actorKind: "workspace" | "reporter",
  occurredAt: string,
): Command | undefined {
  if (parsed.kind === "append_internal_note") {
    return actorKind === "workspace"
      ? { ...parsed, actorId, actorKind, occurredAt }
      : undefined;
  }
  if (parsed.kind === "append_message") {
    if (actorKind === "reporter" && parsed.audience !== "reporter") return undefined;
    return { ...parsed, actorId, actorKind, occurredAt };
  }
  const reporterCommand = parsed.kind === "reporter_answer" || parsed.kind === "reopen";
  if (reporterCommand !== (actorKind === "reporter")) return undefined;
  return { ...parsed, actorId, actorKind, occurredAt };
}

function failure(error: unknown): ConversationLifecycleOutcome {
  if (error instanceof AppwriteConversationLifecycleError) {
    if (error.code === "ERR-CONV-DENIED") return { status: "denied" };
    if (error.code === "ERR-CONV-IDEMPOTENCY-CONFLICT") {
      return { status: "conflict" };
    }
    if (error.code === "ERR-CONV-STALE") return { status: "stale" };
    if (error.code === "ERR-CONV-INVALID") return { status: "invalid" };
  }
  return { status: "retryable" };
}

export function createConversationLifecycleCoordinator(
  principal: AppwritePrincipalVerifier,
  workspaceScope: WorkspaceCapabilityScopeResolver,
  accountless: AccountlessAccessCoordinator,
  store: ConversationLifecycleStore,
  dependencies: ConversationLifecycleDependencies,
): ConversationLifecycleCoordinator {
  async function commit(
    input: {
      readonly workspaceId?: string;
      readonly projectId?: string;
      readonly feedbackId: string;
    },
    parsed: ParsedCommand,
    actorId: string,
    actorKind: "workspace" | "reporter",
  ): Promise<ConversationLifecycleOutcome> {
    const command = trusted(parsed, actorId, actorKind, dependencies.now());
    if (command === undefined) return { status: "denied" };
    try {
      const result = await store.execute({
        ...input,
        command,
        payloadDigest: dependencies.digest(command),
      });
      return { status: "ok", result };
    } catch (error: unknown) {
      return failure(error);
    }
  }

  return {
    async executeWorkspace(input) {
      const parsed = parse(input.command);
      if (parsed === undefined) return { status: "invalid" };
      const verification = await principal.verify(input.jwt);
      if (verification.status !== "verified") return verification;
      const authorization = await workspaceScope.resolve({
        principalId: verification.principalId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        capability: "feedback.write",
      });
      if (authorization.status !== "authorized") return authorization;
      return commit(input, parsed, authorization.actor.principalId, "workspace");
    },
    async executeReporter(input) {
      const parsed = parse(input.command);
      if (parsed === undefined) return { status: "invalid" };
      const authorization = await accountless.authorize({
        reference: input.reference,
        proof: input.proof,
      });
      if (authorization.status !== "ok") {
        return { status: authorization.status === "denied" ? "denied" : "retryable" };
      }
      if (authorization.feedbackId !== input.feedbackId) return { status: "denied" };
      return commit(
        input,
        parsed,
        dependencies.reporterActorId(input.reference),
        "reporter",
      );
    },
  };
}
