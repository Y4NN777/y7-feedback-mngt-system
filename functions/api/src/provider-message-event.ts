import type { SourceProvider } from "@y7-feedback/domain";

import type {
  ClaimedProviderEvent,
  ProviderEventHandler,
} from "./provider-event-inbox.js";

export type ProviderMessageMutation = "created" | "revised" | "tombstoned";

export interface ProviderMessageObservation {
  readonly provider: SourceProvider;
  readonly deliveryId: string;
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly issueId: string;
  readonly commentId: string;
  readonly authorId: string;
  readonly authorLogin: string;
  readonly mutation: ProviderMessageMutation;
  readonly content: string | undefined;
  readonly providerUpdatedAt: string;
}

export interface ProviderMessageContext extends ProviderMessageObservation {
  readonly linkId: string;
  readonly feedbackId: string;
  readonly encryptedGrantRef: string;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
}

export interface ProviderMessageContextResolver {
  resolve(
    observation: ProviderMessageObservation,
  ): Promise<
    | { readonly status: "resolved"; readonly context: ProviderMessageContext }
    | { readonly status: "ignored" }
    | { readonly status: "permanent" }
    | { readonly status: "retryable" }
  >;
}

export interface ProviderMessageAuthorVerifier {
  verify(
    context: ProviderMessageContext,
  ): Promise<"authorized" | "denied" | "retryable">;
}

export interface ProviderMessageFactStore {
  apply(context: ProviderMessageContext): Promise<"applied" | "ignored" | "permanent">;
}

type Parsed =
  | { readonly kind: "ignored" }
  | { readonly kind: "self_generated" }
  | { readonly kind: "invalid" }
  | { readonly kind: "message"; readonly observation: ProviderMessageObservation };

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value);
  return normalized.length > 0 && normalized.length <= 128 ? normalized : null;
}

function text(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : null;
}

function instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function marker(value: unknown): boolean {
  return typeof value === "string" && value.includes("<!-- y7-feedback-operation:");
}

function github(
  event: ClaimedProviderEvent,
  payload: Readonly<Record<string, unknown>>,
): Parsed {
  if (event.eventType !== "issue_comment") return { kind: "ignored" };
  if (
    !object(payload.issue) ||
    !object(payload.comment) ||
    !object(payload.comment.user)
  )
    return { kind: "invalid" };
  const action = payload.action;
  const mutation =
    action === "created"
      ? "created"
      : action === "edited"
        ? "revised"
        : action === "deleted"
          ? "tombstoned"
          : null;
  const body = payload.comment.body;
  if (marker(body)) return { kind: "self_generated" };
  const issueId = identifier(payload.issue.number ?? payload.issue.id);
  const commentId = identifier(payload.comment.id);
  const authorId = identifier(payload.comment.user.id);
  const authorLogin = text(payload.comment.user.login, 200);
  const providerUpdatedAt = instant(
    payload.comment.updated_at ?? payload.comment.created_at,
  );
  const content =
    mutation === "tombstoned" ? undefined : (text(body, 10_000) ?? undefined);
  if (
    !mutation ||
    !issueId ||
    !commentId ||
    !authorId ||
    !authorLogin ||
    !providerUpdatedAt ||
    (mutation !== "tombstoned" && !content)
  )
    return { kind: "invalid" };
  return {
    kind: "message",
    observation: {
      provider: "github",
      deliveryId: event.deliveryId,
      connectionId: event.connectionId,
      workspaceId: event.workspaceId,
      projectId: event.projectId,
      repositoryId: event.repositoryId,
      issueId,
      commentId,
      authorId,
      authorLogin,
      mutation,
      content,
      providerUpdatedAt,
    },
  };
}

function gitlab(
  event: ClaimedProviderEvent,
  payload: Readonly<Record<string, unknown>>,
): Parsed {
  if (event.eventType !== "Note Hook") return { kind: "ignored" };
  if (
    payload.object_kind !== "note" ||
    !object(payload.object_attributes) ||
    !object(payload.user)
  )
    return { kind: "invalid" };
  const attributes = payload.object_attributes;
  if (attributes.noteable_type !== "Issue") return { kind: "ignored" };
  const rawAction = attributes.action ?? payload.event_type;
  const mutation =
    rawAction === "delete" || rawAction === "deleted"
      ? "tombstoned"
      : rawAction === "update" || rawAction === "updated"
        ? "revised"
        : rawAction === "create" || rawAction === "created" || rawAction === "note"
          ? "created"
          : null;
  const body = attributes.note;
  if (marker(body)) return { kind: "self_generated" };
  const issue = object(payload.issue) ? payload.issue : undefined;
  const issueId = identifier(issue?.iid ?? issue?.id ?? attributes.noteable_id);
  const commentId = identifier(attributes.id);
  const authorId = identifier(payload.user.id);
  const authorLogin = text(payload.user.username ?? payload.user.name, 200);
  const providerUpdatedAt = instant(attributes.updated_at ?? attributes.created_at);
  const content =
    mutation === "tombstoned" ? undefined : (text(body, 10_000) ?? undefined);
  if (
    !mutation ||
    !issueId ||
    !commentId ||
    !authorId ||
    !authorLogin ||
    !providerUpdatedAt ||
    (mutation !== "tombstoned" && !content)
  )
    return { kind: "invalid" };
  return {
    kind: "message",
    observation: {
      provider: "gitlab",
      deliveryId: event.deliveryId,
      connectionId: event.connectionId,
      workspaceId: event.workspaceId,
      projectId: event.projectId,
      repositoryId: event.repositoryId,
      issueId,
      commentId,
      authorId,
      authorLogin,
      mutation,
      content,
      providerUpdatedAt,
    },
  };
}

export function parseProviderMessageEvent(event: ClaimedProviderEvent): Parsed {
  let payload: unknown;
  try {
    payload = JSON.parse(event.payloadEnvelope) as unknown;
  } catch {
    return { kind: "invalid" };
  }
  if (!object(payload)) return { kind: "invalid" };
  return event.provider === "github" ? github(event, payload) : gitlab(event, payload);
}

export function createProviderMessageEventHandler(dependencies: {
  readonly contexts: ProviderMessageContextResolver;
  readonly authors: ProviderMessageAuthorVerifier;
  readonly facts: ProviderMessageFactStore;
  readonly fallback: ProviderEventHandler;
}): ProviderEventHandler {
  return {
    async handle(event) {
      const parsed = parseProviderMessageEvent(event);
      if (parsed.kind === "ignored") return dependencies.fallback.handle(event);
      if (parsed.kind === "self_generated") return "ignored";
      if (parsed.kind === "invalid") return "permanent";
      let resolved: Awaited<ReturnType<ProviderMessageContextResolver["resolve"]>>;
      try {
        resolved = await dependencies.contexts.resolve(parsed.observation);
      } catch {
        return "retryable";
      }
      if (resolved.status !== "resolved") return resolved.status;
      let authority: Awaited<ReturnType<ProviderMessageAuthorVerifier["verify"]>>;
      try {
        authority = await dependencies.authors.verify(resolved.context);
      } catch {
        return "retryable";
      }
      if (authority === "denied") return "ignored";
      if (authority === "retryable") return "retryable";
      try {
        return await dependencies.facts.apply(resolved.context);
      } catch {
        return "retryable";
      }
    },
  };
}
