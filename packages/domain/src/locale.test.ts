import { describe, expect, it } from "vitest";

import { isLocale, supportedLocales } from "./locale";

describe("locale contract", () => {
  it("accepts exactly the two product locales", () => {
    expect(supportedLocales).toEqual(["fr", "en"]);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("en")).toBe(true);
  });

  it("fails closed for an unsupported locale", () => {
    expect(isLocale("de")).toBe(false);
    expect(isLocale("")).toBe(false);
  });
});
