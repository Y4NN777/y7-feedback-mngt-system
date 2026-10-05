import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const apiSourceRoot = path.join(repositoryRoot, "functions/api/src");

const targetDirectories = new Set([
  "capabilities",
  "infrastructure",
  "migrations",
  "runtime",
  "shared",
  "tooling",
]);

const migrationBaseline = {
  productionModules: 192,
  testModules: 179,
  verificationPrograms: 27,
};

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(absolute) : [absolute];
    }),
  );
  return nested.flat();
}

function relativeSourcePath(absolute) {
  return path.relative(apiSourceRoot, absolute).split(path.sep).join("/");
}

async function importsFor(absolute) {
  const source = await readFile(absolute, "utf8");
  return [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map(
    ([, specifier]) => specifier,
  );
}

test("TASK-ARCH-001A constrains the API root while legacy modules migrate downward", async () => {
  const entries = await readdir(apiSourceRoot, { withFileTypes: true });
  const rootFiles = entries.filter((entry) => entry.isFile()).map(({ name }) => name);
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name);

  const testModules = rootFiles.filter((name) => name.endsWith(".test.ts"));
  const verificationPrograms = rootFiles.filter(
    (name) => name.startsWith("verify-") && !name.endsWith(".test.ts"),
  );
  const productionModules = rootFiles.filter(
    (name) => !name.endsWith(".test.ts") && !name.startsWith("verify-"),
  );

  assert.ok(
    productionModules.length <= migrationBaseline.productionModules,
    "new production modules must be created in a target directory, not the API root",
  );
  assert.ok(
    testModules.length <= migrationBaseline.testModules,
    "new tests must be colocated with their target module, not added to the API root",
  );
  assert.ok(
    verificationPrograms.length <= migrationBaseline.verificationPrograms,
    "new deployed verifiers must be created under tooling/verification",
  );
  assert.deepEqual(
    directories.filter((directory) => !targetDirectories.has(directory)),
    [],
    "the API source tree contains a directory outside the approved architecture",
  );
});

test("TASK-ARCH-001A enforces inward dependency direction in migrated modules", async () => {
  const files = (await sourceFiles(apiSourceRoot)).filter((file) =>
    file.endsWith(".ts"),
  );

  for (const absolute of files) {
    const relative = relativeSourcePath(absolute);
    const imports = await importsFor(absolute);

    if (relative.startsWith("runtime/")) {
      assert.equal(
        imports.some((specifier) => specifier.includes("tooling/")),
        false,
        `${relative} imports tooling code`,
      );
    }

    if (relative.startsWith("infrastructure/")) {
      assert.equal(
        imports.some(
          (specifier) =>
            specifier.includes("runtime/http/") || specifier.endsWith("-http.js"),
        ),
        false,
        `${relative} imports an HTTP handler`,
      );
    }

    if (relative.startsWith("capabilities/")) {
      assert.equal(
        imports.some((specifier) => specifier.includes("infrastructure/appwrite/")),
        false,
        `${relative} imports an Appwrite adapter instead of a capability-owned port`,
      );
    }
  }
});
