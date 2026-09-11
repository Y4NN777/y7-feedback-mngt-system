import { describe, expect, it, vi } from "vitest";

import {
  captureProductionFunctionDeployment,
  restoreProductionFunctionDeployment,
  type ProductionFunctionDeploymentsPort,
} from "./production-function-rollback";

function port(input?: {
  readonly active?: string;
  readonly activateOnUpdate?: boolean;
  readonly deployments?: readonly { readonly $id: string; readonly status: string }[];
}): ProductionFunctionDeploymentsPort {
  let active = input?.active ?? "deployment_candidate";
  return {
    get: vi.fn(() => Promise.resolve({ deploymentId: active })),
    listDeployments: vi.fn(() =>
      Promise.resolve({
        deployments:
          input?.deployments ??
          ([{ $id: "deployment_previous", status: "ready" }] as const),
      }),
    ),
    updateFunctionDeployment: vi.fn(
      ({ deploymentId }: { readonly deploymentId: string }) => {
        if (input?.activateOnUpdate !== false) active = deploymentId;
        return Promise.resolve();
      },
    ),
  };
}

describe("Production Function rollback authority", () => {
  it("BDD-REL-407 captures the active deployment before release mutation", async () => {
    await expect(captureProductionFunctionDeployment(port())).resolves.toBe(
      "deployment_candidate",
    );
  });

  it("BDD-REL-407 rejects an invalid active deployment identity", async () => {
    await expect(
      captureProductionFunctionDeployment(port({ active: "invalid deployment" })),
    ).rejects.toThrow("PRODUCTION_FUNCTION_ACTIVE_DEPLOYMENT_INVALID");
  });

  it("BDD-REL-408 restores only a known ready deployment and verifies activation", async () => {
    const functions = port();

    await expect(
      restoreProductionFunctionDeployment(functions, "deployment_previous"),
    ).resolves.toBeUndefined();
    expect(functions.updateFunctionDeployment).toHaveBeenCalledWith({
      functionId: "y7-feedback-api-production",
      deploymentId: "deployment_previous",
    });
  });

  it.each([
    ["invalid target", [{ $id: "invalid target", status: "ready" }]],
    ["missing", []],
    ["building", [{ $id: "building", status: "building" }]],
  ])(
    "BDD-REL-409 denies an unavailable rollback target %#",
    async (target, deployments) => {
      await expect(
        restoreProductionFunctionDeployment(port({ deployments }), target, {
          delay: () => Promise.resolve(),
          attempts: 1,
        }),
      ).rejects.toThrow("PRODUCTION_FUNCTION_ROLLBACK_TARGET_INVALID");
    },
  );

  it("BDD-REL-410 fails closed when Appwrite does not activate the rollback target", async () => {
    const delay = vi.fn(() => Promise.resolve());
    await expect(
      restoreProductionFunctionDeployment(
        port({ activateOnUpdate: false }),
        "deployment_previous",
        { delay, attempts: 2 },
      ),
    ).rejects.toThrow("PRODUCTION_FUNCTION_ROLLBACK_TIMEOUT");
    expect(delay).toHaveBeenCalledOnce();
  });

  it("BDD-REL-410 bounds the default activation polling delay", async () => {
    vi.useFakeTimers();
    try {
      const restoration = restoreProductionFunctionDeployment(
        port({ activateOnUpdate: false }),
        "deployment_previous",
        { attempts: 2 },
      );
      const assertion = expect(restoration).rejects.toThrow(
        "PRODUCTION_FUNCTION_ROLLBACK_TIMEOUT",
      );
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
