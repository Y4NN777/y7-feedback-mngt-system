import { describe, expect, it } from "vitest";

import { parseScannerRelease } from "./scanner-release";

describe("scanner release identity", () => {
  it("BDD-REL-421 accepts an exact immutable commit identity", () => {
    expect(parseScannerRelease("a".repeat(40))).toBe("a".repeat(40));
  });

  it.each([undefined, "", "a".repeat(39), "A".repeat(40), "a".repeat(41)])(
    "BDD-REL-422 rejects a missing or mutable scanner identity %#",
    (value) => {
      expect(() => parseScannerRelease(value)).toThrow(
        "ANTIVIRUS_SERVICE_CONFIG_INVALID",
      );
    },
  );
});
