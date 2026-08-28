import type { FeedbackLifecycleState } from "./access.js";
import type { ActorAccess } from "./authorization.js";
import type { FeedbackType } from "./feedback.js";

export interface WorkbenchInboxItem {
  readonly feedbackId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly type: FeedbackType;
  readonly state: FeedbackLifecycleState;
  readonly acceptedAt: string;
  readonly assignedPrincipalIds: readonly string[];
  readonly deleted: boolean;
}

export interface WorkbenchFilter {
  readonly types: readonly FeedbackType[];
  readonly states: readonly FeedbackLifecycleState[];
  readonly assignment: "all" | "assigned_to_me" | "unassigned";
  readonly acceptedFrom?: string;
  readonly acceptedTo?: string;
}

export class WorkbenchPolicyError extends Error {
  readonly code: "ERR-WORK-FILTER-INVALID" | "ERR-WORK-CLASSIFICATION-INVALID";

  constructor(code: WorkbenchPolicyError["code"]) {
    super(code);
    this.name = "WorkbenchPolicyError";
    this.code = code;
  }
}

const types = new Set<unknown>(["bug", "suggestion", "review"]);
const states = new Set<unknown>([
  "received",
  "under_review",
  "awaiting_reporter",
  "resolved",
  "closed",
]);
const assignments = new Set<unknown>(["all", "assigned_to_me", "unassigned"]);
const executableText = /<\s*script|javascript\s*:|\b(?:function|eval)\s*\(/iu;

function timestamp(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    throw new WorkbenchPolicyError("ERR-WORK-FILTER-INVALID");
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new WorkbenchPolicyError("ERR-WORK-FILTER-INVALID");
  }
  return value;
}

export function validateWorkbenchFilter(value: unknown): WorkbenchFilter {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkbenchPolicyError("ERR-WORK-FILTER-INVALID");
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (
    !Array.isArray(candidate.types) ||
    candidate.types.length > 3 ||
    new Set(candidate.types).size !== candidate.types.length ||
    candidate.types.some((item) => !types.has(item)) ||
    !Array.isArray(candidate.states) ||
    candidate.states.length > 5 ||
    new Set(candidate.states).size !== candidate.states.length ||
    candidate.states.some((item) => !states.has(item)) ||
    !assignments.has(candidate.assignment)
  ) {
    throw new WorkbenchPolicyError("ERR-WORK-FILTER-INVALID");
  }
  const acceptedFrom = timestamp(candidate.acceptedFrom);
  const acceptedTo = timestamp(candidate.acceptedTo);
  if (
    acceptedFrom !== undefined &&
    acceptedTo !== undefined &&
    acceptedFrom > acceptedTo
  ) {
    throw new WorkbenchPolicyError("ERR-WORK-FILTER-INVALID");
  }
  return {
    types: candidate.types as readonly FeedbackType[],
    states: candidate.states as readonly FeedbackLifecycleState[],
    assignment: candidate.assignment as WorkbenchFilter["assignment"],
    ...(acceptedFrom === undefined ? {} : { acceptedFrom }),
    ...(acceptedTo === undefined ? {} : { acceptedTo }),
  };
}

export function filterWorkbenchInbox(
  items: readonly WorkbenchInboxItem[],
  actor: ActorAccess,
  workspaceId: string,
  projectId: string,
  rawFilter: unknown,
): readonly WorkbenchInboxItem[] {
  const filter = validateWorkbenchFilter(rawFilter);
  const workspaceAuthorized = actor.workspaceIds.includes(workspaceId);
  const projectAuthorized =
    actor.responsibility === "workspace_owner" ||
    (actor.responsibility === "project_maintainer" &&
      actor.projectIds.includes(projectId));
  if (!workspaceAuthorized || !projectAuthorized) return [];

  return items
    .filter((item) => {
      const assignedToActor = item.assignedPrincipalIds.includes(actor.principalId);
      return (
        !item.deleted &&
        item.workspaceId === workspaceId &&
        item.projectId === projectId &&
        (actor.responsibility !== "project_maintainer" || assignedToActor) &&
        (filter.types.length === 0 || filter.types.includes(item.type)) &&
        (filter.states.length === 0 || filter.states.includes(item.state)) &&
        (filter.assignment === "all" ||
          (filter.assignment === "assigned_to_me" && assignedToActor) ||
          (filter.assignment === "unassigned" &&
            item.assignedPrincipalIds.length === 0)) &&
        (filter.acceptedFrom === undefined || item.acceptedAt >= filter.acceptedFrom) &&
        (filter.acceptedTo === undefined || item.acceptedAt <= filter.acceptedTo)
      );
    })
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt));
}

export function validateWorkspaceClassification(value: unknown): string {
  if (typeof value !== "string") {
    throw new WorkbenchPolicyError("ERR-WORK-CLASSIFICATION-INVALID");
  }
  const normalized = value.trim();
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    !normalized ||
    normalized.length > 120 ||
    executableText.test(normalized) ||
    hasControlCharacter
  ) {
    throw new WorkbenchPolicyError("ERR-WORK-CLASSIFICATION-INVALID");
  }
  return normalized;
}
