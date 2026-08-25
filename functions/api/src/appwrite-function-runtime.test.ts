import { describe, expect, it } from "vitest";

import { resolveAppwriteFunctionEnvironment } from "./appwrite-function-runtime";

const local = {
  Y7_ENVIRONMENT: "development",
  APPWRITE_ENVIRONMENT: "development",
  APPWRITE_ENDPOINT: "http://localhost/v1",
  APPWRITE_PROJECT_ID: "local-project",
  APPWRITE_API_KEY: "local-key",
};

describe("Appwrite Function runtime authority", () => {
  it("BDD-DEL-APPWRITE-001 derives authoritative runtime coordinates and execution key", () => {
    const resolved = resolveAppwriteFunctionEnvironment(
      {
        Y7_ENVIRONMENT: "development",
        APPWRITE_ENVIRONMENT: "development",
        APPWRITE_FUNCTION_API_ENDPOINT: "https://fra.cloud.appwrite.io/v1",
        APPWRITE_FUNCTION_PROJECT_ID: "preview-project",
      },
      { "X-Appwrite-Key": "execution-key" },
    );

    expect(resolved.APPWRITE_ENDPOINT).toBe("https://fra.cloud.appwrite.io/v1");
    expect(resolved.APPWRITE_PROJECT_ID).toBe("preview-project");
    expect(resolved.APPWRITE_API_KEY).toBe("execution-key");
  });

  it("BDD-DEL-APPWRITE-002 preserves explicit local configuration outside a Function execution", () => {
    expect(resolveAppwriteFunctionEnvironment(local, {})).toMatchObject(local);
  });

  it("BDD-DEL-APPWRITE-003 rejects missing, duplicated, or conflicting runtime authority", () => {
    for (const [environment, headers] of [
      [
        {
          APPWRITE_FUNCTION_API_ENDPOINT: "https://fra.cloud.appwrite.io/v1",
          APPWRITE_FUNCTION_PROJECT_ID: "preview-project",
        },
        {},
      ],
      [
        {
          APPWRITE_FUNCTION_API_ENDPOINT: "https://fra.cloud.appwrite.io/v1",
          APPWRITE_FUNCTION_PROJECT_ID: "preview-project",
        },
        { "x-appwrite-key": " " },
      ],
      [
        {
          ...local,
          APPWRITE_FUNCTION_API_ENDPOINT: "https://fra.cloud.appwrite.io/v1",
          APPWRITE_FUNCTION_PROJECT_ID: "preview-project",
        },
        { "x-appwrite-key": "execution-key" },
      ],
      [
        {
          ...local,
          APPWRITE_ENDPOINT: "https://fra.cloud.appwrite.io/v1",
          APPWRITE_FUNCTION_API_ENDPOINT: "https://fra.cloud.appwrite.io/v1",
          APPWRITE_FUNCTION_PROJECT_ID: "local-project",
        },
        { "x-appwrite-key": "execution-key" },
      ],
      [
        {
          APPWRITE_FUNCTION_API_ENDPOINT: "https://fra.cloud.appwrite.io/v1",
          APPWRITE_FUNCTION_PROJECT_ID: "preview-project",
        },
        { "x-appwrite-key": "one", "X-Appwrite-Key": "two" },
      ],
    ] as const) {
      expect(() => resolveAppwriteFunctionEnvironment(environment, headers)).toThrow(
        /APPWRITE_FUNCTION_RUNTIME_(?:INVALID|MISMATCH)/u,
      );
    }
  });

  it("BDD-DEL-APPWRITE-004 does not treat unrelated headers as Function authority", () => {
    expect(
      resolveAppwriteFunctionEnvironment(local, {
        authorization: "FeedbackProof private",
      }),
    ).toMatchObject(local);
  });
});
