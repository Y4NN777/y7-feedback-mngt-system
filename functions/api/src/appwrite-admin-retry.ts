export interface AppwriteAdminRetryOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
  readonly wait?: (delayMs: number) => Promise<void>;
}

const retryableStatusCodes = new Set([429, 502, 503, 504]);

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error))
    return undefined;
  return typeof error.code === "number" ? error.code : undefined;
}

export async function retryAppwriteAdminCall<T>(
  operation: () => Promise<T>,
  options: AppwriteAdminRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const delayMs = options.delayMs ?? 1_000;
  const wait =
    options.wait ??
    ((duration) => new Promise((resolve) => setTimeout(resolve, duration)));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (attempt >= attempts || !retryableStatusCodes.has(statusCode(error) ?? 0))
        throw error;
      await wait(delayMs * attempt);
    }
  }
}
