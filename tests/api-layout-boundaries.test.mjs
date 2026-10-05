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

const intakeCapabilityModules = [
  "authoritative-intake-envelope",
  "authoritative-intake-projector",
  "authoritative-intake-store",
  "intake",
];

const attachmentCapabilityModules = [
  "attachment-download",
  "attachment-lifecycle",
  "attachment-saga",
  "attachment-staging",
  "attachment-staging-token",
  "attachment-validation",
  "reporter-attachment-download",
  "workspace-attachment-download",
];

const appwriteIntakeModules = ["appwrite-intake-store"];

const appwriteAttachmentModules = [
  "appwrite-attachment-acceptance-store",
  "appwrite-attachment-lifecycle-store",
  "appwrite-private-attachment-storage",
  "appwrite-workspace-attachment-scope",
];

const conversationCapabilityModules = [
  "authoritative-conversation-envelope",
  "authoritative-conversation-projector",
  "authoritative-conversation-store",
  "conversation-lifecycle",
];

const workbenchCapabilityModules = ["workbench"];

const appwriteConversationModules = [
  "appwrite-conversation-lifecycle-store",
  "appwrite-conversation-pending-commits",
  "appwrite-conversation-preflight",
  "appwrite-conversation-projection-store",
];

const appwriteWorkbenchModules = [
  "appwrite-notification-fanout",
  "appwrite-notification-feed-store",
  "appwrite-workbench-mutation-store",
  "appwrite-workbench-store",
];

const administrationCapabilityModules = [
  "project-administration",
  "workspace-project-operations",
];

const platformAccessCapabilityModules = ["platform-access", "platform-access-audit-id"];

const appwriteAdministrationModules = [
  "appwrite-project-administration-store",
  "appwrite-workspace-owner-scope",
  "appwrite-workspace-project-ports",
];

const appwritePlatformAccessModules = [
  "appwrite-platform-access-store",
  "appwrite-platform-authority",
  "appwrite-platform-content-reader",
  "appwrite-principal-verifier",
  "appwrite-workspace-capability-scope",
];

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

test("TASK-ARCH-001D colocates intake and attachment capabilities with their Appwrite adapters", async () => {
  const files = new Set(
    (await sourceFiles(apiSourceRoot)).map((absolute) => relativeSourcePath(absolute)),
  );

  for (const [directory, modules] of [
    ["capabilities/intake", intakeCapabilityModules],
    ["capabilities/attachments", attachmentCapabilityModules],
    ["infrastructure/appwrite/intake", appwriteIntakeModules],
    ["infrastructure/appwrite/attachments", appwriteAttachmentModules],
  ]) {
    for (const module of modules) {
      assert.equal(files.has(`${directory}/${module}.ts`), true);
      assert.equal(files.has(`${directory}/${module}.test.ts`), true);
      assert.equal(files.has(`${module}.ts`), false);
      assert.equal(files.has(`${module}.test.ts`), false);
    }
  }

  for (const target of [
    "capabilities/intake/public-project.ts",
    "infrastructure/appwrite/intake/appwrite-public-project-reader.ts",
    "infrastructure/appwrite/intake/appwrite-public-project-reader.test.ts",
    "runtime/http/public-api.ts",
    "runtime/http/public-api.test.ts",
    "runtime/http/public-api-workspace-operations.test.ts",
  ]) {
    assert.equal(files.has(target), true);
  }
  for (const legacy of [
    "appwrite-public-project-reader.ts",
    "appwrite-public-project-reader.test.ts",
    "public-api.ts",
    "public-api.test.ts",
    "public-api-workspace-operations.test.ts",
  ]) {
    assert.equal(files.has(legacy), false);
  }
});

test("TASK-ARCH-001E colocates conversation and Workbench capabilities with their Appwrite adapters", async () => {
  const files = new Set(
    (await sourceFiles(apiSourceRoot)).map((absolute) => relativeSourcePath(absolute)),
  );

  for (const [directory, modules] of [
    ["capabilities/conversations", conversationCapabilityModules],
    ["capabilities/workbench", workbenchCapabilityModules],
    ["infrastructure/appwrite/conversations", appwriteConversationModules],
    ["infrastructure/appwrite/workbench", appwriteWorkbenchModules],
  ]) {
    for (const module of modules) {
      assert.equal(files.has(`${directory}/${module}.ts`), true);
      assert.equal(files.has(`${directory}/${module}.test.ts`), true);
      assert.equal(files.has(`${module}.ts`), false);
      assert.equal(files.has(`${module}.test.ts`), false);
    }
  }

  for (const handler of ["conversation-lifecycle-http", "workbench-http"]) {
    assert.equal(files.has(`runtime/http/${handler}.ts`), true);
    assert.equal(files.has(`runtime/http/${handler}.test.ts`), true);
    assert.equal(files.has(`${handler}.ts`), false);
    assert.equal(files.has(`${handler}.test.ts`), false);
  }
});

test("TASK-ARCH-001F colocates administration and platform-access capabilities with their Appwrite adapters", async () => {
  const files = new Set(
    (await sourceFiles(apiSourceRoot)).map((absolute) => relativeSourcePath(absolute)),
  );

  for (const [directory, modules] of [
    ["capabilities/administration", administrationCapabilityModules],
    ["capabilities/platform-access", platformAccessCapabilityModules],
    ["infrastructure/appwrite/administration", appwriteAdministrationModules],
    ["infrastructure/appwrite/platform-access", appwritePlatformAccessModules],
  ]) {
    for (const module of modules) {
      assert.equal(files.has(`${directory}/${module}.ts`), true);
      assert.equal(files.has(`${directory}/${module}.test.ts`), true);
      assert.equal(files.has(`${module}.ts`), false);
      assert.equal(files.has(`${module}.test.ts`), false);
    }
  }

  for (const handler of ["platform-access-http", "project-administration-http"]) {
    assert.equal(files.has(`runtime/http/${handler}.ts`), true);
    assert.equal(files.has(`runtime/http/${handler}.test.ts`), true);
    assert.equal(files.has(`${handler}.ts`), false);
    assert.equal(files.has(`${handler}.test.ts`), false);
  }
});
