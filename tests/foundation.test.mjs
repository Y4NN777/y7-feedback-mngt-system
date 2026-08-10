import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requiredFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/web/package.json",
  "functions/api/package.json",
  "packages/config/package.json",
  "packages/domain/package.json",
  "tsconfig.base.json",
  "vercel.json",
];

test("BDD-DEL-001/002 exposes the complete Stage 1 workspace and command surface", async () => {
  for (const path of requiredFiles) {
    await assert.doesNotReject(
      readFile(new URL(`../${path}`, import.meta.url), "utf8"),
      `missing required foundation file: ${path}`,
    );
  }

  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const requiredScripts = [
    "build",
    "format:check",
    "lint",
    "security:scan",
    "test",
    "test:coverage",
    "test:e2e",
    "typecheck",
  ];

  assert.equal(packageJson.packageManager, "pnpm@10.32.1");
  for (const script of requiredScripts) {
    assert.equal(
      typeof packageJson.scripts?.[script],
      "string",
      `missing root script: ${script}`,
    );
  }
});
