import { describe, expect, it } from "vitest";

import { ConfigError, assertEnvironmentIsolation, parsePublicConfig } from "./public";

const validPreview = {
  VITE_Y7_ENVIRONMENT: "preview",
  VITE_APPWRITE_ENVIRONMENT: "preview",
  VITE_APPWRITE_ENDPOINT: "https://preview.appwrite.example/v1",
  VITE_APPWRITE_PROJECT_ID: "feedback-preview",
  VITE_RELEASE: "commit-123",
};

describe("public environment contract", () => {
  it("BDD-ENV-001 returns only approved public configuration", () => {
    expect(parsePublicConfig(validPreview)).toEqual({
      environment: "preview",
      backendEnvironment: "preview",
      appwriteEndpoint: "https://preview.appwrite.example/v1",
      appwriteProjectId: "feedback-preview",
      release: "commit-123",
    });
  });

  it.each([
    [{}, "CONFIG_MISSING"],
    [{ ...validPreview, VITE_Y7_ENVIRONMENT: "staging" }, "CONFIG_MISSING"],
    [
      { ...validPreview, VITE_APPWRITE_ENVIRONMENT: "production" },
      "ENVIRONMENT_MISMATCH",
    ],
    [{ ...validPreview, VITE_APPWRITE_ENDPOINT: "not a URL" }, "ENDPOINT_INVALID"],
    [
      { ...validPreview, VITE_APPWRITE_ENDPOINT: "http://remote.example/v1" },
      "ENDPOINT_INSECURE",
    ],
    [{ ...validPreview, VITE_APPWRITE_PROJECT_ID: " " }, "CONFIG_MISSING"],
    [{ ...validPreview, VITE_PROVIDER_TOKEN: "do-not-ship" }, "PUBLIC_SECRET_KEY"],
  ])("BDD-ENV-002 rejects invalid public configuration", (input, code) => {
    expect(() => parsePublicConfig(input)).toThrow(new ConfigError(code));
  });

  it.each(["localhost", "127.0.0.1"])(
    "BDD-ENV-001 permits local HTTP development on %s",
    (hostname) => {
      expect(
        parsePublicConfig({
          ...validPreview,
          NON_PUBLIC_SECRET: "server-side-name-is-ignored",
          VITE_Y7_ENVIRONMENT: "development",
          VITE_APPWRITE_ENVIRONMENT: "development",
          VITE_APPWRITE_ENDPOINT: `http://${hostname}/v1`,
        }).environment,
      ).toBe("development");
    },
  );

  it("BDD-ENV-004 rejects shared Appwrite authority", () => {
    const production = {
      ...parsePublicConfig(validPreview),
      environment: "production" as const,
      backendEnvironment: "production" as const,
    };

    expect(() => {
      assertEnvironmentIsolation(parsePublicConfig(validPreview), production);
    }).toThrow(new ConfigError("ENVIRONMENT_AUTHORITY_SHARED"));
  });

  it("BDD-ENV-004 accepts distinct or same-environment authority", () => {
    const preview = parsePublicConfig(validPreview);
    const production = {
      ...preview,
      environment: "production" as const,
      backendEnvironment: "production" as const,
      appwriteEndpoint: "https://production.appwrite.example/v1",
      appwriteProjectId: "feedback-production",
    };

    expect(() => {
      assertEnvironmentIsolation(preview, preview);
      assertEnvironmentIsolation(preview, production);
      assertEnvironmentIsolation(preview, {
        ...production,
        appwriteEndpoint: preview.appwriteEndpoint,
      });
      assertEnvironmentIsolation(preview, {
        ...production,
        appwriteProjectId: preview.appwriteProjectId,
      });
    }).not.toThrow();
  });
});
