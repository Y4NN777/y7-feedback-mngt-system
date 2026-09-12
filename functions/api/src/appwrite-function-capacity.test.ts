import { describe, expect, it } from "vitest";

import { resolveAppwriteFunctionRuntimeSpecification } from "./appwrite-function-capacity.js";

describe("Appwrite Function capacity", () => {
  it.each(["preview", "production"] as const)(
    "selects the latency-capable runtime for %s",
    (environment) => {
      expect(resolveAppwriteFunctionRuntimeSpecification(environment)).toBe(
        "s-4vcpu-4gb",
      );
    },
  );

  it("keeps local development on the smallest representative runtime", () => {
    expect(resolveAppwriteFunctionRuntimeSpecification("development")).toBe(
      "s-1vcpu-1gb",
    );
  });
});
