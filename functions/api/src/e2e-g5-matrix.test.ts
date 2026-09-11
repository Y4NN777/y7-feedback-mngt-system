import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildE2eG5Commands,
  buildE2eG5Index,
  buildE2eG5Matrix,
  parseE2eG5Command,
} from "./e2e-g5-matrix";

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

  it("BDD-E2E-204 emits a complete non-sensitive execution index", () => {
    const matrix = buildE2eG5Matrix();
    const index = buildE2eG5Index();

    expect(index).toEqual({
      result: "E2E_G5_MATRIX_READY",
      scenarioCount: 31,
      useCaseCount: 12,
      errorCount: 19,
      environments: ["appwrite_preview", "local_browser"],
      evidenceCommands: buildE2eG5Commands().map((command) => `pnpm ${command}`),
      scenarios: matrix.map(({ id, requirementIds, environment }) => ({
        id,
        requirementIds,
        environment,
      })),
    });
    expect(JSON.stringify(index)).not.toMatch(
      /accessProof|attachmentContent|contact|internalNote|providerToken|workspaceId/iu,
    );
  });

  it("BDD-E2E-206 produces one safe executable command for every evidence family", () => {
    const commands = buildE2eG5Commands();
    expect(commands.length).toBeGreaterThan(10);
    expect(new Set(commands).size).toBe(commands.length);
    expect(commands).toContain("verify:e2e:g5:browser");
    expect(commands).toContain("verify:recovery:g5");
    expect(commands).toContain("verify:providers:g4:reconciliation");
    expect(commands).toContain("verify:providers:g4:message-sync:github");
    expect(commands).toContain("verify:providers:g4:message-sync:gitlab");
    expect(commands).toContain("verify:slo:g5");
    expect(commands.every((command) => /^verify:[a-z0-9:-]+$/u.test(command))).toBe(
      true,
    );
  });

  it("rejects an evidence command outside the root verify surface", () => {
    expect(() => parseE2eG5Command("pnpm test && echo unsafe")).toThrow(
      "E2E_G5_COMMAND_INVALID",
    );
  });

  it("BDD-E2E-205 names every currently automated browser journey and denial oracle", () => {
    const repositoryRoot = resolve(import.meta.dirname, "../../..");
    const browserSpecifications = [
      "apps/web/e2e/root.spec.ts",
      "apps/web/e2e/offline.spec.ts",
    ]
      .map((path) => readFileSync(resolve(repositoryRoot, path), "utf8"))
      .join("\n");

    for (const id of [
      "UC-01",
      "UC-02",
      "UC-03",
      "UC-04",
      "UC-05",
      "UC-06",
      "UC-07",
      "UC-08",
      "UC-09",
      "UC-10",
      "UC-11",
      "UC-12",
      "ERR-001",
      "ERR-007",
      "ERR-014",
      "ERR-019",
    ]) {
      expect(browserSpecifications).toContain(id);
    }
  });
});
