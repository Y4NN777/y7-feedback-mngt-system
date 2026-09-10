import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildE2eG5Matrix } from "./e2e-g5-matrix";

const expectedScenarioIds = [
  ...Array.from(
    { length: 12 },
    (_, index) => `UC-${String(index + 1).padStart(2, "0")}`,
  ),
  ...Array.from(
    { length: 19 },
    (_, index) => `ERR-${String(index + 1).padStart(3, "0")}`,
  ),
];

describe("G5 end-to-end traceability matrix", () => {
  it("BDD-E2E-201 defines one complete executable row for UC-01..12 and ERR-001..019", () => {
    const matrix = buildE2eG5Matrix();

    expect(matrix.map(({ id }) => id)).toEqual(expectedScenarioIds);
    expect(new Set(matrix.map(({ id }) => id)).size).toBe(31);
    for (const scenario of matrix) {
      expect(scenario.requirementIds).toContain(scenario.id);
      expect(scenario.requirementIds.length).toBeGreaterThanOrEqual(2);
      expect(scenario.actor.length).toBeGreaterThan(0);
      expect(scenario.fixtureOwner.length).toBeGreaterThan(0);
      expect(["local_browser", "appwrite_preview"]).toContain(scenario.environment);
      expect(scenario.positiveOracle.length).toBeGreaterThan(0);
      expect(scenario.negativeOracle.length).toBeGreaterThan(0);
      expect(scenario.cleanupOracle.length).toBeGreaterThan(0);
      expect(scenario.evidenceCommand).toMatch(/^pnpm verify:/u);
    }
  });

  it("BDD-E2E-202 assigns real Preview evidence to every trust-boundary failure", () => {
    const matrix = buildE2eG5Matrix();
    const trustBoundaryErrors = new Set([
      "ERR-006",
      "ERR-007",
      "ERR-009",
      "ERR-010",
      "ERR-011",
      "ERR-013",
      "ERR-015",
      "ERR-016",
      "ERR-017",
      "ERR-018",
      "ERR-019",
    ]);

    for (const scenario of matrix.filter(({ id }) => trustBoundaryErrors.has(id))) {
      expect(scenario.environment).toBe("appwrite_preview");
    }
  });

  it("BDD-E2E-203 references only present fixture owners and root evidence commands", () => {
    const repositoryRoot = resolve(import.meta.dirname, "../../..");
    const packageJson: unknown = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    );
    if (
      typeof packageJson !== "object" ||
      packageJson === null ||
      !("scripts" in packageJson) ||
      typeof packageJson.scripts !== "object" ||
      packageJson.scripts === null
    ) {
      throw new Error("E2E_G5_PACKAGE_SCRIPTS_INVALID");
    }
    const scripts = packageJson.scripts as Readonly<Record<string, unknown>>;

    for (const scenario of buildE2eG5Matrix()) {
      expect(existsSync(resolve(repositoryRoot, scenario.fixtureOwner))).toBe(true);
      const command = /^pnpm (?<script>verify:[^\s]+)$/u.exec(scenario.evidenceCommand)
        ?.groups?.script;
      expect(command).toBeDefined();
      expect(scripts[command ?? ""]).toEqual(expect.any(String));
    }
  });
});
