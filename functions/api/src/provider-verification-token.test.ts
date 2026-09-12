import { describe, expect, it, vi } from "vitest";

import { resolveProviderVerificationToken } from "./provider-verification-token";

describe("resolveProviderVerificationToken", () => {
  it("BDD-SYNC-205 prefers an authorized OAuth grant over the GitHub CLI token", () => {
    const cliToken = vi.fn(() => "actions-installation-token");

    expect(
      resolveProviderVerificationToken({
        provider: "github",
        configuredToken: undefined,
        authorizedGrantToken: "oauth-user-token",
        cliToken,
      }),
    ).toBe("oauth-user-token");
    expect(cliToken).not.toHaveBeenCalled();
  });
});
