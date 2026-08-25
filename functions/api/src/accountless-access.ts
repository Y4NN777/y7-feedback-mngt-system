import {
  AccessPolicyError,
  applyReporterAction,
  authorizeAccess,
  projectReporterFeedback,
  revokeAccessGrant,
  rotateAccessGrant,
  type AccessGrant,
  type AccessGrantDependencies,
  type AccessRequest,
  type ReporterAction,
  type ReporterFeedbackRecord,
  type ReporterFeedbackView,
} from "@y7-feedback/domain";

export interface AccountlessResource {
  readonly grant: AccessGrant;
  readonly record: ReporterFeedbackRecord;
}

export interface AccountlessAccessRepository {
  loadByReference(reference: string): Promise<AccountlessResource | null>;
  saveGrant(grant: AccessGrant): Promise<void>;
  saveRecord(record: ReporterFeedbackRecord): Promise<void>;
}

export interface AccountlessAccessDependencies {
  readonly matchesProof: (proof: string, verifier: string) => boolean;
  readonly rotation: AccessGrantDependencies;
}

type AccessFailure =
  | { readonly status: "denied"; readonly code: "ACCESS_DENIED" }
  | { readonly status: "retryable"; readonly code: "ACCESS_UNAVAILABLE" };

export type RetrieveOutcome =
  { readonly status: "ok"; readonly view: ReporterFeedbackView } | AccessFailure;

export type RotateOutcome =
  | {
      readonly status: "ok";
      readonly reference: string;
      readonly accessProof: string;
    }
  | AccessFailure;

export type RevokeOutcome = { readonly status: "ok" } | AccessFailure;

export type AuthorizeOutcome =
  { readonly status: "ok"; readonly feedbackId: string } | AccessFailure;

export type ReporterActionOutcome =
  | { readonly status: "ok"; readonly view: ReporterFeedbackView }
  | { readonly status: "rejected"; readonly code: "ACTION_INVALID" }
  | AccessFailure;

export interface AccountlessAccessCoordinator {
  authorize(request: AccessRequest): Promise<AuthorizeOutcome>;
  retrieve(request: AccessRequest): Promise<RetrieveOutcome>;
  rotate(request: AccessRequest): Promise<RotateOutcome>;
  revoke(request: AccessRequest): Promise<RevokeOutcome>;
  act(request: AccessRequest, action: ReporterAction): Promise<ReporterActionOutcome>;
}

function failure(error: unknown): AccessFailure {
  return error instanceof AccessPolicyError && error.code === "ACCESS_DENIED"
    ? { status: "denied", code: "ACCESS_DENIED" }
    : { status: "retryable", code: "ACCESS_UNAVAILABLE" };
}

export function createAccountlessAccessCoordinator(
  repository: AccountlessAccessRepository,
  dependencies: AccountlessAccessDependencies,
): AccountlessAccessCoordinator {
  async function loadAuthorized(request: AccessRequest): Promise<AccountlessResource> {
    const resource = await repository.loadByReference(request.reference);
    const feedbackId = authorizeAccess(
      resource?.grant,
      request,
      dependencies.matchesProof,
    );
    if (!resource || resource.record.feedbackId !== feedbackId) {
      throw new AccessPolicyError("ACCESS_DENIED");
    }
    return resource;
  }

  return {
    async authorize(request) {
      try {
        const resource = await loadAuthorized(request);
        return { status: "ok", feedbackId: resource.grant.feedbackId };
      } catch (error: unknown) {
        return failure(error);
      }
    },
    async retrieve(request) {
      try {
        const resource = await loadAuthorized(request);
        return {
          status: "ok",
          view: projectReporterFeedback(resource.record, resource.grant.feedbackId),
        };
      } catch (error: unknown) {
        return failure(error);
      }
    },
    async rotate(request) {
      try {
        const resource = await loadAuthorized(request);
        const rotated = rotateAccessGrant(resource.grant, dependencies.rotation);
        await repository.saveGrant(rotated.grant);
        return {
          status: "ok",
          reference: rotated.grant.reference,
          accessProof: rotated.proof,
        };
      } catch (error: unknown) {
        return failure(error);
      }
    },
    async revoke(request) {
      try {
        const resource = await loadAuthorized(request);
        await repository.saveGrant(revokeAccessGrant(resource.grant));
        return { status: "ok" };
      } catch (error: unknown) {
        return failure(error);
      }
    },
    async act(request, action) {
      try {
        const resource = await loadAuthorized(request);
        const record = applyReporterAction(
          resource.record,
          resource.grant.feedbackId,
          action,
        );
        await repository.saveRecord(record);
        return {
          status: "ok",
          view: projectReporterFeedback(record, resource.grant.feedbackId),
        };
      } catch (error: unknown) {
        if (
          error instanceof AccessPolicyError &&
          error.code === "REPORTER_ACTION_INVALID"
        ) {
          return { status: "rejected", code: "ACTION_INVALID" };
        }
        return failure(error);
      }
    },
  };
}
