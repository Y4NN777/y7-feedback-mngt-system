export type ExceptionalAccessAction =
  "feedback.read" | "attachment.read" | "message.read" | "internal_note.read";

export interface ExceptionalAccessScope {
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly feedbackId?: string;
  readonly actions: readonly ExceptionalAccessAction[];
}

export type ExceptionalAccessState =
  | "requested"
  | "denied"
  | "active"
  | "revoked"
  | "expired"
  | "review_required"
  | "reviewed";

export interface ExceptionalAccessGrant {
  readonly id: string;
  readonly revision: number;
  readonly requesterId: string;
  readonly approverId?: string;
  readonly scope: ExceptionalAccessScope;
  readonly reasonCode: string;
  readonly justification: string;
  readonly incidentSeverity: "ordinary" | "critical";
  readonly breakGlass: boolean;
  readonly state: ExceptionalAccessState;
  readonly useCount: number;
  readonly requestedAt: string;
  readonly approvedAt?: string;
  readonly expiresAt?: string;
  readonly expiredAt?: string;
  readonly revokedAt?: string;
  readonly reviewedAt?: string;
}

export type ExceptionalAccessAuditType =
  | "requested"
  | "approved"
  | "denied"
  | "used"
  | "use_denied"
  | "revoked"
  | "expired"
  | "reviewed";

export interface ExceptionalAccessAuditEvent {
  readonly grantId: string;
  readonly sequence: number;
  readonly type: ExceptionalAccessAuditType;
  readonly actorId: string;
  readonly reasonCode: string;
  readonly occurredAt: string;
  readonly scope: ExceptionalAccessScope;
}

export type ExceptionalAccessDecision<T = ExceptionalAccessGrant> =
  | {
      readonly status: "ok";
      readonly grant: T;
      readonly audit: ExceptionalAccessAuditEvent;
    }
  | {
      readonly status: "denied" | "invalid" | "conflict";
      readonly code: string;
      readonly audit?: ExceptionalAccessAuditEvent;
    };

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const reason = /^[A-Z][A-Z0-9_]{2,63}$/u;
const actions = new Set<ExceptionalAccessAction>([
  "feedback.read",
  "attachment.read",
  "message.read",
  "internal_note.read",
]);
const oneHour = 3_600_000;

function time(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validScope(scope: ExceptionalAccessScope): boolean {
  return (
    identifier.test(scope.workspaceId) &&
    (scope.projectId === undefined || identifier.test(scope.projectId)) &&
    (scope.feedbackId === undefined || identifier.test(scope.feedbackId)) &&
    (scope.feedbackId === undefined || scope.projectId !== undefined) &&
    scope.actions.length > 0 &&
    scope.actions.length === new Set(scope.actions).size &&
    scope.actions.every((action) => actions.has(action))
  );
}

function audit(
  grant: ExceptionalAccessGrant,
  type: ExceptionalAccessAuditType,
  actorId: string,
  occurredAt: string,
  reasonCode = grant.reasonCode,
): ExceptionalAccessAuditEvent {
  return {
    grantId: grant.id,
    sequence: grant.revision + 1,
    type,
    actorId,
    reasonCode,
    occurredAt,
    scope: grant.scope,
  };
}

function auditedDenial(
  grant: ExceptionalAccessGrant,
  code: string,
  actorId: string,
  occurredAt: string,
  status: "denied" | "invalid" | "conflict" = "denied",
): ExceptionalAccessDecision {
  return {
    status,
    code,
    ...(identifier.test(actorId) && time(occurredAt) !== undefined
      ? { audit: audit(grant, "denied", actorId, occurredAt, code) }
      : {}),
  };
}

export function requestExceptionalAccess(input: {
  readonly id: string;
  readonly requesterId: string;
  readonly scope: ExceptionalAccessScope;
  readonly reasonCode: string;
  readonly justification: string;
  readonly incidentSeverity: "ordinary" | "critical";
  readonly breakGlass: boolean;
  readonly now: string;
}): ExceptionalAccessDecision {
  if (
    !identifier.test(input.id) ||
    !identifier.test(input.requesterId) ||
    !validScope(input.scope) ||
    !reason.test(input.reasonCode) ||
    input.justification.trim().length < 10 ||
    input.justification.length > 1_000 ||
    time(input.now) === undefined ||
    (input.breakGlass && input.incidentSeverity !== "critical")
  )
    return { status: "invalid", code: "EXCEPTIONAL_ACCESS_REQUEST_INVALID" };
  const grant: ExceptionalAccessGrant = {
    id: input.id,
    revision: 0,
    requesterId: input.requesterId,
    scope: input.scope,
    reasonCode: input.reasonCode,
    justification: input.justification.trim(),
    incidentSeverity: input.incidentSeverity,
    breakGlass: input.breakGlass,
    state: "requested",
    useCount: 0,
    requestedAt: input.now,
  };
  return {
    status: "ok",
    grant,
    audit: audit(grant, "requested", input.requesterId, input.now),
  };
}

export function approveExceptionalAccess(
  grant: ExceptionalAccessGrant,
  input: {
    readonly approverId: string;
    readonly freshMfa: boolean;
    readonly expectedRevision: number;
    readonly now: string;
    readonly expiresAt: string;
  },
): ExceptionalAccessDecision {
  const now = time(input.now);
  const expiry = time(input.expiresAt);
  if (
    !identifier.test(input.approverId) ||
    now === undefined ||
    expiry === undefined ||
    expiry <= now ||
    expiry - now > oneHour
  )
    return auditedDenial(
      grant,
      "EXCEPTIONAL_ACCESS_APPROVAL_INVALID",
      input.approverId,
      input.now,
      "invalid",
    );
  if (!input.freshMfa)
    return auditedDenial(
      grant,
      "EXCEPTIONAL_ACCESS_MFA_REQUIRED",
      input.approverId,
      input.now,
    );
  if (input.approverId === grant.requesterId)
    return auditedDenial(
      grant,
      "EXCEPTIONAL_ACCESS_SELF_APPROVAL",
      input.approverId,
      input.now,
    );
  if (grant.state !== "requested" || input.expectedRevision !== grant.revision)
    return auditedDenial(
      grant,
      "EXCEPTIONAL_ACCESS_STATE_CONFLICT",
      input.approverId,
      input.now,
      "conflict",
    );
  const active: ExceptionalAccessGrant = {
    ...grant,
    revision: grant.revision + 1,
    approverId: input.approverId,
    state: "active",
    approvedAt: input.now,
    expiresAt: input.expiresAt,
  };
  return {
    status: "ok",
    grant: active,
    audit: audit(grant, "approved", input.approverId, input.now),
  };
}

export function denyExceptionalAccess(
  grant: ExceptionalAccessGrant,
  input: {
    readonly approverId: string;
    readonly expectedRevision: number;
    readonly now: string;
  },
): ExceptionalAccessDecision {
  if (
    grant.state !== "requested" ||
    input.expectedRevision !== grant.revision ||
    input.approverId === grant.requesterId ||
    !identifier.test(input.approverId) ||
    time(input.now) === undefined
  )
    return auditedDenial(
      grant,
      "EXCEPTIONAL_ACCESS_DENIAL_INVALID",
      input.approverId,
      input.now,
    );
  const denied = { ...grant, revision: grant.revision + 1, state: "denied" as const };
  return {
    status: "ok",
    grant: denied,
    audit: audit(grant, "denied", input.approverId, input.now),
  };
}

function containsScope(
  approved: ExceptionalAccessScope,
  requested: Omit<ExceptionalAccessScope, "actions"> & {
    readonly action: ExceptionalAccessAction;
  },
): boolean {
  return (
    approved.workspaceId === requested.workspaceId &&
    (approved.projectId === undefined || approved.projectId === requested.projectId) &&
    (approved.feedbackId === undefined ||
      approved.feedbackId === requested.feedbackId) &&
    approved.actions.includes(requested.action)
  );
}

export function useExceptionalAccess(
  grant: ExceptionalAccessGrant,
  input: {
    readonly operatorId: string;
    readonly expectedRevision: number;
    readonly workspaceId: string;
    readonly projectId?: string;
    readonly feedbackId?: string;
    readonly action: ExceptionalAccessAction;
    readonly now: string;
  },
): ExceptionalAccessDecision {
  const occurredAt = time(input.now);
  const denial = (code: string): ExceptionalAccessDecision => ({
    status: "denied",
    code,
    ...(occurredAt === undefined || !identifier.test(input.operatorId)
      ? {}
      : { audit: audit(grant, "use_denied", input.operatorId, input.now, code) }),
  });
  if (occurredAt === undefined || !identifier.test(input.operatorId))
    return denial("EXCEPTIONAL_ACCESS_USE_INVALID");
  if (input.expectedRevision !== grant.revision)
    return auditedDenial(
      grant,
      "EXCEPTIONAL_ACCESS_STATE_CONFLICT",
      input.operatorId,
      input.now,
      "conflict",
    );
  if (grant.state !== "active") return denial("EXCEPTIONAL_ACCESS_NOT_ACTIVE");
  if (input.operatorId !== grant.requesterId)
    return denial("EXCEPTIONAL_ACCESS_WRONG_OPERATOR");
  const expiry = grant.expiresAt === undefined ? undefined : time(grant.expiresAt);
  if (expiry === undefined || occurredAt >= expiry)
    return denial("EXCEPTIONAL_ACCESS_EXPIRED");
  if (!containsScope(grant.scope, input))
    return denial("EXCEPTIONAL_ACCESS_SCOPE_DENIED");
  const used = { ...grant, revision: grant.revision + 1, useCount: grant.useCount + 1 };
  return {
    status: "ok",
    grant: used,
    audit: audit(grant, "used", input.operatorId, input.now),
  };
}

export function revokeExceptionalAccess(
  grant: ExceptionalAccessGrant,
  input: {
    readonly actorId: string;
    readonly expectedRevision: number;
    readonly now: string;
  },
): ExceptionalAccessDecision {
  if (input.expectedRevision !== grant.revision)
    return { status: "conflict", code: "EXCEPTIONAL_ACCESS_STATE_CONFLICT" };
  if (
    grant.state !== "active" ||
    !identifier.test(input.actorId) ||
    time(input.now) === undefined
  )
    return auditedDenial(
      grant,
      "EXCEPTIONAL_ACCESS_REVOKE_DENIED",
      input.actorId,
      input.now,
    );
  const state: ExceptionalAccessState =
    grant.breakGlass && grant.useCount > 0 ? "review_required" : "revoked";
  const revoked = {
    ...grant,
    revision: grant.revision + 1,
    state,
    revokedAt: input.now,
  };
  return {
    status: "ok",
    grant: revoked,
    audit: audit(grant, "revoked", input.actorId, input.now),
  };
}

export function expireExceptionalAccess(
  grant: ExceptionalAccessGrant,
  input: {
    readonly actorId: string;
    readonly expectedRevision: number;
    readonly now: string;
  },
): ExceptionalAccessDecision {
  if (input.expectedRevision !== grant.revision)
    return { status: "conflict", code: "EXCEPTIONAL_ACCESS_STATE_CONFLICT" };
  const occurredAt = time(input.now);
  const expiresAt = grant.expiresAt === undefined ? undefined : time(grant.expiresAt);
  if (
    grant.state !== "active" ||
    !identifier.test(input.actorId) ||
    occurredAt === undefined ||
    expiresAt === undefined
  )
    return { status: "denied", code: "EXCEPTIONAL_ACCESS_EXPIRY_DENIED" };
  if (occurredAt < expiresAt)
    return { status: "denied", code: "EXCEPTIONAL_ACCESS_NOT_EXPIRED" };
  const state: ExceptionalAccessState =
    grant.breakGlass && grant.useCount > 0 ? "review_required" : "expired";
  const expired = {
    ...grant,
    revision: grant.revision + 1,
    state,
    expiredAt: input.now,
  };
  return {
    status: "ok",
    grant: expired,
    audit: audit(grant, "expired", input.actorId, input.now),
  };
}

export function reviewBreakGlass(
  grant: ExceptionalAccessGrant,
  input: {
    readonly reviewerId: string;
    readonly expectedRevision: number;
    readonly now: string;
  },
): ExceptionalAccessDecision {
  if (
    grant.state !== "review_required" ||
    input.expectedRevision !== grant.revision ||
    input.reviewerId === grant.requesterId ||
    !identifier.test(input.reviewerId) ||
    time(input.now) === undefined
  )
    return auditedDenial(
      grant,
      "EXCEPTIONAL_ACCESS_REVIEW_DENIED",
      input.reviewerId,
      input.now,
    );
  const reviewed = {
    ...grant,
    revision: grant.revision + 1,
    state: "reviewed" as const,
    reviewedAt: input.now,
  };
  return {
    status: "ok",
    grant: reviewed,
    audit: audit(grant, "reviewed", input.reviewerId, input.now),
  };
}
