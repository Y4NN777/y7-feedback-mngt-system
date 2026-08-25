import type { PublicApi, PublicApiRequest } from "./public-api.js";

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export interface FunctionExecutionResult {
  readonly status: string;
  readonly responseStatusCode: number;
  readonly responseBody: string;
}

export interface PublicFunctionExecutor {
  execute(input: {
    readonly body: string;
    readonly method: string;
    readonly path: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
  }): Promise<FunctionExecutionResult>;
}

function responseBody(value: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("APPWRITE_FUNCTION_EXECUTION_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("APPWRITE_FUNCTION_EXECUTION_INVALID");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function requestBody(request: PublicApiRequest): string {
  return request.body === undefined ? "" : JSON.stringify(request.body);
}

export function createAppwriteFunctionPublicApi(
  executor: PublicFunctionExecutor,
): PublicApi {
  return {
    async handle(request) {
      if (!methods.has(request.method)) {
        throw new Error("APPWRITE_FUNCTION_METHOD_INVALID");
      }
      const execution = await executor.execute({
        body: requestBody(request),
        method: request.method,
        path: request.path,
        headers: request.headers,
      });
      if (
        execution.status !== "completed" ||
        !Number.isInteger(execution.responseStatusCode) ||
        execution.responseStatusCode < 100 ||
        execution.responseStatusCode > 599
      ) {
        throw new Error("APPWRITE_FUNCTION_EXECUTION_INVALID");
      }
      return {
        statusCode: execution.responseStatusCode,
        body: responseBody(execution.responseBody),
      };
    },
  };
}
