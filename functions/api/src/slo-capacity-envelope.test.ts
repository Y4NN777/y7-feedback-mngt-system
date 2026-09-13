import { describe, expect, it } from "vitest";

import {
  declaredSloConcurrency,
  declaredSloSamplesPerReadMetric,
} from "./slo-capacity-envelope";

describe("declared initial release capacity", () => {
  it("BDD-SLO-221 names the measured bounded envelope explicitly", () => {
    expect(declaredSloConcurrency).toBe(4);
    expect(declaredSloSamplesPerReadMetric).toBe(40);
  });
});
