import type { SourceProvider } from "@y7-feedback/domain";

import type {
  ProviderWebhookIngressResult,
  createProviderWebhookIngress,
} from "./provider-webhook-ingress.js";

export interface ProviderWebhookHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: Uint8Array;
}

export interface ProviderWebhookHttpResponse {
  readonly statusCode: number;
  readonly body: Readonly<Record<string, unknown>>;
}

type ProviderWebhookIngress = ReturnType<typeof createProviderWebhookIngress>;

const route =
  /^\/providers\/(github|gitlab)\/webhooks\/([A-Za-z0-9][A-Za-z0-9._-]{0,35})$/u;

function response(result: ProviderWebhookIngressResult): ProviderWebhookHttpResponse {
  switch (result.status) {
    case "accepted":
    case "duplicate":
      return { statusCode: 202, body: { accepted: true } };
    case "invalid":
      return { statusCode: 400, body: { error: "ERR-SYNC-WEBHOOK-INVALID" } };
    case "denied":
      return { statusCode: 401, body: { error: "ERR-SYNC-WEBHOOK-DENIED" } };
    case "retryable":
      return { statusCode: 503, body: { error: "ERR-SYNC-WEBHOOK-RETRYABLE" } };
  }
}

export function createProviderWebhookHttp(ingress: ProviderWebhookIngress): {
  readonly handle: (
    request: ProviderWebhookHttpRequest,
  ) => Promise<ProviderWebhookHttpResponse | null>;
} {
  return {
    async handle(request) {
      const match = route.exec(request.path);
      if (!match) return null;
      if (request.method.toUpperCase() !== "POST" || !request.body) {
        return { statusCode: 400, body: { error: "ERR-SYNC-WEBHOOK-INVALID" } };
      }
      return response(
        await ingress.accept({
          provider: String(match[1]) as SourceProvider,
          connectionId: String(match[2]),
          headers: request.headers,
          body: request.body,
        }),
      );
    },
  };
}
