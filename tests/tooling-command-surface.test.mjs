import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const packageFiles = ["../package.json", "../functions/api/package.json"];
const planningCode = /(?:^|:)(?:g[1-5]|d[1-5])(?::|$)/iu;

test("TASK-DX-010 exposes one descriptive canonical command per tooling action", async () => {
  for (const packageFile of packageFiles) {
    const packageJson = JSON.parse(
      await readFile(new URL(packageFile, import.meta.url), "utf8"),
    );
    const scripts = Object.entries(packageJson.scripts ?? {});

    for (const [name] of scripts) {
      assert.doesNotMatch(name, planningCode, `${packageFile}: ${name}`);
    }

    const commands = new Map();
    for (const [name, command] of scripts) {
      const existing = commands.get(command);
      assert.equal(
        existing,
        undefined,
        `${packageFile}: ${name} duplicates ${existing ?? "another command"}`,
      );
      commands.set(command, name);
    }
  }
});

test("TASK-DX-010 workflows use descriptive names and existing canonical commands", async () => {
  const rootPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
  const workflowFiles = (await readdir(workflowDirectory)).filter((file) =>
    file.endsWith(".yml"),
  );

  for (const workflowFile of workflowFiles) {
    assert.doesNotMatch(workflowFile, /(?:^|-)(?:g[1-5]|d[1-5])(?:-|\.)/iu);
    const workflow = await readFile(new URL(workflowFile, workflowDirectory), "utf8");
    for (const match of workflow.matchAll(/pnpm (verify:[a-z0-9:-]+)/gu)) {
      const command = match[1];
      assert.ok(
        command && rootPackage.scripts[command],
        `${workflowFile}: unknown canonical command ${command ?? "<missing>"}`,
      );
      assert.doesNotMatch(command, planningCode, `${workflowFile}: ${command}`);
    }
  }
});

test("TASK-DX-010 tooling filenames use descriptive capability names", async () => {
  const toolingDirectory = new URL("../functions/api/src/", import.meta.url);
  const toolingFiles = await readdir(toolingDirectory);

  for (const toolingFile of toolingFiles) {
    assert.doesNotMatch(
      toolingFile,
      /(?:^|-)(?:g[1-5]|d[1-5])(?:-|\.)/iu,
      `functions/api/src/${toolingFile}`,
    );
  }
});
