import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedBuildCommand = [
  "corepack enable",
  "corepack prepare pnpm@10.32.1 --activate",
  "pnpm install --frozen-lockfile",
  "pnpm --filter @y7-feedback/config build",
  "pnpm --filter @y7-feedback/domain build",
  "pnpm --filter @y7-feedback/api build",
].join(" && ");

async function readManifest() {
  return JSON.parse(
    await readFile(new URL("../appwrite.config.json", import.meta.url), "utf8"),
  );
}

test("BDD-DEL-APPWRITE-005 defines one reproducible Preview Function", async () => {
  const manifest = await readManifest();

  assert.equal(manifest.projectId, "6a7be5dc003be4642e6e");
  assert.equal(manifest.endpoint, "https://fra.cloud.appwrite.io/v1");
  assert.equal(manifest.functions.length, 1);

  const [api] = manifest.functions;
  assert.deepEqual(
    {
      id: api.$id,
      name: api.name,
      enabled: api.enabled,
      runtime: api.runtime,
      execute: api.execute,
      scopes: api.scopes,
      events: api.events,
      schedule: api.schedule,
      path: api.path,
      entrypoint: api.entrypoint,
      commands: api.commands,
    },
    {
      id: "y7-feedback-api-preview",
      name: "Y7 Feedback API Preview",
      enabled: true,
      runtime: "node-22",
      execute: ["any"],
      scopes: ["rows.read", "rows.write", "files.read"],
      events: [],
      schedule: "",
      path: ".",
      entrypoint: "functions/api/dist/main.js",
      commands: expectedBuildCommand,
    },
  );
  assert.equal(api.logging, true);
  assert.equal(api.timeout, 15);
  assert.equal(api.deploymentRetention, 3);
});

test("BDD-DEL-APPWRITE-006 keeps Function secrets and local artifacts out of deployment configuration", async () => {
  const manifest = await readManifest();
  const [api] = manifest.functions;
  const serialized = JSON.stringify(manifest);

  assert.equal(Object.hasOwn(api, "vars"), false);
  assert.doesNotMatch(
    serialized,
    /(?:API_KEY|ENVELOPE_KEY|AUTHORIZATION|PROVIDER_GRANT|SENSITIVE_DATA)/u,
  );

  for (const excluded of [
    ".git",
    ".env*",
    "node_modules",
    "dist",
    "docs",
    "apps",
    "coverage",
    "playwright-report",
    "test-results",
  ]) {
    assert.ok(api.ignore.split("\n").includes(excluded), `missing ignore: ${excluded}`);
  }
});

test("BDD-DEL-APPWRITE-007 exposes an explicit non-variable deployment command", async () => {
  const rootPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(rootPackage.engines.node, ">=22 <25");

  assert.equal(
    rootPackage.scripts["deploy:appwrite:function:preview"],
    "pnpm dlx appwrite-cli@27.2.0 push functions --function-id y7-feedback-api-preview --activate --force",
  );
  assert.doesNotMatch(
    rootPackage.scripts["deploy:appwrite:function:preview"],
    /with-variables/u,
  );
});
