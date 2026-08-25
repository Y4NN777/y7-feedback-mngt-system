import { randomUUID } from "node:crypto";

import { serializeOperationalEvent } from "./observability.js";
import type { PublicApi } from "./public-api.js";

export interface FunctionRequest {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly bodyJson?: unknown;
  readonly bodyBinary?: Uint8Array;
}

export interface FunctionResponse {
  binary?(
    bytes: Uint8Array,
    statusCode?: number,
    headers?: Readonly<Record<string, string>>,
  ): unknown;
  json(
    body: unknown,
    statusCode?: number,
    headers?: Readonly<Record<string, string>>,
  ): unknown;
}

export interface FunctionContext {
  readonly req: FunctionRequest;
  readonly res: FunctionResponse;
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

export interface HttpDependencies {
  readonly createCorrelationId: () => string;
  readonly environment: "development" | "preview" | "production";
  readonly now: () => number;
  readonly publicApi?: PublicApi;
  readonly release: string;
  readonly startedAt: () => number;
}

const defaultDependencies: HttpDependencies = {
  createCorrelationId: randomUUID,
  environment: "development",
  now: Date.now,
  release: "local",
  startedAt: Date.now,
};

const TEN_MEBIBYTES = 10 * 1024 * 1024;

function ingressProbe(
  req: FunctionRequest,
):
  | { readonly statusCode: 200; readonly body: unknown }
  | { readonly statusCode: 400; readonly body: unknown } {
  const contentType = req.headers?.["content-type"] ?? "";
  const fileBytes = Number(req.headers?.["x-y7-ingress-file-bytes"]);
  const totalBytes = Number(req.headers?.["x-y7-ingress-total-bytes"]);
  const actualBytes = req.bodyBinary?.byteLength;
  const valid =
    contentType.startsWith("multipart/form-data; boundary=") &&
    fileBytes === TEN_MEBIBYTES &&
    Number.isSafeInteger(totalBytes) &&
    totalBytes > fileBytes &&
    actualBytes === totalBytes;

  return valid
    ? { statusCode: 200, body: { accepted: true, fileBytes, totalBytes } }
    : { statusCode: 400, body: { error: "ERR-INGRESS-PROBE-INVALID" } };
}

export async function routeRequest(
  { req, res, log }: FunctionContext,
  dependencies: HttpDependencies = defaultDependencies,
): Promise<unknown> {
  const method = req.method.toUpperCase();
  const requestHeaders = req.headers ?? {};
  const contentType = requestHeaders["content-type"] ?? "";
  const startedAt = dependencies.startedAt();
  const correlationId = dependencies.createCorrelationId();
  const headers = {
    "cache-control": "no-store",
    "x-correlation-id": correlationId,
  } as const;

  const isHealth = method === "GET" && req.path === "/health";
  const isIngressProbe =
    dependencies.environment === "preview" &&
    method === "POST" &&
    req.path === "/operational/ingress-probe";
  const probeResponse = isIngressProbe ? ingressProbe(req) : null;
  const publicResponse =
    isHealth || isIngressProbe
      ? null
      : await dependencies.publicApi?.handle({
          method,
          path: req.path,
          headers: requestHeaders,
          body: contentType.startsWith("multipart/form-data")
            ? undefined
            : req.bodyJson,
        });
  const statusCode = isHealth
    ? 200
    : (probeResponse?.statusCode ?? publicResponse?.statusCode ?? 404);
  const operation = isHealth
    ? "health"
    : probeResponse
      ? "ingress_probe"
      : publicResponse
        ? "public_api"
        : "unknown";
  const outcome = isHealth
    ? "success"
    : (probeResponse ?? publicResponse)
      ? statusCode < 400
        ? "success"
        : "rejected"
      : "not_found";
  log(
    serializeOperationalEvent({
      event: "api.request.completed",
      correlationId,
      environment: dependencies.environment,
      release: dependencies.release,
      operation,
      outcome,
      statusCode,
      durationMs: Math.max(0, dependencies.now() - startedAt),
    }),
  );

  if (isHealth) {
    return res.json({ status: "ok" }, statusCode, headers);
  }

  if (probeResponse) {
    return res.json(probeResponse.body, probeResponse.statusCode, headers);
  }

  if (publicResponse) {
    if (publicResponse.binary) {
      if (!res.binary) {
        return res.json({ error: "ERR-ATTACHMENT-UNAVAILABLE" }, 503, headers);
      }
      return res.binary(publicResponse.binary.bytes, publicResponse.statusCode, {
        ...headers,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(publicResponse.binary.displayName)}`,
        "content-length": String(publicResponse.binary.bytes.byteLength),
        "content-type": publicResponse.binary.mediaType,
      });
    }
    return res.json(publicResponse.body, publicResponse.statusCode, headers);
  }

  return res.json({ error: "not_found" }, statusCode, headers);
}
