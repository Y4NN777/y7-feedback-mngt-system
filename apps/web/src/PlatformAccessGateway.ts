export type PlatformAccessOutcome =
  | {
      readonly status: "ok";
      readonly result: {
        readonly disposition: "applied" | "replayed";
        readonly grantId: string;
        readonly state: string;
        readonly revision: number;
        readonly content?: Readonly<Record<string, unknown>>;
      };
    }
  | { readonly status: "invalid" | "denied" | "conflict" | "retryable" };

export interface PlatformAccessGateway {
  execute(command: Readonly<Record<string, unknown>>): Promise<PlatformAccessOutcome>;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
const errors = {
  "ERR-PLATFORM-ACCESS-INVALID": "invalid",
  "ERR-PLATFORM-ACCESS-DENIED": "denied",
  "ERR-PLATFORM-ACCESS-CONFLICT": "conflict",
  "ERR-PLATFORM-ACCESS-RETRYABLE": "retryable",
} as const;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function content(value: unknown): Readonly<Record<string, unknown>> | undefined | null {
  if (value === undefined) return undefined;
  if (!object(value)) return null;
  if (value.kind === "feedback" && object(value.feedback)) return value;
  if (
    (value.kind === "messages" ||
      value.kind === "internal_notes" ||
      value.kind === "attachments") &&
    typeof value.feedbackId === "string" &&
    Array.isArray(value.items) &&
    value.items.every(object)
  )
    return value;
  return null;
}

export function createHttpPlatformAccessGateway(
  endpoint: string,
  getJwt: () => Promise<string>,
  fetcher: Fetcher = fetch,
): PlatformAccessGateway {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  return {
    async execute(command) {
      let jwt: string;
      try {
        jwt = await getJwt();
      } catch {
        return { status: "denied" };
      }
      try {
        const response = await fetcher(
          `${base}/v1/platform/exceptional-access/commands`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${jwt}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(command),
          },
        );
        const body: unknown = await response.json();
        const protectedContent =
          object(body) && object(body.result) ? content(body.result.content) : null;
        if (
          response.ok &&
          object(body) &&
          body.status === "ok" &&
          object(body.result) &&
          (body.result.disposition === "applied" ||
            body.result.disposition === "replayed") &&
          typeof body.result.grantId === "string" &&
          typeof body.result.state === "string" &&
          Number.isSafeInteger(body.result.revision) &&
          protectedContent !== null
        )
          return {
            status: "ok",
            result: {
              disposition: body.result.disposition,
              grantId: body.result.grantId,
              state: body.result.state,
              revision: Number(body.result.revision),
              ...(protectedContent === undefined ? {} : { content: protectedContent }),
            },
          };
        if (object(body) && typeof body.error === "string" && body.error in errors)
          return { status: errors[body.error as keyof typeof errors] };
      } catch {
        // Transport and malformed responses share a stable retryable outcome.
      }
      return { status: "retryable" };
    },
  };
}
