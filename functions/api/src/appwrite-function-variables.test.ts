import { describe, expect, it } from "vitest";

import {
  appwriteFunctionVariableKeys,
  planAppwriteFunctionVariables,
  resolveAppwriteFunctionTarget,
} from "./appwrite-function-variables";

const environment = Object.fromEntries(
  appwriteFunctionVariableKeys.map((key) => [key, `value-for-${key}`]),
);

describe("Appwrite Function variable policy", () => {
  it.each([
    ["preview", "y7-feedback-api-preview", "Y7 Feedback API Preview"],
    ["production", "y7-feedback-api-production", "Y7 Feedback API Production"],
  ] as const)(
    "BDD-DEL-ENV-001 resolves the isolated %s Function authority",
    (environmentName, id, name) => {
      expect(resolveAppwriteFunctionTarget(environmentName)).toEqual({ id, name });
    },
  );

  it("BDD-DEL-ENV-001 refuses a development or unknown deployment target", () => {
    expect(() => resolveAppwriteFunctionTarget("development")).toThrow(
      "APPWRITE_FUNCTION_DEPLOYMENT_ENVIRONMENT_INVALID",
    );
    expect(() => resolveAppwriteFunctionTarget("staging")).toThrow(
      "APPWRITE_FUNCTION_DEPLOYMENT_ENVIRONMENT_INVALID",
    );
  });

  it("BDD-DEL-APPWRITE-008 creates deterministic secret variables without static Appwrite authority", () => {
    const actions = planAppwriteFunctionVariables(environment, []);

    expect(actions).toHaveLength(32);
    expect(actions.every((action) => action.kind === "create")).toBe(true);
    for (const action of actions) {
      expect(action).toHaveProperty("secret", true);
    }
    expect(actions.every((action) => /^cfg-[a-f0-9]{24}$/u.test(action.id))).toBe(true);
    expect(actions.map((action) => action.key)).not.toContain("APPWRITE_API_KEY");
    expect(actions.map((action) => action.key)).not.toContain("APPWRITE_ENDPOINT");
    expect(actions.map((action) => action.key)).not.toContain("APPWRITE_PROJECT_ID");
  });

  it("BDD-DEL-APPWRITE-009 updates an existing variable by remote identity", () => {
    const actions = planAppwriteFunctionVariables(environment, [
      { id: "existing-release", key: "RELEASE" },
    ]);

    expect(actions.find((action) => action.key === "RELEASE")).toMatchObject({
      kind: "update",
      id: "existing-release",
      value: "value-for-RELEASE",
      secret: true,
    });
  });

  it("BDD-DEL-APPWRITE-010 fails closed before mutation when a value is missing", () => {
    const incomplete = { ...environment, RELEASE: " " };

    expect(() => planAppwriteFunctionVariables(incomplete, [])).toThrow(
      "APPWRITE_FUNCTION_VARIABLE_MISSING:RELEASE",
    );
  });
});
