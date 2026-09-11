import { describe, expect, it } from "vitest";

import {
  assertProductionFunctionRelease,
  assertProductionWebRelease,
} from "./production-runtime-release";

const candidate = "c".repeat(40);

describe("Production runtime release identity", () => {
  it("BDD-REL-427 accepts the Function and PWA built for the candidate", () => {
    expect(
      assertProductionFunctionRelease(
        { status: "ok", environment: "production", release: candidate },
        candidate,
      ),
    ).toBe(true);
    expect(
      assertProductionWebRelease(
        `<head><meta name="y7-release" content="${candidate}" /></head>`,
        candidate,
      ),
    ).toBe(true);
  });

  it.each([
    null,
    {},
    { status: "unavailable", release: candidate },
    { status: "ok", release: "d".repeat(40) },
  ])("BDD-REL-428 rejects stale Function evidence %#", (body) => {
    expect(() => assertProductionFunctionRelease(body, candidate)).toThrow(
      "PRODUCTION_FUNCTION_RELEASE_MISMATCH",
    );
  });

  it.each([
    "",
    '<meta name="y7-release" content="main" />',
    `<meta name="y7-release" content="${"d".repeat(40)}" />`,
    `<meta name="other" content="${candidate}" />`,
  ])("BDD-REL-429 rejects stale or unlabelled PWA evidence %#", (html) => {
    expect(() => assertProductionWebRelease(html, candidate)).toThrow(
      "PRODUCTION_WEB_RELEASE_MISMATCH",
    );
  });

  it("BDD-REL-430 rejects a mutable candidate identity", () => {
    expect(() =>
      assertProductionFunctionRelease({ status: "ok", release: "main" }, "main"),
    ).toThrow("PRODUCTION_FUNCTION_RELEASE_MISMATCH");
    expect(() =>
      assertProductionWebRelease('<meta name="y7-release" content="main" />', "main"),
    ).toThrow("PRODUCTION_WEB_RELEASE_MISMATCH");
  });
});
