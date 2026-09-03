import type { ExceptionalAccessAction } from "@y7-feedback/domain";

import type { AppwritePrincipalVerifier } from "./workspace-attachment-download.js";

export type PlatformAccessCommand =
  | {
      readonly kind: "request";
      readonly grantId: string;
      readonly workspaceId: string;
      readonly projectId?: string;
      readonly feedbackId?: string;
      readonly actions: readonly ExceptionalAccessAction[];
      readonly reasonCode: string;
      readonly justification: string;
      readonly incidentSeverity: "ordinary" | "critical";
      readonly breakGlass: boolean;
    }
  | {
      readonly kind: "approve";
      readonly grantId: string;
      readonly expectedRevision: number;
      readonly expiresAt: string;
    }
  | {
      readonly kind: "deny" | "revoke" | "review";
      readonly grantId: string;
      readonly expectedRevision: number;
    }
  | {
      readonly kind: "use";
      readonly grantId: string;
      readonly expectedRevision: number;
      readonly workspaceId: string;
      readonly projectId?: string;
      readonly feedbackId?: string;
      readonly action: ExceptionalAccessAction;
    };

export interface PlatformAuthority {
  authorize(input: {
    readonly principalId: string;
    readonly jwt: string;
    readonly role: "platform_operator" | "platform_owner";
  }): Promise<
    | { readonly status: "authorized"; readonly freshMfa: boolean }
    | { readonly status: "denied" | "retryable" }
  >;
}

export interface PlatformAccessStore {
  execute(input: {
    readonly actorId: string;
    readonly freshMfa: boolean;
    readonly command: PlatformAccessCommand;
  }): Promise<
    | {
        readonly status: "applied" | "replayed";
        readonly grantId: string;
        readonly state: string;
        readonly revision: number;
      }
    | { readonly status: "denied" | "invalid" | "conflict" | "retryable" }
  >;
}

export type PlatformAccessOutcome =
  | {
      readonly status: "ok";
      readonly result: {
        readonly disposition: "applied" | "replayed";
        readonly grantId: string;
        readonly state: string;
        readonly revision: number;
      };
    }
  | { readonly status: "denied" | "invalid" | "conflict" | "retryable" };

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const reason = /^[A-Z][A-Z0-9_]{2,63}$/u;
const actionValues = new Set<unknown>([
  "feedback.read",
  "attachment.read",
  "message.read",
  "internal_note.read",
]);

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function revision(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function optionalId(value: unknown): string | undefined | null {
  return value === undefined
    ? undefined
    : typeof value === "string" && identifier.test(value)
      ? value
      : null;
}

function parseCommand(value: unknown): PlatformAccessCommand | undefined {
  if (
    !object(value) ||
    typeof value.kind !== "string" ||
    typeof value.grantId !== "string" ||
    !identifier.test(value.grantId)
  )
    return undefined;
  if (value.kind === "request") {
    const workspaceId =
      typeof value.workspaceId === "string" ? value.workspaceId : undefined;
    const projectId = optionalId(value.projectId);
    const feedbackId = optionalId(value.feedbackId);
    if (workspaceId === undefined) return undefined;
    if (
      !identifier.test(workspaceId) ||
      projectId === null ||
      feedbackId === null ||
      (feedbackId !== undefined && projectId === undefined) ||
      !Array.isArray(value.actions) ||
      value.actions.length === 0 ||
      value.actions.some((action) => !actionValues.has(action)) ||
      new Set(value.actions).size !== value.actions.length ||
      typeof value.reasonCode !== "string" ||
      !reason.test(value.reasonCode) ||
      typeof value.justification !== "string" ||
      (value.incidentSeverity !== "ordinary" &&
        value.incidentSeverity !== "critical") ||
      typeof value.breakGlass !== "boolean"
    )
      return undefined;
    return {
      kind: value.kind,
      grantId: value.grantId,
      workspaceId,
      ...(projectId === undefined ? {} : { projectId }),
      ...(feedbackId === undefined ? {} : { feedbackId }),
      actions: value.actions as ExceptionalAccessAction[],
      reasonCode: value.reasonCode,
      justification: value.justification,
      incidentSeverity: value.incidentSeverity,
      breakGlass: value.breakGlass,
    };
  }
  const expectedRevision = revision(value.expectedRevision);
  if (expectedRevision === undefined) return undefined;
  if (value.kind === "approve")
    return typeof value.expiresAt === "string"
      ? {
          kind: value.kind,
          grantId: value.grantId,
          expectedRevision,
          expiresAt: value.expiresAt,
        }
      : undefined;
  if (value.kind === "deny" || value.kind === "revoke" || value.kind === "review")
    return { kind: value.kind, grantId: value.grantId, expectedRevision };
  if (value.kind === "use") {
    const projectId = optionalId(value.projectId);
    const feedbackId = optionalId(value.feedbackId);
    return typeof value.workspaceId === "string" &&
      identifier.test(value.workspaceId) &&
      projectId !== null &&
      feedbackId !== null &&
      (feedbackId === undefined || projectId !== undefined) &&
      actionValues.has(value.action)
      ? {
          kind: value.kind,
          grantId: value.grantId,
          expectedRevision,
          workspaceId: value.workspaceId,
          ...(projectId === undefined ? {} : { projectId }),
          ...(feedbackId === undefined ? {} : { feedbackId }),
          action: value.action as ExceptionalAccessAction,
        }
      : undefined;
  }
  return undefined;
}

function requiredRole(
  command: PlatformAccessCommand,
): "platform_operator" | "platform_owner" {
  return command.kind === "approve" ||
    command.kind === "deny" ||
    command.kind === "review"
    ? "platform_owner"
    : "platform_operator";
}

export function createPlatformAccessCoordinator(
  principal: AppwritePrincipalVerifier,
  authority: PlatformAuthority,
  store: PlatformAccessStore,
) {
  return {
    async execute(input: {
      readonly jwt: string;
      readonly command: unknown;
    }): Promise<PlatformAccessOutcome> {
      const parsed = parseCommand(input.command);
      if (!parsed || input.jwt.length < 1 || input.jwt.length > 4096)
        return { status: "invalid" };
      try {
        const verified = await principal.verify(input.jwt);
        if (verified.status !== "verified") return { status: "denied" };
        const authorized = await authority.authorize({
          principalId: verified.principalId,
          jwt: input.jwt,
          role: requiredRole(parsed),
        });
        if (authorized.status !== "authorized") return { status: authorized.status };
        const outcome = await store.execute({
          actorId: verified.principalId,
          freshMfa: authorized.freshMfa,
          command: parsed,
        });
        return outcome.status === "applied" || outcome.status === "replayed"
          ? {
              status: "ok",
              result: {
                disposition: outcome.status,
                grantId: outcome.grantId,
                state: outcome.state,
                revision: outcome.revision,
              },
            }
          : { status: outcome.status };
      } catch {
        return { status: "retryable" };
      }
    },
  };
}
