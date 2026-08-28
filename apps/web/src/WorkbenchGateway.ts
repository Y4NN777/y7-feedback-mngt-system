import {
  validateFeedbackSource,
  type FeedbackLifecycleState,
  type FeedbackSource,
  type FeedbackType,
  type ValidatedContext,
  type WorkbenchFilter,
} from "@y7-feedback/domain";

export interface WorkbenchItem {
  readonly feedbackId: string;
  readonly type: FeedbackType;
  readonly state: FeedbackLifecycleState;
  readonly acceptedAt: string;
  readonly assignedPrincipalIds: readonly string[];
}

export interface WorkbenchDetail extends WorkbenchItem {
  readonly source: FeedbackSource;
  readonly context: readonly ValidatedContext[];
  readonly attachmentNames: readonly string[];
  readonly classification: string | null;
  readonly assignedMaintainerId: string | null;
}

export interface WorkbenchConversationEntry {
  readonly id: string;
  readonly actorKind: "workspace" | "reporter";
  readonly audience: "workspace" | "reporter";
  readonly occurredAt: string;
  readonly content: string;
}

export interface WorkbenchLifecycleFact {
  readonly id: string;
  readonly priorState: FeedbackLifecycleState;
  readonly state: FeedbackLifecycleState;
  readonly actorKind: "workspace" | "reporter";
  readonly occurredAt: string;
  readonly reason: string;
  readonly sequence: number;
}

export interface WorkbenchConversation {
  readonly feedbackId: string;
  readonly state: FeedbackLifecycleState;
  readonly messages: readonly WorkbenchConversationEntry[];
  readonly internalNotes: readonly WorkbenchConversationEntry[];
  readonly lifecycle: readonly WorkbenchLifecycleFact[];
}

export type WorkbenchGatewayOutcome<T> =
  | { readonly status: "ok"; readonly result: T }
  | { readonly status: "invalid" | "denied" | "conflict" | "retryable" };

export interface WorkbenchGateway {
  list(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly filter: WorkbenchFilter;
  }): Promise<WorkbenchGatewayOutcome<readonly WorkbenchItem[]>>;
  read(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
  }): Promise<WorkbenchGatewayOutcome<WorkbenchDetail>>;
  execute(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
    readonly command: Readonly<Record<string, unknown>>;
  }): Promise<WorkbenchGatewayOutcome<Readonly<Record<string, unknown>>>>;
  conversation(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
  }): Promise<WorkbenchGatewayOutcome<WorkbenchConversation>>;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function item(value: unknown): WorkbenchItem | undefined {
  if (
    !object(value) ||
    typeof value.feedbackId !== "string" ||
    (value.type !== "bug" && value.type !== "suggestion" && value.type !== "review") ||
    (value.state !== "received" &&
      value.state !== "under_review" &&
      value.state !== "awaiting_reporter" &&
      value.state !== "resolved" &&
      value.state !== "closed") ||
    typeof value.acceptedAt !== "string" ||
    !Number.isFinite(Date.parse(value.acceptedAt)) ||
    new Date(Date.parse(value.acceptedAt)).toISOString() !== value.acceptedAt ||
    !Array.isArray(value.assignedPrincipalIds) ||
    value.assignedPrincipalIds.some((id) => typeof id !== "string")
  ) {
    return undefined;
  }
  return {
    feedbackId: value.feedbackId,
    type: value.type,
    state: value.state,
    acceptedAt: value.acceptedAt,
    assignedPrincipalIds: value.assignedPrincipalIds as readonly string[],
  };
}

function context(value: unknown): readonly ValidatedContext[] | undefined {
  if (!Array.isArray(value) || value.length > 20) return undefined;
  const result: ValidatedContext[] = [];
  for (const candidate of value) {
    if (
      !object(candidate) ||
      typeof candidate.name !== "string" ||
      typeof candidate.purpose !== "string" ||
      (typeof candidate.value !== "string" &&
        typeof candidate.value !== "number" &&
        typeof candidate.value !== "boolean") ||
      (candidate.source !== "public" &&
        candidate.source !== "client_assertion" &&
        candidate.source !== "system_observed") ||
      (candidate.trust !== "unverified" && candidate.trust !== "verified")
    ) {
      return undefined;
    }
    result.push({
      name: candidate.name,
      value: candidate.value,
      purpose: candidate.purpose,
      source: candidate.source,
      trust: candidate.trust,
    });
  }
  return result;
}

function detail(value: unknown): WorkbenchDetail | undefined {
  const base = item(value);
  let source: FeedbackSource;
  try {
    source =
      object(value) && object(value.source)
        ? validateFeedbackSource(value.source as unknown as FeedbackSource)
        : (() => {
            throw new Error("SOURCE_INVALID");
          })();
  } catch {
    return undefined;
  }
  const parsedContext = object(value) ? context(value.context) : undefined;
  if (
    base === undefined ||
    !object(value) ||
    parsedContext === undefined ||
    !Array.isArray(value.attachmentNames) ||
    value.attachmentNames.some((name) => typeof name !== "string") ||
    (value.classification !== null && typeof value.classification !== "string") ||
    (value.assignedMaintainerId !== null &&
      typeof value.assignedMaintainerId !== "string")
  ) {
    return undefined;
  }
  return {
    ...base,
    source,
    context: parsedContext,
    attachmentNames: value.attachmentNames as readonly string[],
    classification: value.classification,
    assignedMaintainerId: value.assignedMaintainerId,
  };
}

function state(value: unknown): FeedbackLifecycleState | undefined {
  return value === "received" ||
    value === "under_review" ||
    value === "awaiting_reporter" ||
    value === "resolved" ||
    value === "closed"
    ? value
    : undefined;
}

function conversationEntry(value: unknown): WorkbenchConversationEntry | undefined {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    (value.actorKind !== "workspace" && value.actorKind !== "reporter") ||
    (value.audience !== "workspace" && value.audience !== "reporter") ||
    typeof value.occurredAt !== "string" ||
    typeof value.content !== "string"
  )
    return undefined;
  return {
    id: value.id,
    actorKind: value.actorKind,
    audience: value.audience,
    occurredAt: value.occurredAt,
    content: value.content,
  };
}

function conversation(value: unknown): WorkbenchConversation | undefined {
  if (
    !object(value) ||
    typeof value.feedbackId !== "string" ||
    !Array.isArray(value.messages) ||
    !Array.isArray(value.internalNotes) ||
    !Array.isArray(value.lifecycle)
  )
    return undefined;
  const currentState = state(value.state);
  const messages = value.messages.map(conversationEntry);
  const internalNotes = value.internalNotes.map(conversationEntry);
  const lifecycle = value.lifecycle.map((fact): WorkbenchLifecycleFact | undefined => {
    if (
      !object(fact) ||
      typeof fact.id !== "string" ||
      (fact.actorKind !== "workspace" && fact.actorKind !== "reporter") ||
      typeof fact.occurredAt !== "string" ||
      typeof fact.reason !== "string" ||
      typeof fact.sequence !== "number" ||
      !Number.isSafeInteger(fact.sequence)
    )
      return undefined;
    const priorState = state(fact.priorState);
    const nextState = state(fact.state);
    return priorState === undefined || nextState === undefined
      ? undefined
      : {
          id: fact.id,
          priorState,
          state: nextState,
          actorKind: fact.actorKind,
          occurredAt: fact.occurredAt,
          reason: fact.reason,
          sequence: fact.sequence,
        };
  });
  if (
    currentState === undefined ||
    messages.some((entry) => entry === undefined) ||
    internalNotes.some((entry) => entry === undefined) ||
    lifecycle.some((entry) => entry === undefined)
  )
    return undefined;
  return {
    feedbackId: value.feedbackId,
    state: currentState,
    messages: messages as readonly WorkbenchConversationEntry[],
    internalNotes: internalNotes as readonly WorkbenchConversationEntry[],
    lifecycle: lifecycle as readonly WorkbenchLifecycleFact[],
  };
}

export function createHttpWorkbenchGateway(
  endpoint: string,
  getJwt: () => Promise<string>,
  fetcher: Fetcher = fetch,
): WorkbenchGateway {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;

  async function request<T>(
    path: string,
    parse: (value: unknown) => T | undefined,
    init: Omit<RequestInit, "headers"> = { method: "GET" },
    select: (body: Readonly<Record<string, unknown>>) => unknown = (body) =>
      body.result,
  ) {
    let jwt: string;
    try {
      jwt = await getJwt();
    } catch {
      return { status: "denied" } as const;
    }
    try {
      const response = await fetcher(`${base}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${jwt}`,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
      });
      const body: unknown = await response.json();
      if (response.status === 404) return { status: "denied" } as const;
      if (response.status === 400) return { status: "invalid" } as const;
      if (response.status === 409) return { status: "conflict" } as const;
      if (response.ok && object(body)) {
        const result = parse(select(body));
        if (result !== undefined) return { status: "ok", result } as const;
      }
    } catch {
      // Stable retryable outcome for network and malformed response failures.
    }
    return { status: "retryable" } as const;
  }

  return {
    list(input) {
      const query = new URLSearchParams();
      if (input.filter.types.length > 0)
        query.set("type", input.filter.types.join(","));
      if (input.filter.states.length > 0)
        query.set("state", input.filter.states.join(","));
      query.set("assignment", input.filter.assignment);
      if (input.filter.acceptedFrom)
        query.set("acceptedFrom", input.filter.acceptedFrom);
      if (input.filter.acceptedTo) query.set("acceptedTo", input.filter.acceptedTo);
      const path = `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/workbench?${query.toString()}`;
      return request(path, (value) => {
        if (!Array.isArray(value)) return undefined;
        const parsed = value.map(item);
        return parsed.some((candidate) => candidate === undefined)
          ? undefined
          : (parsed as readonly WorkbenchItem[]);
      });
    },
    read(input) {
      const path = `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/workbench/${encodeURIComponent(input.feedbackId)}`;
      return request(path, detail);
    },
    execute(input) {
      const path = `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/workbench/${encodeURIComponent(input.feedbackId)}`;
      return request(path, (value) => (object(value) ? value : undefined), {
        method: "POST",
        body: JSON.stringify(input.command),
      });
    },
    conversation(input) {
      const path = `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/feedback/${encodeURIComponent(input.feedbackId)}/conversation`;
      return request(
        path,
        conversation,
        { method: "GET" },
        (body) => body.conversation,
      );
    },
  };
}
