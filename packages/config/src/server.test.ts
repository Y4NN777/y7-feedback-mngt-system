import { describe, expect, it } from "vitest";

import { ConfigError } from "./public";
import { parseServerConfig } from "./server";

const validServer = {
  Y7_ENVIRONMENT: "preview",
  APPWRITE_ENVIRONMENT: "preview",
  APPWRITE_ENDPOINT: "https://preview.appwrite.example/v1",
  APPWRITE_PROJECT_ID: "feedback-preview",
  APPWRITE_API_KEY: "server-only-key",
  RELEASE: "commit-123",
};

describe("trusted environment contract", () => {
  it("BDD-ENV-003 requires and returns server-only authority", () => {
    expect(parseServerConfig(validServer)).toEqual({
      environment: "preview",
      backendEnvironment: "preview",
      appwriteEndpoint: "https://preview.appwrite.example/v1",
      appwriteProjectId: "feedback-preview",
      appwriteApiKey: "server-only-key",
      release: "commit-123",
    });
  });

  it("BDD-ENV-003 rejects missing server authority", () => {
    expect(() => parseServerConfig({ ...validServer, APPWRITE_API_KEY: "" })).toThrow(
      new ConfigError("CONFIG_MISSING"),
    );
  });
});
