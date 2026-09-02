import type { ActorAccess } from "@y7-feedback/domain";
import type { ProviderConsentCleanup } from "./appwrite-provider-consent-cleanup.js";

export type ExternalIssueOutcome =
  | { readonly status: "denied" | "retryable" | "conflict" }
  | {
      readonly status: "ok";
      readonly result: ExternalIssueLinkPersistenceResult;
    };

export interface ExternalIssueLinkPersistenceResult {
  readonly status: "accepted" | "replayed";
  readonly linkId: string;
  readonly synchronizationState: "pending" | "failed" | "synchronized";
}

export interface ExternalIssuePersistence {
  grantConsent(input: {
    readonly feedbackId: string;
    readonly reporterId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly operationId: string;
    readonly payloadDigest: string;
    readonly disclosureVersion: string;
    readonly audience: string;
    readonly occurredAt: string;
  }): Promise<{ readonly version: number; readonly state: "active" }>;
  revokeConsent(input: {
    readonly feedbackId: string;
    readonly reporterId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly operationId: string;
    readonly payloadDigest: string;
    readonly occurredAt: string;
  }): Promise<{ readonly version: number; readonly state: "revoked" }>;
  requestLink(input: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
    readonly operationId: string;
    readonly connectionId: string;
    readonly repositoryId: string;
    readonly protectedWorkspaceUrl: string;
    readonly consentVersion: number | undefined;
    readonly payloadDigest: string;
    readonly occurredAt: string;
  }): Promise<ExternalIssueLinkPersistenceResult>;
}

export interface ExternalIssuePrincipalVerifier {
  verify(
    jwt: string,
  ): Promise<
    | { readonly status: "verified"; readonly principalId: string }
    | { readonly status: "denied" | "retryable" }
  >;
}

export interface ExternalIssueScopeResolver {
  resolve(input: {
    readonly principalId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly capability: "feedback.write";
  }): Promise<
    | { readonly status: "authorized"; readonly actor: ActorAccess }
    | { readonly status: "denied" | "retryable" }
  >;
}

export interface ReporterConsentProofVerifier {
  verify(input: { readonly reference: string; readonly proof: string }): Promise<
    | {
        readonly status: "verified";
        readonly feedbackId: string;
        readonly reporterId: string;
        readonly workspaceId: string;
        readonly projectId: string;
      }
    | { readonly status: "denied" | "retryable" }
  >;
}

export interface ExternalIssueCoordinatorDependencies {
  readonly principalVerifier: ExternalIssuePrincipalVerifier;
  readonly scopeResolver: ExternalIssueScopeResolver;
  readonly reporterProofVerifier: ReporterConsentProofVerifier;
  readonly persistence: ExternalIssuePersistence;
  readonly digest: (value: unknown) => string;
  readonly feedbackUrl: (input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
  }) => string;
  readonly now: () => string;
  readonly consentCleanup?: ProviderConsentCleanup;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const reference = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/u;
const disclosure = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const audience = /^(?:github|gitlab):[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function stableFailure(error: unknown): "denied" | "conflict" | "retryable" {
  if (error instanceof Error) {
    if (error.message === "ERR-ISSUE-DENIED") return "denied";
    if (error.message === "ERR-ISSUE-CONFLICT") return "conflict";
  }
  return "retryable";
}

export function createExternalIssueCoordinator(
  dependencies: ExternalIssueCoordinatorDependencies,
) {
  async function reporter(input: {
    readonly reference: string;
    readonly proof: string;
  }) {
    if (
      !reference.test(input.reference) ||
      input.proof.length < 1 ||
      input.proof.length > 512
    ) {
      return { status: "denied" as const };
    }
    return dependencies.reporterProofVerifier.verify(input);
  }

  return {
    async requestLink(input: {
      readonly jwt: string;
      readonly workspaceId: string;
      readonly projectId: string;
      readonly feedbackId: string;
      readonly command: {
        readonly operationId: string;
        readonly connectionId: string;
        readonly repositoryId: string;
        readonly consentVersion?: number;
      };
    }): Promise<ExternalIssueOutcome> {
      try {
        if (
          input.jwt.length < 1 ||
          input.jwt.length > 4_096 ||
          !identifier.test(input.workspaceId) ||
          !identifier.test(input.projectId) ||
          !identifier.test(input.feedbackId) ||
          !identifier.test(input.command.operationId) ||
          !identifier.test(input.command.connectionId) ||
          !identifier.test(input.command.repositoryId) ||
          (input.command.consentVersion !== undefined &&
            (!Number.isSafeInteger(input.command.consentVersion) ||
              input.command.consentVersion < 1))
        ) {
          return { status: "denied" };
        }
        const principal = await dependencies.principalVerifier.verify(input.jwt);
        if (principal.status !== "verified") return { status: principal.status };
        const scoped = await dependencies.scopeResolver.resolve({
          principalId: principal.principalId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          capability: "feedback.write",
        });
        if (
          scoped.status !== "authorized" ||
          scoped.actor.principalId !== principal.principalId
        ) {
          return {
            status: scoped.status === "retryable" ? "retryable" : "denied",
          };
        }
        const protectedWorkspaceUrl = dependencies.feedbackUrl({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          feedbackId: input.feedbackId,
        });
        const occurredAt = dependencies.now();
        const payloadDigest = dependencies.digest({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          feedbackId: input.feedbackId,
          ...input.command,
          protectedWorkspaceUrl,
        });
        const result = await dependencies.persistence.requestLink({
          actor: scoped.actor,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          feedbackId: input.feedbackId,
          operationId: input.command.operationId,
          connectionId: input.command.connectionId,
          repositoryId: input.command.repositoryId,
          protectedWorkspaceUrl,
          consentVersion: input.command.consentVersion,
          payloadDigest,
          occurredAt,
        });
        return { status: "ok", result };
      } catch (error) {
        return { status: stableFailure(error) };
      }
    },

    async grantConsent(input: {
      readonly operationId: string;
      readonly reference: string;
      readonly proof: string;
      readonly disclosureVersion: string;
      readonly audience: string;
    }) {
      try {
        if (
          !disclosure.test(input.disclosureVersion) ||
          !audience.test(input.audience) ||
          !identifier.test(input.operationId)
        ) {
          return { status: "denied" as const };
        }
        const verified = await reporter(input);
        if (verified.status !== "verified") return { status: verified.status } as const;
        const consent = await dependencies.persistence.grantConsent({
          feedbackId: verified.feedbackId,
          reporterId: verified.reporterId,
          workspaceId: verified.workspaceId,
          projectId: verified.projectId,
          operationId: input.operationId,
          payloadDigest: dependencies.digest({
            kind: "grant_publication_consent",
            feedbackId: verified.feedbackId,
            disclosureVersion: input.disclosureVersion,
            audience: input.audience,
          }),
          disclosureVersion: input.disclosureVersion,
          audience: input.audience,
          occurredAt: dependencies.now(),
        });
        return { status: "ok" as const, consent };
      } catch (error) {
        return { status: stableFailure(error) } as const;
      }
    },

    async revokeConsent(input: {
      readonly operationId: string;
      readonly reference: string;
      readonly proof: string;
    }) {
      try {
        if (!identifier.test(input.operationId)) {
          return { status: "denied" as const };
        }
        const verified = await reporter(input);
        if (verified.status !== "verified") return { status: verified.status } as const;
        const occurredAt = dependencies.now();
        const consent = await dependencies.persistence.revokeConsent({
          feedbackId: verified.feedbackId,
          reporterId: verified.reporterId,
          workspaceId: verified.workspaceId,
          projectId: verified.projectId,
          operationId: input.operationId,
          payloadDigest: dependencies.digest({
            kind: "revoke_publication_consent",
            feedbackId: verified.feedbackId,
          }),
          occurredAt,
        });
        if (dependencies.consentCleanup) {
          try {
            await dependencies.consentCleanup.request({
              feedbackId: verified.feedbackId,
              workspaceId: verified.workspaceId,
              projectId: verified.projectId,
              consentOperationId: input.operationId,
              occurredAt,
            });
          } catch {
            // Consent revocation is authoritative; cleanup remains explicitly best effort.
          }
        }
        return { status: "ok" as const, consent };
      } catch (error) {
        return { status: stableFailure(error) } as const;
      }
    },
  };
}

export type ExternalIssueCoordinator = ReturnType<
  typeof createExternalIssueCoordinator
>;
