import { describe, expect, it } from "vitest";

import { stableProbeFailureCode } from "./verify-slo-g5.js";

describe("G5 probe diagnostics", () => {
  it("BDD-SLO-208 preserves a stable code from structured failure details", () => {
    expect(
      stableProbeFailureCode(
        '{"status":"error","code":"APPWRITE_DEPLOYED_G1_STATUS_INVALID:{\\"expected\\":201,\\"actual\\":503}"}\n',
      ),
    ).toBe("APPWRITE_DEPLOYED_G1_STATUS_INVALID");
  });

  it("BDD-SLO-209 rejects unstructured child diagnostics", () => {
    expect(stableProbeFailureCode("private transport failure")).toBe("UNKNOWN");
  });
});
