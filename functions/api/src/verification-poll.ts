export interface VerificationPollOptions<T> {
  readonly attempt: () => Promise<T>;
  readonly accept: (value: T) => boolean;
  readonly maximumAttempts: number;
  readonly intervalMs: number;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

export async function pollVerification<T>(
  options: VerificationPollOptions<T>,
): Promise<T | undefined> {
  const delay =
    options.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 1; attempt <= options.maximumAttempts; attempt += 1) {
    const value = await options.attempt();
    if (options.accept(value)) return value;
    if (attempt < options.maximumAttempts) await delay(options.intervalMs);
  }
  return undefined;
}
