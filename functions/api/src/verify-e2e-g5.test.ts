import { describe, expect, it, vi } from "vitest";

import { buildE2eG5Commands } from "./e2e-g5-matrix";
import { verifyE2eG5 } from "./verify-e2e-g5";

describe("G5 end-to-end runner", () => {
  it("BDD-E2E-207 runs every evidence command once in deterministic order", () => {
    const execute = vi.fn<(command: string) => void>(() => undefined);
    const prior = process.argv;
    process.argv = [...prior, "--apply"];
    try {
      verifyE2eG5(execute);
    } finally {
      process.argv = prior;
    }
    expect(execute.mock.calls.map((call) => call[0])).toEqual(buildE2eG5Commands());
  });

  it("requires explicit apply and stops on the first failed evidence command", () => {
    const prior = process.argv;
    process.argv = prior.filter((argument) => argument !== "--apply");
    expect(() => {
      verifyE2eG5(vi.fn<(command: string) => void>(() => undefined));
    }).toThrow("E2E_G5_APPLY_REQUIRED");

    process.argv = [...prior, "--apply"];
    const execute = vi.fn(() => {
      throw new Error("E2E_G5_EVIDENCE_FAILED");
    });
    try {
      expect(() => {
        verifyE2eG5(execute);
      }).toThrow("E2E_G5_EVIDENCE_FAILED");
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      process.argv = prior;
    }
  });
});
