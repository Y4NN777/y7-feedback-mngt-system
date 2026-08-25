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

const attachmentMediaTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain; charset=utf-8",
  "text/csv; charset=utf-8",
]);

function unsafeDisplayName(value: string): boolean {
  if (/[\\/]/u.test(value)) return true;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

async function binaryResponse(response: Response) {
  const disposition = response.headers.get("content-disposition") as string;
  const match = /^attachment; filename\*=UTF-8''([^\s]+)$/u.exec(disposition);
  const mediaType = response.headers.get("content-type");
  const declaredLength = Number(response.headers.get("content-length"));
  let displayName: string;
  try {
    displayName = decodeURIComponent(match?.[1] ?? "");
  } catch {
    throw new Error("HTTP_FUNCTION_RESPONSE_INVALID");
  }
  if (
    response.status !== 200 ||
    response.headers.get("cache-control") !== "no-store" ||
    mediaType === null ||
    !attachmentMediaTypes.has(mediaType) ||
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 1 ||
    declaredLength > 10 * 1024 * 1024 ||
    !displayName ||
    displayName.length > 255 ||
    unsafeDisplayName(displayName)
  ) {
    throw new Error("HTTP_FUNCTION_RESPONSE_INVALID");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== declaredLength) {
    throw new Error("HTTP_FUNCTION_RESPONSE_INVALID");
  }
  return {
    statusCode: 200 as const,
    binary: { bytes, displayName, mediaType },
  };
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
      if (response.headers.has("content-disposition")) {
        return binaryResponse(response);
      }
      return {
        statusCode: response.status,
        body: await responseBody(response),
      };
    },
  };
}
