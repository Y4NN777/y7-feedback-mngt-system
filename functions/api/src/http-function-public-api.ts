import type { PublicApi, PublicApiRequest } from "./public-api.js";

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export interface HttpFunctionPublicApiDependencies {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

function origin(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("HTTP_FUNCTION_REQUEST_INVALID");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("HTTP_FUNCTION_REQUEST_INVALID");
  }
  return parsed;
}

function requestPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new Error("HTTP_FUNCTION_REQUEST_INVALID");
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        (segment !== "" && !/^[A-Za-z0-9._~-]+$/u.test(segment)),
    )
  ) {
    throw new Error("HTTP_FUNCTION_REQUEST_INVALID");
  }
  return value;
}

function requestHeaders(request: PublicApiRequest): Record<string, string> {
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  if (
    request.body !== undefined &&
    !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")
  ) {
    headers["content-type"] = "application/json";
  }
  return headers;
}

async function responseBody(
  response: Response,
): Promise<Readonly<Record<string, unknown>>> {
  if (!response.headers.get("content-type")?.startsWith("application/json")) {
    throw new Error("HTTP_FUNCTION_RESPONSE_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = (await response.json()) as unknown;
  } catch {
    throw new Error("HTTP_FUNCTION_RESPONSE_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("HTTP_FUNCTION_RESPONSE_INVALID");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

export function createHttpFunctionPublicApi({
  baseUrl,
  fetch,
  timeoutMs = 30_000,
}: HttpFunctionPublicApiDependencies): PublicApi {
  const base = origin(baseUrl);
  return {
    async handle(request) {
      if (!methods.has(request.method)) {
        throw new Error("HTTP_FUNCTION_REQUEST_INVALID");
      }
      const path = requestPath(request.path);
      let response: Response;
      try {
        response = await fetch(new URL(path, base).toString(), {
          method: request.method,
          headers: requestHeaders(request),
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error("HTTP_FUNCTION_UNAVAILABLE");
      }
      return {
        statusCode: response.status,
        body: await responseBody(response),
      };
    },
  };
}
