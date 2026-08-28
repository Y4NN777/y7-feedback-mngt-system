export type PublicationConsentOutcome =
  | {
      readonly status: "ok";
      readonly consent: {
        readonly version: number;
        readonly state: "active" | "revoked";
        readonly disclosureVersion: string;
        readonly audience: string;
      };
    }
  | { readonly status: "denied" | "conflict" | "retryable" };

export interface PublicationConsentGateway {
  grant(input: {
    readonly operationId: string;
    readonly reference: string;
    readonly proof: string;
    readonly disclosureVersion: string;
    readonly audience: string;
  }): Promise<PublicationConsentOutcome>;
  revoke(input: {
    readonly operationId: string;
    readonly reference: string;
    readonly proof: string;
  }): Promise<PublicationConsentOutcome>;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(code: number): "denied" | "conflict" | "retryable" {
  return code === 404 ? "denied" : code === 409 ? "conflict" : "retryable";
}

function consent(value: unknown): PublicationConsentOutcome {
  if (
    !object(value) ||
    value.status !== "ok" ||
    !object(value.consent) ||
    !Number.isSafeInteger(value.consent.version) ||
    (value.consent.state !== "active" && value.consent.state !== "revoked") ||
    typeof value.consent.disclosureVersion !== "string" ||
    typeof value.consent.audience !== "string"
  ) {
    return { status: "retryable" };
  }
  return {
    status: "ok",
    consent: {
      version: value.consent.version as number,
      state: value.consent.state,
      disclosureVersion: value.consent.disclosureVersion,
      audience: value.consent.audience,
    },
  };
}

export function createHttpPublicationConsentGateway(
  apiOrigin: string,
  fetcher: Fetcher = globalThis.fetch,
): PublicationConsentGateway {
  async function execute(
    action: "grant" | "revoke",
    input: Readonly<Record<string, string>> & { readonly proof: string },
  ): Promise<PublicationConsentOutcome> {
    const { proof, ...body } = input;
    try {
      const response = await fetcher(
        new URL(`/v1/feedback/publication-consent/${action}`, apiOrigin).toString(),
        {
          method: "POST",
          cache: "no-store",
          credentials: "omit",
          headers: {
            authorization: `FeedbackProof ${proof}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (response.status !== 200 && response.status !== 201) {
        return { status: failure(response.status) };
      }
      return consent((await response.json()) as unknown);
    } catch {
      return { status: "retryable" };
    }
  }
  return {
    grant: (input) => execute("grant", input),
    revoke: (input) => execute("revoke", input),
  };
}
