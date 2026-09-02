import type { IntelligenceRelationType } from "@y7-feedback/domain";

import type { WorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope.js";
import type { AppwritePrincipalVerifier } from "./workspace-attachment-download.js";

export type TrustedIntelligenceProvenanceCommand =
  | {
      readonly kind: "record_theme";
      readonly operationId: string;
      readonly feedbackId: string;
      readonly label: string;
    }
  | {
      readonly kind: "record_relationship";
      readonly operationId: string;
      readonly feedbackId: string;
      readonly relatedFeedbackId: string;
      readonly relationType: IntelligenceRelationType;
    }
  | {
      readonly kind: "correct_theme";
      readonly operationId: string;
      readonly associationId: string;
      readonly expectedRevision: number;
      readonly label: string;
    }
  | {
      readonly kind: "correct_relationship";
      readonly operationId: string;
      readonly associationId: string;
      readonly expectedRevision: number;
      readonly relatedFeedbackId: string;
      readonly relationType: IntelligenceRelationType;
    }
  | {
      readonly kind: "remove_association";
      readonly operationId: string;
      readonly associationId: string;
      readonly expectedRevision: number;
    };

export type IntelligenceProvenanceStoreOutcome =
  | {
      readonly status: "applied" | "replayed";
      readonly associationId: string;
      readonly eventId: string;
      readonly revision: number;
    }
  | { readonly status: "denied" | "invalid" | "conflict" | "retryable" };

export interface IntelligenceProvenanceStore {
  execute(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly command: TrustedIntelligenceProvenanceCommand;
  }): Promise<IntelligenceProvenanceStoreOutcome>;
}

export type IntelligenceProvenanceOutcome =
  | {
      readonly status: "ok";
      readonly result: {
        readonly disposition: "applied" | "replayed";
        readonly associationId: string;
        readonly eventId: string;
        readonly revision: number;
      };
    }
  | { readonly status: "denied" | "invalid" | "conflict" | "retryable" };

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const relationTypes = new Set<unknown>(["duplicate", "depends_on", "related"]);

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function common(value: Readonly<Record<string, unknown>>):
  | {
      readonly operationId: string;
    }
  | undefined {
  return typeof value.operationId === "string" && id.test(value.operationId)
    ? { operationId: value.operationId }
    : undefined;
}

function command(value: unknown): TrustedIntelligenceProvenanceCommand | undefined {
  if (!object(value) || typeof value.kind !== "string") return undefined;
  const base = common(value);
  if (!base) return undefined;
  if (value.kind === "record_theme")
    return typeof value.feedbackId === "string" &&
      id.test(value.feedbackId) &&
      typeof value.label === "string"
      ? { kind: value.kind, ...base, feedbackId: value.feedbackId, label: value.label }
      : undefined;
  if (value.kind === "record_relationship")
    return typeof value.feedbackId === "string" &&
      id.test(value.feedbackId) &&
      typeof value.relatedFeedbackId === "string" &&
      id.test(value.relatedFeedbackId) &&
      relationTypes.has(value.relationType)
      ? {
          kind: value.kind,
          ...base,
          feedbackId: value.feedbackId,
          relatedFeedbackId: value.relatedFeedbackId,
          relationType: value.relationType as IntelligenceRelationType,
        }
      : undefined;
  if (
    value.kind === "correct_theme" ||
    value.kind === "correct_relationship" ||
    value.kind === "remove_association"
  ) {
    if (
      typeof value.associationId !== "string" ||
      !id.test(value.associationId) ||
      !Number.isSafeInteger(value.expectedRevision) ||
      Number(value.expectedRevision) < 1
    )
      return undefined;
    const correction = {
      ...base,
      associationId: value.associationId,
      expectedRevision: Number(value.expectedRevision),
    };
    if (value.kind === "remove_association") return { kind: value.kind, ...correction };
    if (value.kind === "correct_theme")
      return typeof value.label === "string"
        ? { kind: value.kind, ...correction, label: value.label }
        : undefined;
    return typeof value.relatedFeedbackId === "string" &&
      id.test(value.relatedFeedbackId) &&
      relationTypes.has(value.relationType)
      ? {
          kind: value.kind,
          ...correction,
          relatedFeedbackId: value.relatedFeedbackId,
          relationType: value.relationType as IntelligenceRelationType,
        }
      : undefined;
  }
  return undefined;
}

export function createIntelligenceProvenanceCoordinator(
  principal: AppwritePrincipalVerifier,
  scope: WorkspaceCapabilityScopeResolver,
  store: IntelligenceProvenanceStore,
) {
  return {
    async execute(input: {
      readonly jwt: string;
      readonly workspaceId: string;
      readonly projectId: string;
      readonly command: unknown;
    }): Promise<IntelligenceProvenanceOutcome> {
      const parsed = command(input.command);
      if (!parsed || !id.test(input.workspaceId) || !id.test(input.projectId))
        return { status: "invalid" };
      const verification = await principal.verify(input.jwt);
      if (verification.status !== "verified") return { status: "denied" };
      const authorization = await scope.resolve({
        principalId: verification.principalId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        capability: "feedback.write",
      });
      if (authorization.status !== "authorized") return { status: "denied" };
      try {
        const outcome = await store.execute({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: verification.principalId,
          command: parsed,
        });
        if (outcome.status === "applied" || outcome.status === "replayed")
          return {
            status: "ok",
            result: {
              disposition: outcome.status,
              associationId: outcome.associationId,
              eventId: outcome.eventId,
              revision: outcome.revision,
            },
          };
        return { status: outcome.status };
      } catch {
        return { status: "retryable" };
      }
    },
  };
}
