import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import test from "node:test";

import domainPackage from "../packages/domain/package.json" with { type: "json" };
import rootPackage from "../package.json" with { type: "json" };

test("BDD-CI-003 keeps emitted server imports executable under Node ESM", async () => {
  const roots = ["packages/config/src", "packages/domain/src", "functions/api/src"];
  const offenders = [];

  for (const root of roots) {
    for await (const path of glob(`${root}/**/*.ts`, {
      exclude: ["**/*.test.ts"],
    })) {
      const source = await readFile(path, "utf8");
      const relativeSpecifiers = source.matchAll(
        /(?:from|export\s+[^;]*?from)\s+["'](\.[^"']+)["']/gu,
      );
      for (const match of relativeSpecifiers) {
        if (!match[1]?.endsWith(".js")) offenders.push(`${path}:${match[1]}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test("BDD-CI-005 resolves the domain workspace to emitted Node ESM", () => {
  assert.deepEqual(domainPackage.exports, {
    ".": {
      types: "./src/index.ts",
      default: "./dist/index.js",
    },
  });
});

test("BDD-CI-006 builds runtime workspace dependencies before clean-runner tests", () => {
  assert.equal(
    rootPackage.scripts["test:runtime-deps"],
    "pnpm --filter @y7-feedback/config build && pnpm --filter @y7-feedback/domain build",
  );
  assert.match(rootPackage.scripts.test, /^pnpm test:runtime-deps && /u);
  assert.match(rootPackage.scripts["test:coverage"], /^pnpm test:runtime-deps && /u);
});
