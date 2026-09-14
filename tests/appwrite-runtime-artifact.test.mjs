import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Appwrite deploys the explicit runtime build instead of the tooling build", async () => {
  const [apiPackage, runtimeConfig, deploymentSource] = await Promise.all([
    readFile(new URL("functions/api/package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("functions/api/tsconfig.runtime.json", root), "utf8").then(
      JSON.parse,
    ),
    readFile(new URL("functions/api/src/deploy-appwrite-function.ts", root), "utf8"),
  ]);

  assert.equal(apiPackage.main, "dist/runtime/main.js");
  assert.equal(apiPackage.scripts["build:runtime"], "tsc -p tsconfig.runtime.json");
  assert.deepEqual(runtimeConfig.include, ["src/main.ts"]);
  assert.match(deploymentSource, /functions\/api\/dist\/runtime\/main\.js/u);
  assert.match(deploymentSource, /stageAppwriteRuntimeArtifact/u);
  assert.match(deploymentSource, /stagingDirectory/u);
  assert.doesNotMatch(deploymentSource, /pnpm --filter @y7-feedback\/api build/u);
});

test("the runtime artifact stages only compiled runtime packages and workspace manifests", async () => {
  const source = await readFile(
    new URL("functions/api/src/appwrite-runtime-artifact.ts", root),
    "utf8",
  );

  assert.match(source, /functions\/api\/dist\/runtime/u);
  assert.match(source, /packages\/config\/dist/u);
  assert.match(source, /packages\/domain\/dist/u);
  assert.doesNotMatch(source, /src\/verify-/u);
  assert.doesNotMatch(source, /\.test\.ts/u);
});
