import { timingSafeEqual } from "node:crypto";

export interface ProviderIssueOutboxRunner {
  runOnce(): Promise<Readonly<Record<string, unknown>>>;
}

export interface ProviderIssueOutboxHttp {
  handle(input: {
    readonly method: string;
    readonly path: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly body: unknown;
  }): Promise<
    | { readonly statusCode: number; readonly body: Readonly<Record<string, unknown>> }
    | undefined
  >;
}

function authorized(header: string | undefined, secret: string): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createProviderIssueOutboxHttp(
  runner: ProviderIssueOutboxRunner,
  triggerSecret: string,
): ProviderIssueOutboxHttp {
  if (triggerSecret.length < 32 || triggerSecret.length > 500) {
    throw new Error("PROVIDER_OUTBOX_HTTP_CONFIG_INVALID");
  }
  return {
    async handle(input) {
      if (input.path !== "/operational/provider-issue-outbox") return undefined;
      if (
        input.method !== "POST" ||
        !authorized(input.headers.authorization, triggerSecret) ||
        input.headers["x-appwrite-user-id"] !== undefined ||
        typeof input.body !== "object" ||
        input.body === null ||
        Array.isArray(input.body) ||
        Object.keys(input.body).length !== 0
      ) {
        return { statusCode: 404, body: { error: "ERR-PROVIDER-OUTBOX-DENIED" } };
      }
      try {
        return { statusCode: 200, body: await runner.runOnce() };
      } catch {
        return {
          statusCode: 503,
          body: { error: "ERR-PROVIDER-OUTBOX-RETRYABLE" },
        };
      }
    },
  };
}
