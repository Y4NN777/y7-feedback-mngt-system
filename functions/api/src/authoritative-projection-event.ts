import type { AuthoritativeProjectionBatchResult } from "./authoritative-projector.js";

export interface AuthoritativeProjectionBatchRunner {
  runBatch(
    workerId: string,
    maximum: number,
  ): Promise<AuthoritativeProjectionBatchResult>;
}

export async function drainAuthoritativeProjectionEvent(
  projector: AuthoritativeProjectionBatchRunner,
  workerId: string,
  wait: (milliseconds: number) => Promise<void>,
): Promise<AuthoritativeProjectionBatchResult> {
  let processed = 0;
  let projected = 0;
  let retryScheduled = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await projector.runBatch(workerId, 25);
    processed += result.processed;
    projected += result.projected;
    retryScheduled += result.retryScheduled;
    if (result.retryScheduled === 0 && result.processed < 25) break;
    if (result.retryScheduled > 0 && attempt < 3)
      await wait(2 ** attempt * 1_000 + 100);
  }
  return { status: "completed", processed, projected, retryScheduled };
}
