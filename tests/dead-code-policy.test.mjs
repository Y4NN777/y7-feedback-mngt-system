import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TASK-DX-008 runs Knip through an explicit monorepo command surface", async () => {
  const rootPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const configuration = JSON.parse(
    await readFile(new URL("../knip.json", import.meta.url), "utf8"),
  );

  assert.equal(rootPackage.scripts["dead-code:check"], "knip");
  assert.equal(typeof rootPackage.devDependencies.knip, "string");
  assert.deepEqual(Object.keys(configuration.workspaces).sort(), [
    ".",
    "apps/web",
    "functions/api",
    "packages/config",
    "packages/domain",
    "services/antivirus",
  ]);

  for (const workspace of Object.values(configuration.workspaces)) {
    assert.ok(Array.isArray(workspace.project) && workspace.project.length > 0);
  }

  assert.ok(configuration.workspaces["."].entry.includes("scripts/*.mjs"));
  assert.ok(
    configuration.workspaces["functions/api"].entry.includes("src/verify-*.ts"),
  );
  assert.ok(configuration.workspaces["apps/web"].entry.includes("e2e/**/*.ts"));

  const ci = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(ci, /run: pnpm dead-code:check/u);
});

test("TASK-DX-008 removes the unused intelligence filter export", async () => {
  const gateway = await readFile(
    new URL("../apps/web/src/IntelligenceGateway.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(gateway, /intelligenceFilterKinds/u);
});
