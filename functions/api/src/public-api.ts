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

import type { AccountlessAccessCoordinator } from "./accountless-access";
import type { IntakeCoordinator, IntakeOutcome } from "./intake";

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
}

export interface PublicApiRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: unknown;
}

export interface PublicApiResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface PublicApi {
  handle(request: PublicApiRequest): Promise<PublicApiResponse | null>;
}

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const intakePath =
  /^\/v1\/projects\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\/feedback$/u;

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
): PublicApi {
  return {
    async handle(request) {
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
