import { describe, expect, it } from "vitest";

import { stableProbeFailureCode } from "./slo-probe-failure.js";

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
    expect(stableProbeFailureCode("{}\n")).toBe("UNKNOWN");
  });

  it("BDD-SLO-210 accepts a stable error field and skips malformed codes", () => {
    expect(
      stableProbeFailureCode(
        '{"code":"invalid"}\n{"error":"APPWRITE_PROBE_DENIED:private"}\n',
      ),
    ).toBe("APPWRITE_PROBE_DENIED");
  });
});
