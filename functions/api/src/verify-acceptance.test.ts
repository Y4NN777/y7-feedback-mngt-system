import { describe, expect, it, vi } from "vitest";

import { buildAcceptanceCommands } from "./acceptance-matrix";
import { verifyAcceptance } from "./verify-acceptance";

describe("Preview acceptance runner", () => {
  it("BDD-E2E-207 runs every evidence command once in deterministic order", () => {
    const execute = vi.fn<(command: string) => void>(() => undefined);
    const prior = process.argv;
    process.argv = [...prior, "--apply"];
    try {
      verifyAcceptance(execute);
    } finally {
      process.argv = prior;
    }
    expect(execute.mock.calls.map((call) => call[0])).toEqual(
      buildAcceptanceCommands(),
    );
  });

  it("requires explicit apply and stops on the first failed evidence command", () => {
    const prior = process.argv;
    process.argv = prior.filter((argument) => argument !== "--apply");
    expect(() => {
      verifyAcceptance(vi.fn<(command: string) => void>(() => undefined));
    }).toThrow("ACCEPTANCE_APPLY_REQUIRED");

    process.argv = [...prior, "--apply"];
    const execute = vi.fn(() => {
      throw new Error("ACCEPTANCE_EVIDENCE_FAILED");
    });
    try {
      expect(() => {
        verifyAcceptance(execute);
      }).toThrow("ACCEPTANCE_EVIDENCE_FAILED");
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      process.argv = prior;
    }
  });
});
