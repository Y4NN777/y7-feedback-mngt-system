import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("deployed browser smoke targets the Vercel deployment without route interception", async () => {
  const [config, localConfig, scenario] = await Promise.all([
    readFile(new URL("apps/web/playwright.deployed.config.ts", root), "utf8"),
    readFile(new URL("apps/web/playwright.config.ts", root), "utf8"),
    readFile(new URL("apps/web/e2e/deployed/preview.spec.ts", root), "utf8"),
  ]);
  assert.match(config, /Y7_DEPLOYED_PREVIEW_URL/u);
  assert.match(config, /globalSetup/u);
  assert.match(config, /globalTeardown/u);
  assert.doesNotMatch(config, /webServer/u);
  assert.match(localConfig, /testIgnore: "deployed\/\*\*"/u);
  assert.doesNotMatch(scenario, /page\.route/u);
  assert.match(scenario, /page\.reload\(\)/u);
  assert.match(scenario, /Commande appliquée\./u);
  assert.match(scenario, /applyCommandWithResponseLossRetry/u);
  assert.match(scenario, /timeout: 10_000/u);
  assert.match(scenario, /Parcours Reporter déployé/u);
  const fixture = await readFile(
    new URL("apps/web/e2e/deployed/fixture.ts", root),
    "utf8",
  );
  assert.match(fixture, /hostname\.endsWith\("\.vercel\.app"\)/u);
  assert.match(fixture, /createWebPlatform/u);
  assert.match(fixture, /deleteWebPlatform/u);
  assert.doesNotMatch(fixture, /\*\.vercel\.app/u);
});

test("the required Browser gate waits for the exact Vercel Preview and runs the protected real smoke", async () => {
  const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
  assert.match(workflow, /deployments: read/u);
  assert.match(workflow, /environment: g5-preview/u);
  assert.match(
    workflow,
    /DEPLOYMENT_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
  );
  assert.match(workflow, /-f ref="\$DEPLOYMENT_SHA"/u);
  assert.match(workflow, /\.creator\.login == "vercel\[bot\]"/u);
  assert.match(workflow, /\.state == "success"/u);
  assert.match(workflow, /secrets\.Y7_PREVIEW_EVIDENCE_ENV/u);
  assert.match(workflow, /secrets\.Y7_PREVIEW_APPWRITE_API_KEY/u);
  assert.match(workflow, /sed -i '\/\^APPWRITE_API_KEY=\/d'/u);
  assert.match(workflow, /pnpm test:e2e:deployed-preview/u);
});
