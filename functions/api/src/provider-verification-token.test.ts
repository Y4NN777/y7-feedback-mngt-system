import { describe, expect, it, vi } from "vitest";

import { resolveProviderVerificationToken } from "./provider-verification-token";

describe("resolveProviderVerificationToken", () => {
  it("uses the explicitly configured verification token first", () => {
    expect(
      resolveProviderVerificationToken({
        provider: "github",
        configuredToken: " configured-token ",
        authorizedGrantToken: "oauth-user-token",
        cliToken: vi.fn(() => "cli-token"),
      }),
    ).toBe("configured-token");
  });

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

  it("falls back to the CLI token for GitHub", () => {
    expect(
      resolveProviderVerificationToken({
        provider: "github",
        cliToken: () => " cli-token ",
      }),
    ).toBe("cli-token");
  });

  it.each([
    ["github", "MESSAGE_SYNC_GITHUB_CREDENTIAL_REQUIRED"],
    ["gitlab", "MESSAGE_SYNC_GITLAB_CREDENTIAL_REQUIRED"],
  ] as const)("fails closed when %s has no usable authority", (provider, code) => {
    expect(() =>
      resolveProviderVerificationToken({
        provider,
        configuredToken: " ",
        authorizedGrantToken: " ",
        cliToken: () => " ",
      }),
    ).toThrow(code);
  });
});
