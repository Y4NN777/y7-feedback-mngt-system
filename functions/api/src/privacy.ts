import type { WorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope.js";
import type { AppwritePrincipalVerifier } from "./workspace-attachment-download.js";

export type PrivacyAuthority =
  | { readonly kind: "principal"; readonly jwt: string }
  | {
      readonly kind: "access_proof";
      readonly reference: string;
      readonly proof: string;
    };

export type TrustedPrivacyCommand =
  | {
      readonly kind: "request_deletion";
      readonly operationId: string;
      readonly feedbackId: string;
      readonly reasonCode: string;
    }
  | {
      readonly kind: "restore_feedback";
      readonly operationId: string;
      readonly feedbackId: string;
      readonly expectedRevision: number;
    };

export interface PrivacyProofAuthority {
  authorize(input: {
    readonly reference: string;
    readonly proof: string;
  }): Promise<
    | { readonly status: "authorized"; readonly feedbackId: string }
    | { readonly status: "denied" | "retryable" }
  >;
}

export interface PrivacyStore {
  execute(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actorDigest: string;
    readonly requesterKind: "principal" | "access_proof";
    readonly requesterDigest: string;
    readonly command: TrustedPrivacyCommand;
  }): Promise<
    | {
        readonly status: "applied" | "replayed";
        readonly feedbackId: string;
        readonly revision: number;
        readonly purgeEligibleAt: string;
      }
    | {
        readonly status: "denied" | "invalid" | "conflict" | "expired" | "retryable";
      }
  >;
}

export type PrivacyOutcome =
  | {
      readonly status: "ok";
      readonly result: {
        readonly disposition: "applied" | "replayed";
        readonly feedbackId: string;
        readonly revision: number;
        readonly purgeEligibleAt: string;
      };
    }
  | {
      readonly status: "denied" | "invalid" | "conflict" | "expired" | "retryable";
    };

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const reason = /^[a-z][a-z0-9_]{1,63}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function command(value: unknown): TrustedPrivacyCommand | undefined {
  if (
    !object(value) ||
    typeof value.kind !== "string" ||
    typeof value.operationId !== "string" ||
    !id.test(value.operationId) ||
    typeof value.feedbackId !== "string" ||
    !id.test(value.feedbackId)
  )
    return undefined;
  if (value.kind === "request_deletion")
    return typeof value.reasonCode === "string" && reason.test(value.reasonCode)
      ? {
          kind: value.kind,
          operationId: value.operationId,
          feedbackId: value.feedbackId,
          reasonCode: value.reasonCode,
        }
      : undefined;
  if (value.kind === "restore_feedback")
    return Number.isSafeInteger(value.expectedRevision) &&
      Number(value.expectedRevision) >= 1
      ? {
          kind: value.kind,
          operationId: value.operationId,
          feedbackId: value.feedbackId,
          expectedRevision: Number(value.expectedRevision),
        }
      : undefined;
  return undefined;
}

function authorityValid(authority: PrivacyAuthority): boolean {
  return authority.kind === "principal"
    ? authority.jwt.length >= 1 && authority.jwt.length <= 4096
    : authority.reference.length >= 1 &&
        authority.reference.length <= 200 &&
        authority.proof.length >= 1 &&
        authority.proof.length <= 4096;
}

export function createPrivacyCoordinator(
  principal: AppwritePrincipalVerifier,
  scope: WorkspaceCapabilityScopeResolver,
  proof: PrivacyProofAuthority,
  store: PrivacyStore,
  digestAuthority: (value: string) => string,
) {
  return {
    async execute(input: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly authority: PrivacyAuthority;
      readonly command: unknown;
    }): Promise<PrivacyOutcome> {
      const parsed = command(input.command);
      if (
        !parsed ||
        !id.test(input.workspaceId) ||
        !id.test(input.projectId) ||
        !authorityValid(input.authority)
      )
        return { status: "invalid" };
      let actorDigest: string;
      let requesterKind: "principal" | "access_proof";
      let requesterDigest: string;
      try {
        if (input.authority.kind === "principal") {
          const verified = await principal.verify(input.authority.jwt);
          if (verified.status !== "verified") return { status: "denied" };
          const authorized = await scope.resolve({
            principalId: verified.principalId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            capability: "feedback.write",
          });
          if (authorized.status !== "authorized") return { status: "denied" };
          actorDigest = digestAuthority(`principal:${verified.principalId}`);
          requesterKind = "principal";
          requesterDigest = actorDigest;
        } else {
          const authorized = await proof.authorize(input.authority);
          if (authorized.status === "retryable") return { status: "retryable" };
          if (
            authorized.status !== "authorized" ||
            authorized.feedbackId !== parsed.feedbackId
          )
            return { status: "denied" };
          actorDigest = digestAuthority(`proof:${input.authority.reference}`);
          requesterKind = "access_proof";
          requesterDigest = actorDigest;
        }
        if (!/^[A-Za-z0-9_-]{32,128}$/u.test(actorDigest))
          return { status: "retryable" };
        const outcome = await store.execute({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorDigest,
          requesterKind,
          requesterDigest,
          command: parsed,
        });
        if (outcome.status === "applied" || outcome.status === "replayed")
          return {
            status: "ok",
            result: {
              disposition: outcome.status,
              feedbackId: outcome.feedbackId,
              revision: outcome.revision,
              purgeEligibleAt: outcome.purgeEligibleAt,
            },
          };
        return { status: outcome.status };
      } catch {
        return { status: "retryable" };
      }
    },
  };
}
