import { describe, expect, it } from "vitest";

import { assertProductionScannerRelease } from "./production-scanner-evidence";

const candidate = "a".repeat(40);

describe("Production scanner release evidence", () => {
  it("BDD-REL-423 accepts only the scanner built for the candidate commit", () => {
    expect(
      assertProductionScannerRelease({ status: "ok", release: candidate }, candidate),
    ).toBe(true);
  });

  it.each([
    null,
    {},
    { status: "unavailable", release: candidate },
    { status: "ok" },
    { status: "ok", release: "b".repeat(40) },
  ])("BDD-REL-424 rejects stale or malformed scanner evidence %#", (body) => {
    expect(() => assertProductionScannerRelease(body, candidate)).toThrow(
      "PRODUCTION_SCANNER_RELEASE_MISMATCH",
    );
  });

  it("BDD-REL-425 rejects a non-immutable candidate identity", () => {
    expect(() =>
      assertProductionScannerRelease({ status: "ok", release: "main" }, "main"),
    ).toThrow("PRODUCTION_SCANNER_RELEASE_MISMATCH");
  });
});
