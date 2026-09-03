export type PrivacyRequestOutcome =
  | {
      readonly status: "ok";
      readonly disposition: "applied" | "replayed";
      readonly revision: number;
      readonly purgeEligibleAt: string;
    }
  | { readonly status: "denied" | "conflict" | "retryable" };

export interface PrivacyGateway {
  requestDeletion(input: {
    readonly operationId: string;
    readonly feedbackId: string;
    readonly reference: string;
    readonly proof: string;
    readonly reasonCode: "reporter_request";
  }): Promise<PrivacyRequestOutcome>;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(value: unknown): PrivacyRequestOutcome {
  if (
    !object(value) ||
    value.status !== "ok" ||
    !object(value.result) ||
    (value.result.disposition !== "applied" &&
      value.result.disposition !== "replayed") ||
    !Number.isSafeInteger(value.result.revision) ||
    Number(value.result.revision) < 1 ||
    typeof value.result.purgeEligibleAt !== "string" ||
    !Number.isFinite(Date.parse(value.result.purgeEligibleAt))
  )
    return { status: "retryable" };
  return {
    status: "ok",
    disposition: value.result.disposition,
    revision: Number(value.result.revision),
    purgeEligibleAt: new Date(value.result.purgeEligibleAt).toISOString(),
  };
}

export function createHttpPrivacyGateway(
  apiOrigin: string,
  fetcher: Fetcher = globalThis.fetch,
): PrivacyGateway {
  return {
    async requestDeletion(input) {
      try {
        const response = await fetcher(
          new URL("/v1/feedback/privacy", apiOrigin).toString(),
          {
            method: "POST",
            cache: "no-store",
            credentials: "omit",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              reference: input.reference,
              proof: input.proof,
              command: {
                kind: "request_deletion",
                operationId: input.operationId,
                feedbackId: input.feedbackId,
                reasonCode: input.reasonCode,
              },
            }),
          },
        );
        if (response.status === 404) return { status: "denied" };
        if (response.status === 409) return { status: "conflict" };
        if (response.status !== 200) return { status: "retryable" };
        return parse((await response.json()) as unknown);
      } catch {
        return { status: "retryable" };
      }
    },
  };
}
