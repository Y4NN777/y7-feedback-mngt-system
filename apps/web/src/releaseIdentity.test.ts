import { describe, expect, it } from "vitest";

import { parseWebReleaseIdentity } from "./releaseIdentity";

describe("web release identity", () => {
  it("BDD-REL-431 uses an explicit immutable release when supplied", () => {
    expect(parseWebReleaseIdentity("a".repeat(40))).toBe("a".repeat(40));
  });

  it("BDD-REL-432 labels a local build without fabricating a commit", () => {
    expect(parseWebReleaseIdentity(undefined)).toBe("local");
    expect(parseWebReleaseIdentity("  ")).toBe("local");
  });

  it.each(['bad" content="injected', "bad value", ".hidden", "a".repeat(101)])(
    "BDD-REL-433 rejects unsafe public release metadata %#",
    (value) => {
      expect(() => parseWebReleaseIdentity(value)).toThrow(
        "WEB_RELEASE_IDENTITY_INVALID",
      );
    },
  );
});
