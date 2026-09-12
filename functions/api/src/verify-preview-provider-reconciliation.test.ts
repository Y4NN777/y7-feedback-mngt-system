import { describe, expect, it } from "vitest";
import { ExecutionStatus, ExecutionTrigger } from "node-appwrite";

import { hasHealthyScheduledReconciliation } from "./provider-reconciliation-evidence";

describe("provider reconciliation evidence", () => {
  it("accepts current scheduled health after historical outage evidence expires", () => {
    expect(
      hasHealthyScheduledReconciliation([
        {
          trigger: ExecutionTrigger.Schedule,
          status: ExecutionStatus.Completed,
          responseStatusCode: 200,
        },
      ]),
    ).toBe(true);
  });

  it("rejects manual, failed, and non-200 executions", () => {
    expect(
      hasHealthyScheduledReconciliation([
        {
          trigger: ExecutionTrigger.Http,
          status: ExecutionStatus.Completed,
          responseStatusCode: 200,
        },
        {
          trigger: ExecutionTrigger.Schedule,
          status: ExecutionStatus.Failed,
          responseStatusCode: 503,
        },
        {
          trigger: ExecutionTrigger.Schedule,
          status: ExecutionStatus.Completed,
          responseStatusCode: 503,
        },
      ]),
    ).toBe(false);
  });
});
