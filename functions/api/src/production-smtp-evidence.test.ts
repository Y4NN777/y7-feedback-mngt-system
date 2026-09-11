import { describe, expect, it, vi } from "vitest";

import { proveProductionSmtpEvidence } from "./production-smtp-evidence";

describe("Production SMTP evidence", () => {
  it("BDD-REL-418 requires real handoff plus retryable and terminal classification", async () => {
    await expect(
      proveProductionSmtpEvidence({
        handoff: vi.fn().mockResolvedValue("delivered"),
        retry: vi.fn().mockResolvedValue("retryable"),
        terminal: vi.fn().mockResolvedValue("permanent"),
      }),
    ).resolves.toEqual({
      handoff: "delivered",
      retry: "retryable",
      terminal: "permanent",
    });
  });

  it.each([
    ["handoff", "retryable"],
    ["retry", "delivered"],
    ["terminal", "retryable"],
  ] as const)("BDD-REL-419 rejects invalid %s evidence", async (key, outcome) => {
    const evidence = {
      handoff: vi.fn().mockResolvedValue("delivered"),
      retry: vi.fn().mockResolvedValue("retryable"),
      terminal: vi.fn().mockResolvedValue("permanent"),
    };
    evidence[key].mockResolvedValueOnce(outcome);
    await expect(proveProductionSmtpEvidence(evidence)).rejects.toThrow(
      "PRODUCTION_SMTP_EVIDENCE_FAILED",
    );
  });

  it("fails closed when a delivery attempt throws", async () => {
    await expect(
      proveProductionSmtpEvidence({
        handoff: vi.fn().mockRejectedValue(new Error("smtp unavailable")),
        retry: vi.fn(),
        terminal: vi.fn(),
      }),
    ).rejects.toThrow("smtp unavailable");
  });
});
