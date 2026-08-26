import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BDD-CI-001 runs the complete pull-request gate with pinned least-privilege actions", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /pull_request:/u);
  assert.match(workflow, /permissions:\s+contents: read/u);
  assert.match(workflow, /node-version: 24/u);
  assert.match(workflow, /version: 10\.32\.1/u);

  const actionReferences = [...workflow.matchAll(/^\s+(?:- )?uses: ([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  assert.ok(actionReferences.length >= 3);
  for (const reference of actionReferences) {
    assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/u);
  }

  for (const command of [
    "pnpm install --frozen-lockfile",
    "pnpm format:check",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm test:coverage",
    "pnpm build",
    "pnpm verify:antivirus:local",
    "pnpm security:scan",
    "pnpm --filter @y7-feedback/web exec playwright install --with-deps chromium",
    "pnpm test:e2e",
  ]) {
    assert.ok(workflow.includes(command), `missing CI command: ${command}`);
  }

  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./u);
});

test("BDD-CI-002 builds runtime workspace dependencies before the E2E server", async () => {
  const playwrightConfig = await readFile(
    new URL("../apps/web/playwright.config.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    playwrightConfig,
    /command:\s*"pnpm --filter @y7-feedback\/config build && pnpm --filter @y7-feedback\/domain build && pnpm build && pnpm preview --host 127\.0\.0\.1"/u,
  );
});

test("BDD-CI-005 publishes the antivirus image with least privilege and immutable provenance", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/antivirus-image.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /branches:\s+- main/u);
  assert.match(workflow, /permissions:\s+contents: read\s+packages: write/u);
  assert.match(workflow, /docker login .*--password-stdin/u);
  assert.match(workflow, /services\/antivirus\/Dockerfile/u);
  assert.match(workflow, /sha-\$GITHUB_SHA/u);
  assert.match(workflow, /IMAGE_NAME: y4nn777\/y7-feedback-antivirus/u);
  assert.match(workflow, /\$IMAGE_NAME:preview/u);
  assert.doesNotMatch(workflow, /secrets\./u);

  const actionReferences = [...workflow.matchAll(/^\s+(?:- )?uses: ([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  assert.deepEqual(actionReferences, [
    "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
  ]);
});

test("BDD-CI-004 loads ignored Appwrite credentials without shell export", async () => {
  const rootPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    rootPackage.scripts["provision:appwrite"],
    "pnpm --filter @y7-feedback/config build && pnpm --filter @y7-feedback/domain build && pnpm --filter @y7-feedback/api build && node --env-file=.env.appwrite-preview functions/api/dist/provision-appwrite.js --apply",
  );
  assert.equal(
    rootPackage.scripts["verify:appwrite:g1"],
    "pnpm --filter @y7-feedback/config build && pnpm --filter @y7-feedback/domain build && pnpm --filter @y7-feedback/api build && node --env-file=.env.appwrite-preview functions/api/dist/verify-appwrite-g1.js --apply",
  );
});
