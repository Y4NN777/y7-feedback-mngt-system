import { ExecutionStatus, ExecutionTrigger } from "node-appwrite";

export function hasHealthyScheduledReconciliation(
  executions: ReadonlyArray<{
    readonly trigger: ExecutionTrigger;
    readonly status: ExecutionStatus;
    readonly responseStatusCode: number;
  }>,
): boolean {
  return executions.some(
    ({ trigger, status, responseStatusCode }) =>
      trigger === ExecutionTrigger.Schedule &&
      status === ExecutionStatus.Completed &&
      responseStatusCode === 200,
  );
}
