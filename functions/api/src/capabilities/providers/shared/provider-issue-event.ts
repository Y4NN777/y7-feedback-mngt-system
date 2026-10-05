import type { SourceProvider } from "@y7-feedback/domain";

import type {
  ClaimedProviderEvent,
  ProviderEventHandler,
} from "./provider-event-inbox.js";

export interface ProviderIssueStateChange {
  readonly provider: SourceProvider;
  readonly deliveryId: string;
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly issueId: string;
  readonly state: "open" | "closed";
  readonly providerUpdatedAt: string;
}

export interface ProviderIssueStateStore {
  apply(change: ProviderIssueStateChange): Promise<"applied" | "ignored" | "permanent">;
}

type Parsed =
  | { readonly kind: "ignored" }
  | { readonly kind: "self_generated" }
  | { readonly kind: "invalid" }
  | {
      readonly kind: "state";
      readonly issueId: string;
      readonly state: "open" | "closed";
      readonly updatedAt: string;
    };

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function id(value: unknown): string | null {
  return (typeof value === "string" || typeof value === "number") &&
    String(value).length > 0 &&
    String(value).length <= 100
    ? String(value)
    : null;
}

function marker(value: unknown): boolean {
  return typeof value === "string" && value.includes("<!-- y7-feedback-operation:");
}

export function parseProviderIssueEvent(event: ClaimedProviderEvent): Parsed {
  if (
    (event.provider === "github" && event.eventType !== "issues") ||
    (event.provider === "gitlab" && event.eventType !== "Issue Hook")
  ) {
    return { kind: "ignored" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(event.payloadEnvelope) as unknown;
  } catch {
    return { kind: "invalid" };
  }
  if (!object(payload)) return { kind: "invalid" };
  if (event.provider === "github") {
    if (!object(payload.issue)) return { kind: "invalid" };
    if (marker(payload.issue.body)) return { kind: "self_generated" };
    const issueId = id(payload.issue.id);
    const updatedAt = instant(payload.issue.updated_at);
    const state = payload.issue.state;
    if (!issueId || !updatedAt || (state !== "open" && state !== "closed"))
      return { kind: "invalid" };
    return { kind: "state", issueId, state, updatedAt };
  }
  if (payload.object_kind !== "issue" || !object(payload.object_attributes))
    return { kind: "invalid" };
  if (marker(payload.object_attributes.description)) return { kind: "self_generated" };
  const issueId = id(payload.object_attributes.id);
  const updatedAt = instant(payload.object_attributes.updated_at);
  const providerState = payload.object_attributes.state;
  const state =
    providerState === "opened" ? "open" : providerState === "closed" ? "closed" : null;
  return issueId && updatedAt && state
    ? { kind: "state", issueId, state, updatedAt }
    : { kind: "invalid" };
}

export function createProviderIssueEventHandler(
  store: ProviderIssueStateStore,
): ProviderEventHandler {
  return {
    async handle(event) {
      const parsed = parseProviderIssueEvent(event);
      if (parsed.kind === "ignored" || parsed.kind === "self_generated")
        return "ignored";
      if (parsed.kind === "invalid") return "permanent";
      try {
        return await store.apply({
          provider: event.provider,
          deliveryId: event.deliveryId,
          connectionId: event.connectionId,
          workspaceId: event.workspaceId,
          projectId: event.projectId,
          repositoryId: event.repositoryId,
          issueId: parsed.issueId,
          state: parsed.state,
          providerUpdatedAt: parsed.updatedAt,
        });
      } catch {
        return "retryable";
      }
    },
  };
}
