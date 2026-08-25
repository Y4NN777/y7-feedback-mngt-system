import { describe, expect, it } from "vitest";

import {
  appwriteFunctionVariableKeys,
  planAppwriteFunctionVariables,
} from "./appwrite-function-variables";

const environment = Object.fromEntries(
  appwriteFunctionVariableKeys.map((key) => [key, `value-for-${key}`]),
);

describe("Appwrite Function variable policy", () => {
  it("BDD-DEL-APPWRITE-008 creates deterministic secret variables without static Appwrite authority", () => {
    const actions = planAppwriteFunctionVariables(environment, []);

    expect(actions).toHaveLength(25);
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
