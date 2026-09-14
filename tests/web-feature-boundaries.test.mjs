import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the application shell loads feature pages through lazy boundaries", async () => {
  const source = await readFile(new URL("apps/web/src/App.tsx", root), "utf8");
  for (const feature of [
    "AdministrationPage",
    "FeedbackIntake",
    "IntelligencePage",
    "PlatformAccessPage",
    "RetrieveFeedback",
    "SourceManagementPage",
    "WorkbenchPage",
  ]) {
    assert.match(source, new RegExp(`lazy\\(.*${feature}`, "su"));
    assert.doesNotMatch(source, new RegExp(`^import \\{ ${feature}`, "mu"));
  }
  assert.match(source, /resolveApplicationRoute/u);
  assert.match(source, /RouteBoundary/u);
});

test("the production entrypoint composes only the active route dependencies", async () => {
  const entrypoint = await readFile(new URL("apps/web/src/main.tsx", root), "utf8");
  const composition = await readFile(
    new URL("apps/web/src/composition/routeDependencies.ts", root),
    "utf8",
  );
  assert.match(entrypoint, /composeRouteDependencies/u);
  assert.doesNotMatch(entrypoint, /createHttp[A-Z]/u);
  assert.match(composition, /import\("\.\/retrieval"\)/u);
  assert.match(composition, /import\("\.\/intake"\)/u);
  assert.match(composition, /import\("\.\/teamRoutes"\)/u);
});
