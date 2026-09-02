import type {
  Locale,
  ReporterAttribution,
  ValidatedFeedbackDraft,
} from "@y7-feedback/domain";

export interface IntakeGatewayCommand {
  readonly projectSlug: string;
  readonly clientOperationId: string;
  readonly locale: Locale;
  readonly draft: ValidatedFeedbackDraft;
}

export type IntakeGatewayOutcome =
  | {
      readonly status: "accepted";
      readonly reference: string;
      readonly accessProof: string;
      readonly replayed: boolean;
    }
  | { readonly status: "conflict" | "invalid" }
  | { readonly status: "retryable"; readonly retryAfterMs?: number };

export interface IntakeGateway {
  accept(command: IntakeGatewayCommand): Promise<IntakeGatewayOutcome>;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function endpoint(value: string): URL {
  try {
    const parsed = new URL(value.endsWith("/") ? value : `${value}/`);
    const local =
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (parsed.protocol !== "https:" && !local) {
      throw new Error("INTAKE_ENDPOINT_INVALID");
    }
    return parsed;
  } catch {
    throw new Error("INTAKE_ENDPOINT_INVALID");
  }
}

function publicReporter(
  reporter: ReporterAttribution,
): Readonly<Record<string, string>> {
  if (reporter.kind === "unidentified") return { kind: "unidentified" };
  if (reporter.kind === "contact") {
    return { kind: "contact", value: reporter.value };
  }
  if (reporter.kind === "external") {
    return {
      kind: "external",
      value: reporter.value,
      issuer: reporter.issuer,
      applicationId: reporter.applicationId,
    };
  }
  throw new Error("INTAKE_REPORTER_INVALID");
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function accepted(value: unknown): IntakeGatewayOutcome | null {
  if (
    !isObject(value) ||
    value.status !== "accepted" ||
    typeof value.reference !== "string" ||
    !value.reference.trim() ||
    value.reference.length > 100 ||
    typeof value.accessProof !== "string" ||
    !/^[A-Za-z0-9_-]{43,512}$/u.test(value.accessProof) ||
    typeof value.replayed !== "boolean"
  ) {
    return null;
  }
  return {
    status: "accepted",
    reference: value.reference,
    accessProof: value.accessProof,
    replayed: value.replayed,
  };
}

export function createHttpIntakeGateway(
  rawEndpoint: string,
  fetcher: Fetcher = globalThis.fetch,
): IntakeGateway {
  const base = endpoint(rawEndpoint);
  return {
    async accept(command) {
      try {
        const response = await fetcher(
          new URL(
            `v1/projects/${encodeURIComponent(command.projectSlug)}/feedback`,
            base,
          ).toString(),
          {
            method: "POST",
            cache: "no-store",
            credentials: "omit",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              clientOperationId: command.clientOperationId,
              locale: command.locale,
              feedback: {
                type: command.draft.type,
                source: command.draft.originalSource,
                reporter: publicReporter(command.draft.reporter),
                context: command.draft.context.map(({ name, value }) => ({
                  name,
                  value,
                })),
                attachmentNames: [...command.draft.attachmentNames],
              },
            }),
          },
        );
        if (response.status === 409) return { status: "conflict" };
        if (response.status === 400) return { status: "invalid" };
        if (response.status !== 200 && response.status !== 201) {
          const retryAfter = response.headers.get("retry-after");
          const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
          return Number.isFinite(seconds) && seconds > 0
            ? {
                status: "retryable",
                retryAfterMs: Math.min(300_000, Math.ceil(seconds * 1_000)),
              }
            : { status: "retryable" };
        }
        return accepted((await response.json()) as unknown) ?? { status: "retryable" };
      } catch {
        return { status: "retryable" };
      }
    },
  };
}
