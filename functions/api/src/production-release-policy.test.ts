import { describe, expect, it } from "vitest";

import {
  assertProductionReleaseReady,
  type ProductionReleaseSnapshot,
} from "./production-release-policy";

function ready(
  overrides: Partial<ProductionReleaseSnapshot> = {},
): ProductionReleaseSnapshot {
  return {
    productionProjectId: "production-project",
    previewProjectId: "preview-project",
    productionFunctionId: "y7-feedback-api-production",
    previewFunctionId: "y7-feedback-api-preview",
    productionWebOrigin: "https://feedback.example.com",
    previewWebOrigin: "https://preview.example.com",
    productionFunctionOrigin: "https://production-function.appwrite.network",
    previewFunctionOrigin: "https://preview-function.appwrite.network",
    productionScannerOrigin: "https://production-scanner.azurecontainerapps.io",
    previewScannerOrigin: "https://preview-scanner.azurecontainerapps.io",
    activeDeploymentReady: true,
    rollbackDeploymentReady: true,
    functionScopes: [
      "rows.read",
      "rows.write",
      "files.read",
      "files.write",
      "users.read",
      "teams.read",
    ],
    missingFunctionVariables: [],
    nonSecretFunctionVariables: [],
    functionHealthReady: true,
    scannerHealthReady: true,
    webHealthReady: true,
    webHeaders: {
      contentSecurityPolicy: true,
      referrerPolicy: true,
      contentTypeOptions: true,
      cacheRevalidation: true,
    },
    functionRollbackPassed: true,
    functionRollForwardPassed: true,
    ...overrides,
  };
}

describe("Production release policy", () => {
  it("BDD-REL-401 accepts only an isolated healthy reversible release", () => {
    expect(assertProductionReleaseReady(ready())).toEqual({
      status: "ready",
      checks: 19,
    });
  });

  it.each([
    ["productionProjectId", "preview-project"],
    ["productionFunctionId", "y7-feedback-api-preview"],
    ["productionWebOrigin", "https://preview.example.com"],
    ["productionFunctionOrigin", "https://preview-function.appwrite.network"],
    ["productionScannerOrigin", "https://preview-scanner.azurecontainerapps.io"],
  ] as const)("BDD-REL-402 rejects shared Preview authority at %s", (key, value) => {
    expect(() => assertProductionReleaseReady(ready({ [key]: value }))).toThrow(
      "PRODUCTION_RELEASE_ENVIRONMENT_COLLISION",
    );
  });

  it("BDD-REL-403 rejects excess or missing Function authority", () => {
    expect(() =>
      assertProductionReleaseReady(
        ready({ functionScopes: ["rows.read", "databases.write"] }),
      ),
    ).toThrow("PRODUCTION_RELEASE_FUNCTION_AUTHORITY_INVALID");
    expect(() =>
      assertProductionReleaseReady(ready({ missingFunctionVariables: ["RELEASE"] })),
    ).toThrow("PRODUCTION_RELEASE_FUNCTION_AUTHORITY_INVALID");
    expect(() =>
      assertProductionReleaseReady(ready({ nonSecretFunctionVariables: ["RELEASE"] })),
    ).toThrow("PRODUCTION_RELEASE_FUNCTION_AUTHORITY_INVALID");
  });

  it.each([
    { functionHealthReady: false },
    { scannerHealthReady: false },
    { webHealthReady: false },
    { activeDeploymentReady: false },
    { rollbackDeploymentReady: false },
    { functionRollbackPassed: false },
    { functionRollForwardPassed: false },
    { webHeaders: { ...ready().webHeaders, cacheRevalidation: false } },
  ])("BDD-REL-404 rejects an unhealthy or irreversible boundary %#", (override) => {
    expect(() => assertProductionReleaseReady(ready(override))).toThrow(
      "PRODUCTION_RELEASE_READINESS_FAILED",
    );
  });
});
