import { describe, expect, it } from "vitest";

import { resolveProviderMessageSyncEvidenceTarget } from "./provider-message-sync-evidence-target";

describe("provider message synchronization evidence target", () => {
  it("BDD-SYNC-230 selects isolated Preview authority by default", () => {
    expect(
      resolveProviderMessageSyncEvidenceTarget({
        arguments: ["--apply", "--provider=gitlab"],
        configuredEnvironment: "preview",
        functionDomain: " https://preview.example.test ",
        functionId: undefined,
      }),
    ).toEqual({
      environment: "preview",
      functionDomain: "https://preview.example.test",
      functionId: "y7-feedback-api-preview",
    });
  });

  it("BDD-REL-407 selects explicit Production authority and custom Function ID", () => {
    expect(
      resolveProviderMessageSyncEvidenceTarget({
        arguments: ["--apply", "--production", "--provider=github"],
        configuredEnvironment: "production",
        functionDomain: "https://production.example.test",
        functionId: "function-production",
      }),
    ).toEqual({
      environment: "production",
      functionDomain: "https://production.example.test",
      functionId: "function-production",
    });
  });

  it("fails closed for a missing domain or cross-environment configuration", () => {
    expect(() =>
      resolveProviderMessageSyncEvidenceTarget({
        arguments: ["--apply", "--production"],
        configuredEnvironment: "preview",
        functionDomain: "https://preview.example.test",
        functionId: undefined,
      }),
    ).toThrow("MESSAGE_SYNC_VERIFY_CONFIG_INVALID");
    expect(() =>
      resolveProviderMessageSyncEvidenceTarget({
        arguments: ["--apply"],
        configuredEnvironment: "preview",
        functionDomain: " ",
        functionId: undefined,
      }),
    ).toThrow("MESSAGE_SYNC_VERIFY_CONFIG_INVALID");
  });
});
