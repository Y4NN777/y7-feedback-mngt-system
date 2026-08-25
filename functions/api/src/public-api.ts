import {
  FeedbackPolicyError,
  validateFeedbackDraft,
  validateProjectFeedbackConfig,
  type ContextInput,
  type FeedbackDraft,
  type FeedbackSource,
  type FeedbackType,
  type ProjectFeedbackConfig,
  type ReporterAttribution,
} from "@y7-feedback/domain";

import type { AccountlessAccessCoordinator } from "./accountless-access.js";
import type { IntakeCoordinator, IntakeOutcome } from "./intake.js";
import type { ReporterAttachmentDownload } from "./reporter-attachment-download.js";
import type { WorkspaceAttachmentDownload } from "./workspace-attachment-download.js";
import type {
  WorkspaceOperationOutcome,
  WorkspaceProjectOperations,
} from "./workspace-project-operations.js";

export interface PublicProject {
  readonly slug: string;
  readonly feedbackConfig: ProjectFeedbackConfig;
  readonly reporterPurpose: {
    readonly fr: string;
    readonly en: string;
  };
}

export interface PublicProjectReader {
  findBySlug(slug: string): Promise<PublicProject | null>;
  resolve(
    slug: string,
  ): Promise<
    | { readonly kind: "current"; readonly project: PublicProject }
    | { readonly kind: "redirect"; readonly canonicalSlug: string }
    | { readonly kind: "unavailable" }
  >;
}

export interface PublicApiRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: unknown;
}

export type PublicApiResponse =
  | {
      readonly statusCode: number;
      readonly body: unknown;
      readonly binary?: never;
    }
  | {
      readonly statusCode: 200;
      readonly body?: never;
      readonly binary: {
        readonly bytes: Uint8Array;
        readonly displayName: string;
        readonly mediaType: string;
      };
    };

export interface PublicApi {
  handle(request: PublicApiRequest): Promise<PublicApiResponse | null>;
}

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const intakePath =
  /^\/v1\/projects\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\/feedback$/u;
const projectPath = /^\/v1\/projects\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/u;
const workspaceAttachmentPath =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/attachments\/download$/u;
const workspaceOperationPath =
  /^\/v1\/workspaces\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})\/operations\/(feedback\/(?:read|search|aggregate)|notifications\/list|realtime\/authorize)$/u;
type WorkspaceOperationAction =
  | "feedback/read"
  | "feedback/search"
  | "feedback/aggregate"
  | "notifications/list"
  | "realtime/authorize";
const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  maximum: number,
  error = "PUBLIC_INPUT_INVALID",
): string {
  if (typeof value !== "string") throw new Error(error);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(error);
  return normalized;
}

function optionalString(value: unknown, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, maximum);
}

function feedbackType(value: unknown): FeedbackType {
  if (value !== "bug" && value !== "suggestion" && value !== "review") {
    throw new Error("PUBLIC_INPUT_INVALID");
  }
  return value;
}

function sourceFrom(value: unknown, type: FeedbackType): FeedbackSource {
  if (!isObject(value) || value.type !== type) {
    throw new Error("PUBLIC_INPUT_INVALID");
  }
  if (type === "bug") {
    const expectedBehavior = optionalString(value.expectedBehavior, 5_000);
    const observedBehavior = optionalString(value.observedBehavior, 5_000);
    const reproductionSteps = optionalString(value.reproductionSteps, 5_000);
    return {
      type,
      problem: requiredString(value.problem, 5_000),
      ...(expectedBehavior === undefined ? {} : { expectedBehavior }),
      ...(observedBehavior === undefined ? {} : { observedBehavior }),
      ...(reproductionSteps === undefined ? {} : { reproductionSteps }),
    };
  }
  if (type === "suggestion") {
    const usageContext = optionalString(value.usageContext, 5_000);
    return {
      type,
      proposal: requiredString(value.proposal, 5_000),
      rationale: requiredString(value.rationale, 5_000),
      ...(usageContext === undefined ? {} : { usageContext }),
    };
  }
  return {
    type,
    experience: requiredString(value.experience, 5_000),
    appreciation: requiredString(value.appreciation, 5_000),
  };
}

function reporterFrom(value: unknown, purpose: string): ReporterAttribution {
  if (!isObject(value)) throw new Error("PUBLIC_INPUT_INVALID");
  if (value.kind === "unidentified") return { kind: "unidentified" };
  if (value.kind === "contact") {
    return {
      kind: "contact",
      value: requiredString(value.value, 320),
      purpose,
    };
  }
  if (value.kind === "external") {
    return {
      kind: "external",
      value: requiredString(value.value, 300),
      issuer: requiredString(value.issuer, 200),
      applicationId: requiredString(value.applicationId, 200),
      purpose,
    };
  }
  throw new Error("PUBLIC_INPUT_INVALID");
}

function contextFrom(value: unknown): readonly ContextInput[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("PUBLIC_INPUT_INVALID");
  }
  return value.map((item) => {
    if (!isObject(item)) throw new Error("PUBLIC_INPUT_INVALID");
    const contextValue = item.value;
    if (
      typeof contextValue !== "string" &&
      typeof contextValue !== "number" &&
      typeof contextValue !== "boolean"
    ) {
      throw new Error("PUBLIC_INPUT_INVALID");
    }
    return {
      name: requiredString(item.name, 64),
      value: contextValue,
      source: "public" as const,
    };
  });
}

function intakeDraft(
  body: Readonly<Record<string, unknown>>,
  project: PublicProject,
  locale: "fr" | "en",
): FeedbackDraft {
  if (!isObject(body.feedback)) throw new Error("PUBLIC_INPUT_INVALID");
  const raw = body.feedback;
  const type = feedbackType(raw.type);
  if (!Array.isArray(raw.attachmentNames) || raw.attachmentNames.length !== 0) {
    throw new Error("PUBLIC_INPUT_INVALID");
  }
  return {
    type,
    source: sourceFrom(raw.source, type),
    reporter: reporterFrom(raw.reporter, project.reporterPurpose[locale]),
    context: contextFrom(raw.context),
    attachmentNames: [],
  };
}

function intakeResponse(outcome: IntakeOutcome): PublicApiResponse {
  if (outcome.status === "accepted") {
    return {
      statusCode: outcome.replayed ? 200 : 201,
      body: {
        status: "accepted",
        reference: outcome.reference,
        accessProof: outcome.accessProof,
        replayed: outcome.replayed,
      },
    };
  }
  if (outcome.status === "retryable") {
    return {
      statusCode: 503,
      body: { error: "ERR-INTAKE-UNAVAILABLE" },
    };
  }
  return outcome.code === "OPERATION_CONFLICT"
    ? { statusCode: 409, body: { error: "ERR-OPERATION-CONFLICT" } }
    : { statusCode: 400, body: { error: "ERR-INTAKE-INVALID" } };
}

function header(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const found = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return found?.[1];
}

function accessRequest(request: PublicApiRequest): {
  readonly reference: string;
  readonly proof: string;
} {
  if (!isObject(request.body)) throw new Error("PUBLIC_ACCESS_INVALID");
  const authorization = header(request.headers, "authorization");
  const match = /^FeedbackProof ([^\s]+)$/iu.exec(authorization ?? "");
  if (!match) throw new Error("PUBLIC_ACCESS_INVALID");
  return {
    reference: requiredString(request.body.reference, 100, "PUBLIC_ACCESS_INVALID"),
    proof: requiredString(match[1], 512, "PUBLIC_ACCESS_INVALID"),
  };
}

export function createPublicApi(
  projects: PublicProjectReader,
  intake: IntakeCoordinator,
  access: AccountlessAccessCoordinator,
  reporterAttachmentDownload?: ReporterAttachmentDownload,
  workspaceAttachmentDownload?: WorkspaceAttachmentDownload,
  workspaceOperations?: WorkspaceProjectOperations,
): PublicApi {
  return {
    async handle(request) {
      const operationMatch = workspaceOperationPath.exec(request.path);
      if (request.method === "POST" && operationMatch) {
        const [, workspaceId, projectId, rawAction] = operationMatch;
        const action = rawAction as WorkspaceOperationAction;
        let jwt: string;
        let body: Readonly<Record<string, unknown>>;
        try {
          if (!workspaceId || !projectId || !rawAction || !isObject(request.body)) {
            throw new Error("WORKSPACE_OPERATION_INVALID");
          }
          const bearer = /^Bearer ([^\s]+)$/u.exec(
            header(request.headers, "authorization") ?? "",
          );
          if (!bearer || header(request.headers, "x-appwrite-user-id") !== undefined) {
            throw new Error("WORKSPACE_OPERATION_INVALID");
          }
          jwt = requiredString(bearer[1], 4_096, "WORKSPACE_OPERATION_INVALID");
          body = request.body;
        } catch {
          return { statusCode: 404, body: { error: "ERR-WORKSPACE-DENIED" } };
        }
        if (!workspaceOperations) {
          return {
            statusCode: 503,
            body: { error: "ERR-WORKSPACE-UNAVAILABLE" },
          };
        }
        const scoped = { jwt, workspaceId, projectId };
        let outcome: WorkspaceOperationOutcome;
        try {
          switch (action) {
            case "feedback/read": {
              const feedbackId = requiredString(
                body.feedbackId,
                36,
                "WORKSPACE_OPERATION_INVALID",
              );
              if (!appwriteId.test(feedbackId)) throw new Error("INVALID");
              outcome = await workspaceOperations.readFeedback({
                ...scoped,
                feedbackId,
              });
              break;
            }
            case "feedback/search": {
              outcome = await workspaceOperations.searchFeedback({
                ...scoped,
                query: requiredString(body.query, 100, "WORKSPACE_OPERATION_INVALID"),
              });
              break;
            }
            case "feedback/aggregate": {
              outcome = await workspaceOperations.aggregateFeedback(scoped);
              break;
            }
            case "notifications/list": {
              outcome = await workspaceOperations.listNotifications(scoped);
              break;
            }
            case "realtime/authorize": {
              outcome = await workspaceOperations.authorizeRealtime(scoped);
              break;
            }
          }
        } catch {
          return { statusCode: 404, body: { error: "ERR-WORKSPACE-DENIED" } };
        }
        if (outcome.status === "ok") {
          return {
            statusCode: 200,
            body: {
              status: "ok",
              ...(outcome.data === undefined ? {} : { data: outcome.data }),
            },
          };
        }
        return outcome.status === "denied"
          ? { statusCode: 404, body: { error: "ERR-WORKSPACE-DENIED" } }
          : {
              statusCode: 503,
              body: { error: "ERR-WORKSPACE-UNAVAILABLE" },
            };
      }

      const projectMatch = projectPath.exec(request.path);
      if (request.method === "GET" && projectMatch) {
        try {
          const resolution = await projects.resolve(
            requiredString(projectMatch[1], 63),
          );
          if (resolution.kind === "current") {
            return resolution.project.feedbackConfig.active
              ? {
                  statusCode: 200,
                  body: {
                    status: "current",
                    slug: resolution.project.slug,
                    purpose: resolution.project.reporterPurpose,
                  },
                }
              : { statusCode: 404, body: { error: "ERR-PROJECT-UNAVAILABLE" } };
          }
          if (resolution.kind === "redirect") {
            return {
              statusCode: 200,
              body: {
                status: "redirect",
                canonicalSlug: resolution.canonicalSlug,
              },
            };
          }
          return { statusCode: 404, body: { error: "ERR-PROJECT-UNAVAILABLE" } };
        } catch {
          return { statusCode: 503, body: { error: "ERR-PROJECT-UNAVAILABLE" } };
        }
      }

      const workspaceAttachmentMatch = workspaceAttachmentPath.exec(request.path);
      if (request.method === "POST" && workspaceAttachmentMatch) {
        const [, workspaceId, projectId] = workspaceAttachmentMatch;
        let jwt: string;
        let attachmentId: string;
        let claimedPrincipalId: string | undefined;
        try {
          if (!workspaceId || !projectId || !isObject(request.body)) {
            throw new Error("WORKSPACE_ACCESS_INVALID");
          }
          const match = /^Bearer ([^\s]+)$/u.exec(
            header(request.headers, "authorization") ?? "",
          );
          if (!match) throw new Error("WORKSPACE_ACCESS_INVALID");
          jwt = requiredString(match[1], 4_096, "WORKSPACE_ACCESS_INVALID");
          attachmentId = requiredString(
            request.body.attachmentId,
            200,
            "WORKSPACE_ACCESS_INVALID",
          );
          const claimed = header(request.headers, "x-appwrite-user-id");
          claimedPrincipalId =
            claimed === undefined
              ? undefined
              : requiredString(claimed, 36, "WORKSPACE_ACCESS_INVALID");
          if (
            claimedPrincipalId !== undefined &&
            !appwriteId.test(claimedPrincipalId)
          ) {
            throw new Error("WORKSPACE_ACCESS_INVALID");
          }
        } catch {
          return { statusCode: 404, body: { error: "ERR-ATTACHMENT-DENIED" } };
        }
        if (!workspaceAttachmentDownload) {
          return {
            statusCode: 503,
            body: { error: "ERR-ATTACHMENT-UNAVAILABLE" },
          };
        }
        const outcome = await workspaceAttachmentDownload({
          jwt,
          workspaceId,
          projectId,
          attachmentId,
          ...(claimedPrincipalId === undefined ? {} : { claimedPrincipalId }),
        });
        if (outcome.status === "available") {
          return {
            statusCode: 200,
            binary: {
              bytes: outcome.bytes,
              displayName: outcome.displayName,
              mediaType: outcome.mediaType,
            },
          };
        }
        return outcome.status === "denied"
          ? { statusCode: 404, body: { error: "ERR-ATTACHMENT-DENIED" } }
          : {
              statusCode: 503,
              body: { error: "ERR-ATTACHMENT-UNAVAILABLE" },
            };
      }

      if (
        request.method === "POST" &&
        request.path === "/v1/feedback/attachments/download"
      ) {
        let authorizedRequest: {
          readonly attachmentId: string;
          readonly reference: string;
          readonly proof: string;
        };
        try {
          if (!isObject(request.body)) throw new Error("PUBLIC_ACCESS_INVALID");
          authorizedRequest = {
            ...accessRequest(request),
            attachmentId: requiredString(
              request.body.attachmentId,
              200,
              "PUBLIC_ACCESS_INVALID",
            ),
          };
        } catch {
          return { statusCode: 404, body: { error: "ERR-ATTACHMENT-DENIED" } };
        }
        if (!reporterAttachmentDownload) {
          return {
            statusCode: 503,
            body: { error: "ERR-ATTACHMENT-UNAVAILABLE" },
          };
        }
        const outcome = await reporterAttachmentDownload(authorizedRequest);
        if (outcome.status === "available") {
          return {
            statusCode: 200,
            binary: {
              bytes: outcome.bytes,
              displayName: outcome.displayName,
              mediaType: outcome.mediaType,
            },
          };
        }
        return outcome.status === "denied"
          ? { statusCode: 404, body: { error: "ERR-ATTACHMENT-DENIED" } }
          : {
              statusCode: 503,
              body: { error: "ERR-ATTACHMENT-UNAVAILABLE" },
            };
      }

      if (
        request.method === "POST" &&
        request.path === "/v1/feedback/access-proof/rotate"
      ) {
        let authorizedRequest: { readonly reference: string; readonly proof: string };
        try {
          authorizedRequest = accessRequest(request);
        } catch {
          return { statusCode: 404, body: { error: "ERR-ACCESS-DENIED" } };
        }
        let outcome: Awaited<ReturnType<AccountlessAccessCoordinator["rotate"]>>;
        try {
          outcome = await access.rotate(authorizedRequest);
        } catch {
          return { statusCode: 503, body: { error: "ERR-ACCESS-UNAVAILABLE" } };
        }
        return outcome.status === "ok"
          ? {
              statusCode: 200,
              body: {
                status: "ok",
                reference: outcome.reference,
                accessProof: outcome.accessProof,
              },
            }
          : outcome.status === "denied"
            ? { statusCode: 404, body: { error: "ERR-ACCESS-DENIED" } }
            : { statusCode: 503, body: { error: "ERR-ACCESS-UNAVAILABLE" } };
      }

      if (
        request.method === "POST" &&
        request.path === "/v1/feedback/access-proof/revoke"
      ) {
        let authorizedRequest: { readonly reference: string; readonly proof: string };
        try {
          authorizedRequest = accessRequest(request);
        } catch {
          return { statusCode: 404, body: { error: "ERR-ACCESS-DENIED" } };
        }
        let outcome: Awaited<ReturnType<AccountlessAccessCoordinator["revoke"]>>;
        try {
          outcome = await access.revoke(authorizedRequest);
        } catch {
          return { statusCode: 503, body: { error: "ERR-ACCESS-UNAVAILABLE" } };
        }
        return outcome.status === "ok"
          ? { statusCode: 200, body: { status: "ok" } }
          : outcome.status === "denied"
            ? { statusCode: 404, body: { error: "ERR-ACCESS-DENIED" } }
            : { statusCode: 503, body: { error: "ERR-ACCESS-UNAVAILABLE" } };
      }

      if (request.method === "POST" && request.path === "/v1/feedback/retrieve") {
        let authorizedRequest: { readonly reference: string; readonly proof: string };
        try {
          authorizedRequest = accessRequest(request);
        } catch {
          return { statusCode: 404, body: { error: "ERR-ACCESS-DENIED" } };
        }
        let outcome: Awaited<ReturnType<AccountlessAccessCoordinator["retrieve"]>>;
        try {
          outcome = await access.retrieve(authorizedRequest);
        } catch {
          return { statusCode: 503, body: { error: "ERR-ACCESS-UNAVAILABLE" } };
        }
        if (outcome.status === "ok") {
          return {
            statusCode: 200,
            body: { status: "ok", feedback: outcome.view },
          };
        }
        return outcome.status === "denied"
          ? { statusCode: 404, body: { error: "ERR-ACCESS-DENIED" } }
          : { statusCode: 503, body: { error: "ERR-ACCESS-UNAVAILABLE" } };
      }

      const match = intakePath.exec(request.path);
      if (request.method !== "POST" || !match) return null;
      const slug = requiredString(match[1], 63);
      let project: PublicProject | null;
      try {
        project = await projects.findBySlug(slug);
      } catch {
        return { statusCode: 503, body: { error: "ERR-INTAKE-UNAVAILABLE" } };
      }
      if (!project || !project.feedbackConfig.active) {
        return { statusCode: 404, body: { error: "ERR-PROJECT-UNAVAILABLE" } };
      }

      let reporterPurpose: PublicProject["reporterPurpose"];
      try {
        if (project.slug !== slug) throw new Error("PUBLIC_PROJECT_INVALID");
        validateProjectFeedbackConfig(project.feedbackConfig);
        for (const purpose of [
          project.reporterPurpose.fr,
          project.reporterPurpose.en,
        ]) {
          if (!purpose.trim() || purpose.length > 300) {
            throw new Error("PUBLIC_PROJECT_INVALID");
          }
        }
        reporterPurpose = project.reporterPurpose;
      } catch {
        return { statusCode: 503, body: { error: "ERR-INTAKE-UNAVAILABLE" } };
      }

      try {
        if (!isObject(request.body)) throw new Error("PUBLIC_INPUT_INVALID");
        const operationId = requiredString(request.body.clientOperationId, 36);
        if (!operationIdPattern.test(operationId)) {
          throw new Error("PUBLIC_INPUT_INVALID");
        }
        const rawLocale = request.body.locale ?? "fr";
        if (rawLocale !== "fr" && rawLocale !== "en") {
          throw new Error("PUBLIC_INPUT_INVALID");
        }
        const draft = validateFeedbackDraft(
          project.feedbackConfig,
          intakeDraft(request.body, { ...project, reporterPurpose }, rawLocale),
        );
        return intakeResponse(
          await intake.accept({
            clientOperationId: operationId,
            draft,
            locale: rawLocale,
          }),
        );
      } catch (error: unknown) {
        return error instanceof FeedbackPolicyError ||
          (error instanceof Error && error.message === "PUBLIC_INPUT_INVALID")
          ? { statusCode: 400, body: { error: "ERR-INTAKE-INVALID" } }
          : { statusCode: 503, body: { error: "ERR-INTAKE-UNAVAILABLE" } };
      }
    },
  };
}
