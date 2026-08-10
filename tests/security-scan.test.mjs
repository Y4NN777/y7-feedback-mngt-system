import assert from "node:assert/strict";
import test from "node:test";

import { findProhibitedContent, scanRepository } from "../scripts/security-scan.mjs";

test("BDD-SEC-001 rejects secret material and secret-bearing public variables", () => {
  assert.deepEqual(
    findProhibitedContent("fixture.env", "VITE_GITHUB_CLIENT_SECRET=value"),
    ["fixture.env: secret-bearing VITE_ variable"],
  );
  assert.deepEqual(
    findProhibitedContent("fixture.js", "const value = 'y7-test-secret-do-not-ship';"),
    ["fixture.js: test secret sentinel"],
  );
});

test("BDD-SEC-001 accepts public endpoint and project identifiers", () => {
  assert.deepEqual(
    findProhibitedContent(
      "fixture.env",
      "VITE_APPWRITE_ENDPOINT=https://example.appwrite.io\nVITE_APPWRITE_PROJECT_ID=project-id",
    ),
    [],
  );
});

test("BDD-SEC-001 scans configured directories and individual files", async () => {
  const result = await scanRepository();

  assert.ok(result.filesScanned > 0);
  assert.deepEqual(result.findings, []);
});
