import { ExecutionMethod, ExecutionStatus, type Functions } from "node-appwrite";

import type { PublicApi, PublicApiRequest } from "./public-api.js";

export interface AppwriteFunctionExecutionPublicApiDependencies {
  readonly functions: Pick<Functions, "createExecution" | "deleteExecution">;
  readonly functionId: string;
}

const functionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const methods = {
  GET: ExecutionMethod.GET,
  POST: ExecutionMethod.POST,
  PUT: ExecutionMethod.PUT,
  PATCH: ExecutionMethod.PATCH,
  DELETE: ExecutionMethod.DELETE,
  OPTIONS: ExecutionMethod.OPTIONS,
  HEAD: ExecutionMethod.HEAD,
} as const;

function executionMethod(value: string): ExecutionMethod {
  switch (value) {
    case "GET":
      return methods.GET;
    case "POST":
      return methods.POST;
    case "PUT":
      return methods.PUT;
    case "PATCH":
      return methods.PATCH;
    case "DELETE":
      return methods.DELETE;
    case "OPTIONS":
      return methods.OPTIONS;
    case "HEAD":
      return methods.HEAD;
    default:
      throw new Error("APPWRITE_FUNCTION_EXECUTION_REQUEST_INVALID");
  }
}

function path(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new Error("APPWRITE_FUNCTION_EXECUTION_REQUEST_INVALID");
  }
  const queryIndex = value.indexOf("?");
  const pathname = queryIndex === -1 ? value : value.slice(0, queryIndex);
  if (
    pathname
      .split("/")
      .some(
        (segment) =>
          segment === "." ||
          segment === ".." ||
          (segment !== "" && !/^[A-Za-z0-9._~-]+$/u.test(segment)),
      )
  ) {
    throw new Error("APPWRITE_FUNCTION_EXECUTION_REQUEST_INVALID");
  }
  return value;
}

function headers(request: PublicApiRequest): Record<string, string> {
  const result = Object.fromEntries(
    Object.entries(request.headers).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  if (
    request.body !== undefined &&
    !Object.keys(result).some((key) => key.toLowerCase() === "content-type")
  ) {
    result["content-type"] = "application/json";
  }
  return result;
}

function responseBody(value: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("APPWRITE_FUNCTION_EXECUTION_RESPONSE_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("APPWRITE_FUNCTION_EXECUTION_RESPONSE_INVALID");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function absent(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === 404
  );
}

export function createAppwriteFunctionExecutionPublicApi({
  functions,
  functionId,
}: AppwriteFunctionExecutionPublicApiDependencies): PublicApi {
  if (!functionIdPattern.test(functionId)) {
    throw new Error("APPWRITE_FUNCTION_EXECUTION_CONFIGURATION_INVALID");
  }
  return {
    async handle(request) {
      const method = executionMethod(request.method);
      const result = await functions.createExecution({
        functionId,
        async: false,
        xpath: path(request.path),
        method,
        headers: headers(request),
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      let response:
        | {
            readonly statusCode: number;
            readonly body: Readonly<Record<string, unknown>>;
            readonly operationalDurationMs: number;
          }
        | undefined;
      try {
        if (
          result.status !== ExecutionStatus.Completed ||
          !Number.isFinite(result.duration) ||
          result.duration < 0
        ) {
          throw new Error("APPWRITE_FUNCTION_EXECUTION_RESPONSE_INVALID");
        }
        response = {
          statusCode: result.responseStatusCode,
          body: responseBody(result.responseBody),
          operationalDurationMs: Math.round(result.duration * 1_000),
        };
      } catch {
        response = undefined;
      }
      try {
        await functions.deleteExecution({ functionId, executionId: result.$id });
      } catch (error: unknown) {
        if (!absent(error)) {
          throw new Error("APPWRITE_FUNCTION_EXECUTION_CLEANUP_FAILED");
        }
      }
      if (response === undefined) {
        throw new Error("APPWRITE_FUNCTION_EXECUTION_RESPONSE_INVALID");
      }
      return response;
    },
  };
}
